require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, insertTransaction, generateTicket } = require('./database');

// Ensure token is provided securely via environment variables
const botToken = process.env.BOT_TOKEN;
if (!botToken && process.env.NODE_ENV !== 'test') {
  console.error("CRITICAL: BOT_TOKEN environment variable is missing.");
  process.exit(1);
}

const bot = new Telegraf(botToken || 'mock_token');

// Create a temp directory if it doesn't exist securely
const tempDir = path.resolve(__dirname, 'temp_downloads');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Regex to extract CBE FT transaction code
const FT_REGEX = /\b(FT[A-Z0-9]{8,15})\b/;
const CBE_DOMAIN = 'cbe.com.et';

/**
 * Perform QR scan using jimp and jsqr.
 * @param {string} imagePath 
 * @returns {Promise<string|null>}
 */
async function scanQRCode(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const imageData = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height
    };
    
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      console.log(`[SCANNER] QR Code Data:`, code.data);
      if (code.data.includes(CBE_DOMAIN)) {
        return code.data;
      }
    } else {
      console.log(`[SCANNER] No QR Code found in image.`);
    }
  } catch (error) {
    console.error("Error in QR Scan:", error.message);
  }
  return null;
}

/**
 * Perform OCR using Tesseract.js.
 * @param {string} imagePath 
 * @returns {Promise<string|null>}
 */
async function performOCR(imagePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
      logger: m => {} // suppress logs
    });
    console.log(`[SCANNER] OCR Raw Text:\n=== START ===\n${text}\n=== END ===`);
    return text;
  } catch (error) {
    console.error("Error in OCR:", error.message);
    return null;
  }
}

/**
 * Extract FT code from string.
 * @param {string} text 
 * @returns {string|null}
 */
function extractFTCode(text) {
  const match = text.match(FT_REGEX);
  return match ? match[1] : null;
}

/**
 * Verifies the receipt using the ShegerPay REST API.
 * @param {string} ftCode 
 * @param {number} amount
 * @returns {Promise<{isValid: boolean, amount: number}>}
 */
