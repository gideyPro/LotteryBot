require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
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
    const currentSuffix = await getSetting('cbe_account_suffix', '');
    
    // Mask FT codes for security (PII Masking)
    const secureTx = recentTx.map(tx => {
      const ft = tx.transaction_ref;
      const masked = ft ? (ft.substring(0, 3) + '***' + ft.substring(ft.length - 3)) : 'UNKNOWN';
      return {
        maskedFt: masked,
        amount: tx.amount,
        sender: tx.sender_name || 'N/A',
        receiver: tx.receiver_name || 'N/A',
        receiverAccount: tx.receiver_account || 'N/A',
        settlementMatch: tx.settlement_matched,
        ticket: tx.lottery_ticket,
        time: tx.timestamp
      };
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
            ${req.query.error ? '<div class="msg msg-err">Invalid value. Please check your input.</div>' : ''}
            <form method="POST" action="/settings">
              <div class="settings-row">
                <label for="amount">Lottery Amount (ETB)</label>
                <input type="number" id="amount" name="amount" value="${currentAmount}" min="1" step="any" required>
              </div>
              <div class="settings-row" style="margin-top: 0.75rem;">
                <label for="suffix">CBE Account Suffix</label>
                <input type="text" id="suffix" name="cbe_account_suffix" value="${currentSuffix}" placeholder="8 digits" pattern="[0-9]{8}" maxlength="8" required>
              </div>
              <div class="settings-row" style="margin-top: 1rem;">
                <button type="submit">Save</button>
              </div>
            </form>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Transaction Ref</th>
                  <th>Sender</th>
                  <th>Receiver</th>
                  <th>Amount</th>
                  <th>Match</th>
                  <th>Lottery Ticket</th>
                </tr>
              </thead>
              <tbody>
                ${secureTx.map(tx => `
                  <tr>
                    <td><span style="font-family: monospace;">${tx.maskedFt}</span></td>
                    <td>${tx.sender}</td>
                    <td>${tx.receiver}</td>
                    <td>${tx.amount} ETB</td>
                    <td>${tx.settlementMatch ? '<span class="badge">Matched</span>' : '<span style="color: #dc2626; font-weight: 600;">Mismatch</span>'}</td>
                    <td><strong>${tx.ticket}</strong></td>
                  </tr>
                `).join('')}
                ${secureTx.length === 0 ? '<tr><td colspan="6" style="text-align: center;">No transactions yet.</td></tr>' : ''}
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
    const suffix = req.body.cbe_account_suffix?.trim();
    
    if (isNaN(amount) || amount <= 0) {
      return res.redirect('/?error=invalid');
    }
    if (!suffix || !/^\d{8}$/.test(suffix)) {
      return res.redirect('/?error=invalid_suffix');
    }
    
    await setSetting('lottery_amount', amount);
    await setSetting('cbe_account_suffix', suffix);
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
 * Verifies the receipt using Verify.ET API.
 * @param {string} ftCode 
 * @param {string} accountSuffix - 8-digit CBE account suffix
 * @returns {Promise<{isValid: boolean, data: object}>}
 */
async function verifyWithVerifyET(ftCode, accountSuffix) {
  try {
    const apiKey = process.env.VERIFY_ET_API_KEY;
    if (!apiKey && process.env.NODE_ENV !== 'test') {
      console.warn("WARNING: VERIFY_ET_API_KEY is not set!");
    }

    const idempotencyKey = `lottery_${ftCode}_${Date.now()}`;
    const payload = {
      bank: "cbe",
      referenceNumber: ftCode,
      accountSuffix: accountSuffix
    };

    console.log(`[VERIFY_ET] Verifying FT Code ${ftCode}...`);
    console.log(`[VERIFY_ET] Payload:`, JSON.stringify(payload));
    console.log(`[VERIFY_ET] API Key exists:`, !!apiKey);
    
    const response = await axios.post('https://verify.et/api/verify?waitMs=5000', payload, {
      headers: {
        'x-api-key': apiKey || 'mock_key',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      timeout: 15000
    });

    const body = response.data;
    
    // Handle queued response (202) - persist requestId and poll
    if (response.status === 202 || (body.verification && body.verification.processingStatus === 'queued')) {
      console.log(`[VERIFY_ET] Request queued (requestId: ${body.requestId}), polling...`);
      const requestId = body.requestId;
      const pollAfterMs = body.links?.pollAfterMs || 1500;
      
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, pollAfterMs));
        
        try {
          const pollRes = await axios.get(`https://verify.et/api/verify/${requestId}`, {
            headers: { 
              'x-api-key': apiKey || 'mock_key',
              'Accept': 'application/json'
            },
            timeout: 10000
          });
          
          const pollBody = pollRes.data;
          const status = pollBody.data || pollBody.verification;
          
          if (status.processingStatus === 'completed' || status.processingStatus === 'failed') {
            // Return the verification data from polling
            const verificationResult = pollBody.verification || status;
            return formatVerifyResult(verificationResult);
          }
          
          // Honor Retry-After header if present
          const retryAfter = pollRes.headers['retry-after'];
          if (retryAfter) {
            await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
          }
        } catch (pollErr) {
          console.error(`[VERIFY_ET] Poll error (attempt ${i + 1}):`, pollErr.message);
          if (pollErr.response?.status === 429) {
            const retryAfter = pollErr.response.headers['retry-after'] || 5;
            await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
          }
        }
      }
      return { isValid: false, data: null, error: 'Polling timed out', requestId };
    }

    // Handle immediate response (200)
    if (body.success && body.data && body.data.length > 0) {
      return formatVerifyResult(body.data[0]);
    }

    console.log(`[VERIFY_ET] ❌ Verification Failed:`, body.message);
    return { isValid: false, data: null, error: body.message };
  } catch (error) {
    console.error("[VERIFY_ET] Full error:", JSON.stringify(error.response?.data || error.message, null, 2));
    if (error.response) {
      // Handle specific error codes
      const errData = error.response.data;
      const errorMsg = errData?.error?.message || errData?.message || JSON.stringify(errData);
      if (errData?.error?.code === 'not_found') {
        return { isValid: false, data: null, error: 'Transaction not found. Please verify the FT code and try again.' };
      }
      if (errData?.error?.code === 'upstream_timeout') {
        return { isValid: false, data: null, error: 'Verification timed out. Please try again.' };
      }
      return { isValid: false, data: null, error: errorMsg };
    }
    console.error("[VERIFY_ET] API connection error:", error.message);
    return { isValid: false, data: null, error: 'Connection error. Please try again.' };
  }
}

