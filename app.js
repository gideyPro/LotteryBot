require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, insertTransaction, generateTicket, Transaction, getSetting, setSetting } = require('./database');
const express = require('express');
const helmet = require('helmet');
const webApp = express();

webApp.use(helmet());
webApp.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
  res.setHeader('Cache-Control', 'no-store');
  next();
});

webApp.get('/', async (req, res) => {
  try {
    const totalTx = await Transaction.countDocuments();
    
    const result = await Transaction.aggregate([
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } }
    ]);
    const totalAmount = result.length > 0 ? result[0].totalAmount : 0;
    
    const recentTx = await Transaction.find().sort({ timestamp: -1 }).limit(10);
    const currentAmount = await getSetting('lottery_amount', 100);
    
    // Mask FT codes for security (PII Masking)
    const secureTx = recentTx.map(tx => {
      const ft = tx.transaction_ref;
      const masked = ft ? (ft.substring(0, 3) + '***' + ft.substring(ft.length - 3)) : 'UNKNOWN';
      return { maskedFt: masked, amount: tx.amount, ticket: tx.lottery_ticket, time: tx.timestamp };
    });

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Wavemart Lottery Dashboard</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #111827; padding: 2rem; margin: 0; }
          .container { max-width: 1000px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 2rem; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
          .stat-card { background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
          .stat-value { font-size: 2.5rem; font-weight: bold; color: #2563eb; }
          .stat-label { font-size: 0.875rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.5rem; }
          .table-container { background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
          th { background-color: #f9fafb; font-weight: 600; color: #374151; }
          tr:hover { background-color: #f9fafb; }
          .badge { background: #dcfce7; color: #166534; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
          .settings-card { background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
          .settings-card h3 { margin-top: 0; margin-bottom: 1rem; color: #374151; }
          .settings-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
          .settings-row label { font-weight: 600; color: #374151; min-width: 120px; }
          .settings-row input[type="number"] { padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; font-size: 1rem; width: 150px; }
          .settings-row button { padding: 0.5rem 1.25rem; background: #2563eb; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
          .settings-row button:hover { background: #1d4ed8; }
          .msg { padding: 0.5rem 1rem; border-radius: 0.375rem; margin-bottom: 1rem; font-size: 0.875rem; }
          .msg-ok { background: #dcfce7; color: #166534; }
          .msg-err { background: #fee2e2; color: #991b1b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>LotteryBot Dashboard</h1>
            <p>Real-time statistics for the Wavemart Lottery</p>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">${totalTx}</div>
              <div class="stat-label">Total Tickets Issued</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${totalAmount.toLocaleString()} ETB</div>
              <div class="stat-label">Total Revenue</div>
            </div>
          </div>

          <div class="settings-card">
            <h3>Settings</h3>
            ${req.query.saved === '1' ? '<div class="msg msg-ok">Settings saved successfully.</div>' : ''}
            ${req.query.error ? '<div class="msg msg-err">Invalid amount. Please enter a positive number.</div>' : ''}
            <form method="POST" action="/settings">
              <div class="settings-row">
                <label for="amount">Lottery Amount (ETB)</label>
                <input type="number" id="amount" name="amount" value="${currentAmount}" min="1" step="any" required>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Transaction Ref</th>
                  <th>Amount</th>
                  <th>Lottery Ticket</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${secureTx.map(tx => `
                  <tr>
                    <td><span style="font-family: monospace;">${tx.maskedFt}</span></td>
                    <td>${tx.amount} ETB</td>
                    <td><strong>${tx.ticket}</strong></td>
                    <td><span class="badge">Verified</span></td>
                  </tr>
                `).join('')}
                ${secureTx.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No transactions yet.</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

webApp.use(express.urlencoded({ extended: false }));

webApp.post('/settings', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
      return res.redirect('/?error=invalid');
    }
    await setSetting('lottery_amount', amount);
    res.redirect('/?saved=1');
  } catch (err) {
    console.error("Settings Error:", err);
    res.redirect('/?error=1');
  }
});


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
    let extractedAmount = await getSetting('lottery_amount', 100); // default from settings
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
    
    let responseMessage = `✅ Receipt Identified!\nFT Code: ${ftCode}\n`;
    responseMessage += `💰 Actual Amount Paid: ${extractedAmount} ETB\n\n`;
    
    if (verification.isValid) {
      try {
        const ticket = generateTicket();
        await insertTransaction(ftCode, userId, extractedAmount, ticket);
        responseMessage += `🎉 Success! Your payment was verified.\n🎫 Your Lottery Ticket: ${ticket}\n\n`;
      } catch (dbErr) {
        if (dbErr.code === 'SQLITE_CONSTRAINT') {
          responseMessage += `⚠️ Warning: This receipt (${ftCode}) has already been used to claim a ticket!\n\n`;
        } else {
          responseMessage += `❌ Internal Database Error while saving your ticket.\n\n`;
          console.error("DB Error:", dbErr);
        }
      }
    } else {
      responseMessage += `❌ ShegerPay Standard API Failed or Rejected it.\n\n`;
    }

    if (imageVerification.isValid) {
      responseMessage += `📸 ShegerPay Image API: OK\n\n`;
    } else {
      responseMessage += `📸 ShegerPay Image API: Failed\n\n`;
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

const WEB_PORT = process.env.PORT || 8080;

// Start initialization if not in test env
if (process.env.NODE_ENV !== 'test') {
  // Initialize DB asynchronously. Mongoose automatically buffers queries until connected.
  initDb().catch(err => console.error("Failed to initialize database:", err));
  
  // Start the bot
  bot.launch();
  console.log("Telegram Bot started.");
  
  // Start web server immediately in the main event loop. 
  // This is CRITICAL for cPanel/Plesk (Phusion Passenger) to correctly intercept the port 
  // and route standard HTTPS traffic directly to the dashboard without port 8080.
  webApp.listen(WEB_PORT, () => {
    console.log("Web dashboard running on port " + WEB_PORT);
  });
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { processReceipt, verifyWithShegerPay, verifyImageWithShegerPay };