async function verifyWithShegerPay(ftCode, amount) {
  try {
    const apiKey = process.env.SHEGERPAY_API_KEY;
    if (!apiKey && process.env.NODE_ENV !== 'test') {
      console.warn("WARNING: SHEGERPAY_API_KEY is not set!");
    }

    const payload = {
      provider: "cbe",
      transaction_id: ftCode,
      amount: amount
    };

    console.log(`[SHEGERPAY] Verifying FT Code ${ftCode} for ${amount} ETB...`);
    
    const response = await axios.post('https://api.shegerpay.com/api/v1/verify', payload, {
      headers: {
        'X-API-Key': apiKey || 'mock_key',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    // Assume ShegerPay returns { verified: true, data: { amount: 100 } }
    // Adjust based on actual ShegerPay JSON structure
    if (response.data && response.data.verified === true) {
       console.log(`[SHEGERPAY] ✅ Verification Successful for ${ftCode}`);
       return { isValid: true, amount: amount, rawData: response.data }; 
    } else {
       console.log(`[SHEGERPAY] ❌ Verification Failed:`, response.data);
       return { isValid: false, amount: 0, rawData: response.data };
    }
  } catch (error) {
    // If it's a 4xx error, the verification failed
    if (error.response) {
      console.error("[SHEGERPAY] API rejected the transaction:", error.response.data);
    } else {
      console.error("[SHEGERPAY] API connection error:", error.message);
    }
    return { isValid: false, amount: 0 };
  }
}

/**
 * Verifies the receipt image directly with ShegerPay's OCR.
 * @param {string} imagePath
 * @returns {Promise<{isValid: boolean, rawData: any}>}
 */
async function verifyImageWithShegerPay(imagePath) {
  try {
    const apiKey = process.env.SHEGERPAY_API_KEY;
    if (!apiKey && process.env.NODE_ENV !== 'test') {
      console.warn("WARNING: SHEGERPAY_API_KEY is not set!");
    }

    const form = new FormData();
    form.append('provider', 'cbe');
    form.append('screenshot', fs.createReadStream(imagePath));

    console.log(`[SHEGERPAY] Sending Image to /verify-image (multipart)...`);
    
    // Some APIs might take too long for image processing, so bump timeout
    const response = await axios.post('https://api.shegerpay.com/api/v1/verify-image', form, {
      headers: {
        'X-API-Key': apiKey || 'mock_key',
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000 
    });

    if (response.data && response.data.verified === true) {
       console.log(`[SHEGERPAY] ✅ Image Verification Successful`);
       return { isValid: true, rawData: response.data }; 
    } else {
       console.log(`[SHEGERPAY] ❌ Image Verification Failed:`, response.data);
       return { isValid: false, rawData: response.data };
    }
  } catch (error) {
    if (error.response) {
      console.error("[SHEGERPAY] Image API rejected the transaction:", error.response.data);
    } else {
      console.error("[SHEGERPAY] Image API connection error:", error.message);
    }
    return { isValid: false, rawData: error.response ? error.response.data : null };
  }
}

/**
 * Core validation logic.
 * @param {string} imagePath 
 * @param {number} userId 
 * @returns {Promise<string>} User-facing response message
 */
async function processReceipt(imagePath, userId) {
  try {
    let ftCode = null;
    let scrapeUrl = null;
    let ocrText = null;

    // Step 2A: QR Scan
    const qrData = await scanQRCode(imagePath);
    if (qrData) {
      scrapeUrl = qrData;
      ftCode = extractFTCode(qrData);
    }

    // Step 2B: OCR Fallback
    if (!ftCode) {
      ocrText = await performOCR(imagePath);
      if (ocrText) {
        ftCode = extractFTCode(ocrText);
      }
    }

    if (!ftCode) {
      return "Sorry, I couldn't find a valid CBE transaction reference (FT code) in the image.";
    }
    
    console.log(`[SCANNER] Extracted FT Code: ${ftCode}`);

    // Ensure we always have OCR text so we can extract the amount and account
    if (!ocrText) {
      ocrText = await performOCR(imagePath);
    }
    
    // Extract actual amount from OCR
    let extractedAmount = 100.00; // default
    if (ocrText) {
        const amountMatch = ocrText.match(/ETB\s*([\d,]+(?:\.\d+)?)\s*has been debited/i) || 
                            ocrText.match(/ETB\s*([\d,]+(?:\.\d+)?)\s*transfer/i) ||
                            ocrText.match(/transferred\s*ETB\s*([\d,]+(?:\.\d+)?)/i) ||
                            ocrText.match(/amount.*?(?:ETB)?\s*([\d,]+(?:\.\d+)?)/i);
        if (amountMatch) {
            extractedAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
            console.log(`[SCANNER] Extracted Amount: ${extractedAmount}`);
        }
    }

    // Step 3: API Verification via ShegerPay
    let verification = await verifyWithShegerPay(ftCode, extractedAmount);
    
    // NEW: Step 3B: Image API Verification via ShegerPay
    let imageVerification = await verifyImageWithShegerPay(imagePath);
    
    // FOR TESTING: Just return all the extracted info back to the user!
    let responseMessage = `✅ Receipt Identified!\nFT Code: ${ftCode}\n`;
    responseMessage += `💰 Actual Amount Paid (Our OCR): ${extractedAmount} ETB\n\n`;
    
    if (verification.isValid) {
      responseMessage += `📡 ShegerPay Standard API Response:\n${JSON.stringify(verification.rawData, null, 2)}\n\n`;
    } else {
      responseMessage += `❌ ShegerPay Standard API Failed or Rejected it.\n\n`;
    }

    if (imageVerification.isValid) {
      responseMessage += `📸 ShegerPay Image API Response:\n${JSON.stringify(imageVerification.rawData, null, 2)}\n\n`;
    } else {
      responseMessage += `📸 ShegerPay Image API Failed:\n${JSON.stringify(imageVerification.rawData, null, 2)}\n\n`;
    }

    if (!ocrText) ocrText = await performOCR(imagePath);
    
    // In Telegram, messages can't be extremely long, so we truncate OCR if it's too huge, but usually receipts are small.
    responseMessage += `📝 Raw OCR Text Extracted:\n${ocrText.substring(0, 1500)}`;
    
    return responseMessage;

  } catch (err) {
    console.error("Error processing receipt:", err);
    return "An internal error occurred while processing your receipt.";
  }
}

bot.on('photo', async (ctx) => {
  let localFilePath = null;
  try {
    const photos = ctx.message.photo;
    // Telegram sends multiple sizes. The last one is the highest resolution.
    const highestResPhoto = photos[photos.length - 1];
    
    // Get download link
    const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
    
    // Secure filename generation to prevent path traversal
    const safeExt = path.extname(fileLink.href).split('?')[0]; // simple extension clean
    const tempFileName = crypto.randomUUID() + (safeExt || '.jpg');
    localFilePath = path.join(tempDir, tempFileName);

    // Download image securely
    const response = await axios({
      url: fileLink.href,
      method: 'GET',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(localFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    ctx.reply("Processing your receipt... Please wait.");
    
    const userId = ctx.from.id;
    const resultMsg = await processReceipt(localFilePath, userId);
    
    ctx.reply(resultMsg);

  } catch (error) {
    console.error(error);
    ctx.reply("Sorry, an error occurred while downloading or processing your image.");
  } finally {
    // Strict cleanup of temp file
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (err) {
        console.error(`Failed to delete temp file ${localFilePath}:`, err);
      }
    }
  }
});

// Start initialization if not in test env
if (process.env.NODE_ENV !== 'test') {
  initDb()
    .then(() => {
      console.log("Database initialized.");
      bot.launch();
      console.log("Telegram Bot started.");
    })
    .catch(err => {
      console.error("Failed to initialize database:", err);
    });
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { processReceipt, verifyWithShegerPay, verifyImageWithShegerPay };