/**
 * Format Verify.ET response into normalized structure
 * Handles both direct verification data and queued verification results
 */
function formatVerifyResult(verificationData) {
  const settlementMatch = verificationData.settlementAccountMatch;
  const confirmationHistory = verificationData.confirmationHistory;
  
  const result = {
    isValid: verificationData.verified === true,
    data: {
      senderName: verificationData.senderName || '',
      receiverName: verificationData.receiverName || '',
      receiverAccount: verificationData.receiverAccount || '',
      verifiedAmount: verificationData.amount || 0,
      txTimestamp: verificationData.timestamp || '',
      settlementMatched: settlementMatch ? settlementMatch.matched === true : false,
      matchReason: settlementMatch ? settlementMatch.reason : '',
      status: verificationData.status || '',
      currency: verificationData.currency || 'ETB',
      confirmedBefore: confirmationHistory ? confirmationHistory.confirmedBefore === true : false,
      confirmationCount: confirmationHistory ? confirmationHistory.confirmationCount || 0 : 0
    }
  };
  
  if (result.isValid) {
    console.log(`[VERIFY_ET] ✅ Verification Successful`);
    console.log(`[VERIFY_ET] Sender: ${result.data.senderName}`);
    console.log(`[VERIFY_ET] Receiver: ${result.data.receiverName} (${result.data.receiverAccount})`);
    console.log(`[VERIFY_ET] Amount: ${result.data.verifiedAmount} ${result.data.currency}`);
    console.log(`[VERIFY_ET] Settlement Match: ${result.data.settlementMatched}`);
    if (result.data.confirmedBefore) {
      console.log(`[VERIFY_ET] ⚠️ Duplicate confirmation detected (count: ${result.data.confirmationCount})`);
    }
  } else {
    console.log(`[VERIFY_ET] ❌ Verification Failed:`, verificationData.status);
  }
  
  return result;
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
    let ocrText = null;

    // Step 1: QR Scan
    const qrData = await scanQRCode(imagePath);
    if (qrData) {
      ftCode = extractFTCode(qrData);
    }

    // Step 2: OCR Fallback
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

    // Step 3: Verify with Verify.ET API
    const accountSuffix = await getSetting('cbe_account_suffix', '');
    console.log(`[SCANNER] Account suffix from settings: "${accountSuffix}"`);
    if (!accountSuffix) {
      return "⚠️ CBE Account Suffix is not configured. Please set it in the dashboard settings.";
    }

    const verification = await verifyWithVerifyET(ftCode, accountSuffix);
    
    let responseMessage = `✅ Receipt Identified!\nFT Code: ${ftCode}\n`;
    
    if (verification.isValid) {
      const vd = verification.data;
      
      // Check for duplicate confirmation
      if (vd.confirmedBefore) {
        responseMessage += `⚠️ Warning: This transaction has been confirmed before (${vd.confirmationCount} times).\n`;
      }
      
      // Check settlement match (receiver validation)
      if (!vd.settlementMatched) {
        responseMessage += `⚠️ Warning: Receiver does not match expected account.\n`;
        responseMessage += `   Received by: ${vd.receiverName} (${vd.receiverAccount})\n\n`;
      }
      
      responseMessage += `👤 Sender: ${vd.senderName}\n`;
      responseMessage += `🏦 Receiver: ${vd.receiverName} (${vd.receiverAccount})\n`;
      responseMessage += `💰 Amount: ${vd.verifiedAmount} ${vd.currency}\n`;
      responseMessage += `📅 Time: ${vd.txTimestamp}\n`;
      responseMessage += `🔒 Settlement Match: ${vd.settlementMatched ? '✅ Yes' : '⚠️ No'}\n\n`;
      
      try {
        const ticket = generateTicket();
        await insertTransaction(ftCode, userId, vd.verifiedAmount, ticket, {
          senderName: vd.senderName,
          receiverName: vd.receiverName,
          receiverAccount: vd.receiverAccount,
          verifiedAmount: vd.verifiedAmount,
          txTimestamp: vd.txTimestamp,
          settlementMatched: vd.settlementMatched
        });
        responseMessage += `🎉 Success! Your payment was verified.\n🎫 Your Lottery Ticket: ${ticket}\n`;
      } catch (dbErr) {
        if (dbErr.code === 'SQLITE_CONSTRAINT') {
          responseMessage += `⚠️ Warning: This receipt (${ftCode}) has already been used to claim a ticket!\n`;
        } else {
          responseMessage += `❌ Internal Database Error while saving your ticket.\n`;
          console.error("DB Error:", dbErr);
        }
      }
    } else {
      responseMessage += `❌ Verification Failed: ${verification.error || 'Unknown error'}\n\n`;
      responseMessage += `🔧 Debug Info:\n`;
      responseMessage += `FT Code: ${ftCode}\n`;
      responseMessage += `Account Suffix: ${accountSuffix}\n`;
      responseMessage += `API Key Set: ${!!process.env.VERIFY_ET_API_KEY}\n`;
    }

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

module.exports = { processReceipt, verifyWithVerifyET };
