require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, insertTransaction, generateTicket, Transaction } = require('./database');
const express = require('express');
const helmet = require('helmet');
const webApp = express();

webApp.use(helmet());
webApp.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'");
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// XSS Prevention Helper
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

webApp.get('/', async (req, res) => {
  try {
    const totalTx = await Transaction.countDocuments();
    
    const result = await Transaction.aggregate([
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } }
    ]);
    const totalAmount = result.length > 0 ? result[0].totalAmount : 0;
    
    const recentTx = await Transaction.find().sort({ timestamp: -1 }).limit(10);
    const currentAmount = process.env.LOTTERY_AMOUNT || 100;
    
    // Mask references for security (PII Masking)
    const secureTx = recentTx.map(tx => {
      const ref = tx.transaction_ref;
      const masked = ref && ref.length > 6 ? (ref.substring(0, 3) + '***' + ref.substring(ref.length - 3)) : 'UNKNOWN';
      return {
        maskedRef: escapeHTML(masked),
        amount: escapeHTML(tx.amount),
        sender: escapeHTML(tx.sender_name || 'N/A'),
        receiver: escapeHTML(tx.receiver_name || 'N/A'),
        receiverAccount: escapeHTML(tx.receiver_account || 'N/A'),
        settlementMatch: tx.settlement_matched,
        ticket: escapeHTML(tx.lottery_ticket),
        time: escapeHTML(new Date(tx.timestamp).toLocaleString())
      };
    });

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Wavemart Enterprise Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #6366f1;
            --primary-light: #818cf8;
            --bg-gradient-start: #0f172a;
            --bg-gradient-end: #1e1b4b;
            --glass-bg: rgba(255, 255, 255, 0.05);
            --glass-border: rgba(255, 255, 255, 0.1);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
          }
          body { 
            font-family: 'Inter', sans-serif; 
            background: linear-gradient(135deg, var(--bg-gradient-start), var(--bg-gradient-end));
            color: var(--text-main); 
            padding: 2rem; 
            margin: 0; 
            min-height: 100vh;
          }
          .container { max-width: 1100px; margin: 0 auto; }
          .header { 
            text-align: center; 
            margin-bottom: 3rem; 
            animation: fadeInDown 0.8s ease;
          }
          .header h1 {
            font-size: 2.5rem;
            background: linear-gradient(to right, #818cf8, #c084fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
          }
          .header p { color: var(--text-muted); font-size: 1.1rem; }
          
          .glass-panel {
            background: var(--glass-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--glass-border);
            border-radius: 1rem;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
          }
          
          .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 1.5rem; 
            margin-bottom: 3rem; 
          }
          .stat-card { 
            padding: 2rem; 
            text-align: center; 
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.4);
            border-color: rgba(255,255,255,0.2);
          }
          .stat-value { 
            font-size: 3rem; 
            font-weight: 700; 
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .stat-label { 
            font-size: 0.9rem; 
            color: var(--text-muted); 
            text-transform: uppercase; 
            letter-spacing: 0.1em; 
            margin-top: 0.75rem; 
          }
          
          .table-container { 
            overflow-x: auto; 
            padding: 1rem;
          }
          .table-header {
            padding: 1rem 1.5rem;
            font-size: 1.25rem;
            font-weight: 600;
            border-bottom: 1px solid var(--glass-border);
          }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 1.25rem 1.5rem; text-align: left; border-bottom: 1px solid var(--glass-border); }
          th { font-weight: 600; color: var(--text-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
          tr { transition: background-color 0.2s ease; }
          tr:hover { background: rgba(255, 255, 255, 0.03); }
          
          .badge { 
            padding: 0.35rem 0.75rem; 
            border-radius: 9999px; 
            font-size: 0.75rem; 
            font-weight: 600; 
            letter-spacing: 0.05em;
          }
          .badge-matched { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
          .badge-error { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
          
          .ticket-code {
            font-family: monospace;
            background: rgba(255,255,255,0.1);
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            color: #c084fc;
          }

          @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Wavemart Enterprise</h1>
            <p>Live Secure Transaction Auditing & Lottery System</p>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card glass-panel">
              <div class="stat-value">${escapeHTML(totalTx)}</div>
              <div class="stat-label">Verified Tickets Issued</div>
            </div>
            <div class="stat-card glass-panel">
              <div class="stat-value">${escapeHTML(totalAmount.toLocaleString())} ETB</div>
              <div class="stat-label">Total Verified Revenue</div>
            </div>
          </div>

          <div class="glass-panel">
            <div class="table-header">Recent Transactions</div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Sender</th>
                    <th>Receiver</th>
                    <th>Amount</th>
                    <th>Security Match</th>
                    <th>Issued Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  ${secureTx.map(tx => `
                    <tr>
                      <td><span style="font-family: monospace; color: #94a3b8;">${tx.maskedRef}</span></td>
                      <td>${tx.sender}</td>
                      <td>${tx.receiver} <br><span style="font-size: 0.75rem; color: #64748b;">${tx.receiverAccount}</span></td>
                      <td style="font-weight: 600;">${tx.amount} ETB</td>
                      <td>${tx.settlementMatch ? '<span class="badge badge-matched">VERIFIED</span>' : '<span class="badge badge-error">MISMATCH</span>'}</td>
                      <td><span class="ticket-code">${tx.ticket}</span></td>
                    </tr>
                  `).join('')}
                  ${secureTx.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem;">No secure transactions processed yet.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
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
      console.log(`[SCANNER] QR Code Data Found!`);
      return code.data;
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
    console.log(`[SCANNER] OCR extraction complete.`);
    return text;
  } catch (error) {
    console.error("Error in OCR:", error.message);
    return null;
  }
}

/**
 * Verifies the receipt using Verify.ET API in Universal Mode
 * @param {string} referenceText - The raw text from OCR or QR
 * @returns {Promise<{isValid: boolean, data: object, error: string}>}
 */
async function verifyWithVerifyET(referenceText) {
  try {
    const apiKey = process.env.VERIFY_ET_API_KEY;
    if (!apiKey && process.env.NODE_ENV !== 'test') {
      console.warn("WARNING: VERIFY_ET_API_KEY is not set!");
    }

    // Create a stable idempotency key based on the text hash to prevent double-charging the exact same image content
    const hash = crypto.createHash('sha256').update(referenceText).digest('hex');
    const idempotencyKey = `tx_${hash}`;
    
    const payload = {
      reference: referenceText
    };

    console.log(`[VERIFY_ET] Sending Universal Verification Request...`);
    
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
      const pollAfterMs = body.links?.pollAfterMs || 2000;
      
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
            return formatVerifyResult(status.result || status);
          }
          
          const retryAfter = pollRes.headers['retry-after'];
          if (retryAfter) {
            await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
          }
        } catch (pollErr) {
          if (pollErr.response?.status === 429) {
            const retryAfter = pollErr.response.headers['retry-after'] || 5;
            await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
          }
        }
      }
      return { isValid: false, data: null, error: 'Provider verification timed out.' };
    }

    // Handle immediate response (200)
    if (body.success && body.data && body.data.length > 0) {
      return formatVerifyResult(body.data[0]);
    }
    
    return { isValid: false, data: null, error: body.message || 'Invalid receipt format.' };
  } catch (error) {
    if (error.response) {
      const errData = error.response.data;
      const errorMsg = errData?.error?.message || errData?.message || 'Verification failed';
      if (errData?.error?.code === 'not_found') {
        return { isValid: false, data: null, error: 'Transaction not found in the banking system.' };
      }
      if (errData?.error?.code === 'upstream_timeout') {
        return { isValid: false, data: null, error: 'Bank system timed out. Please try again later.' };
      }
      if (error.response.status === 409) {
        return { isValid: false, data: null, error: 'This receipt was already submitted recently.' };
      }
      return { isValid: false, data: null, error: errorMsg };
    }
    return { isValid: false, data: null, error: 'Secure connection error.' };
  }
}

/**
 * Format Verify.ET response into normalized structure
 */
function formatVerifyResult(verificationData) {
  const settlementMatch = verificationData.settlementAccountMatch;
  const confirmationHistory = verificationData.confirmationHistory;
  
  const result = {
    isValid: verificationData.verified === true,
    data: {
      transactionRef: verificationData.referenceNumber || verificationData.receiptNumber || verificationData.requestId || crypto.randomUUID(),
      senderName: verificationData.senderName || (verificationData.bankSpecific ? verificationData.bankSpecific.senderName : ''),
      receiverName: verificationData.receiverName || '',
      receiverAccount: verificationData.receiverAccount || (verificationData.bankSpecific ? verificationData.bankSpecific.receiverAccount : ''),
      verifiedAmount: verificationData.amount || 0,
      txTimestamp: verificationData.timestamp || new Date().toISOString(),
      settlementMatched: settlementMatch ? settlementMatch.matched === true : false,
      matchReason: settlementMatch ? settlementMatch.reason : '',
      status: verificationData.status || '',
      currency: verificationData.currency || 'ETB',
      confirmedBefore: confirmationHistory ? confirmationHistory.confirmedBefore === true : false,
      confirmationCount: confirmationHistory ? confirmationHistory.confirmationCount || 0 : 0
    }
  };
  return result;
}

// Telegram MarkdownV2 Escaping Helper
function escMd(text) {
  if (!text) return '';
  return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Core validation logic.
 */
async function processReceipt(imagePath, userId) {
  try {
    let extractedText = null;

    // Step 1: Try QR Scan first
    extractedText = await scanQRCode(imagePath);

    // Step 2: Fallback to OCR if QR fails
    if (!extractedText) {
      extractedText = await performOCR(imagePath);
    }

    if (!extractedText || extractedText.trim() === '') {
      return "🚫 *Error: Unreadable Image*\n\nI couldn't extract any text or QR code from that image\\. Please make sure it is a clear, uncropped screenshot of your bank receipt\\.";
    }
    
    // Step 3: Throw raw text to Verify.et Universal Mode
    const verification = await verifyWithVerifyET(extractedText);
    
    if (verification.isValid) {
      const vd = verification.data;
      
      // Strict Security: Duplicate check
      if (vd.confirmedBefore) {
        return `⚠️ *Security Alert: Duplicate Receipt*\n\nThis transaction has already been confirmed and processed by our system\\.\n_Attempts are logged\\._`;
      }
      
      // Strict Security: Settlement Match check against Dashboard Registry
      if (!vd.settlementMatched) {
        return `⚠️ *Verification Failed: Unauthorized Deposit*\n\nThe transaction is valid, but the funds were *not* deposited into our registered settlement account\\.\n\n*Destination Detected:* ${escMd(vd.receiverName)} \\(${escMd(vd.receiverAccount)}\\)`;
      }
      
      // Verification Passed securely!
      try {
        const ticket = generateTicket();
        await insertTransaction(vd.transactionRef, userId, vd.verifiedAmount, ticket, {
          senderName: vd.senderName,
          receiverName: vd.receiverName,
          receiverAccount: vd.receiverAccount,
          verifiedAmount: vd.verifiedAmount,
          txTimestamp: vd.txTimestamp,
          settlementMatched: vd.settlementMatched
        });
        
        let responseMessage = `✅ *Payment Successfully Verified*\n\n`;
        responseMessage += `👤 *Sender:* ${escMd(vd.senderName)}\n`;
        responseMessage += `💰 *Amount:* ${escMd(vd.verifiedAmount)} ${escMd(vd.currency)}\n`;
        responseMessage += `📅 *Date:* ${escMd(new Date(vd.txTimestamp).toLocaleString())}\n\n`;
        responseMessage += `🎉 *Your Lottery Ticket:*\n\`${escMd(ticket)}\`\n\n`;
        responseMessage += `_Thank you for participating\\! Keep this ticket code safe\\._`;
        
        return responseMessage;
      } catch (dbErr) {
        if (dbErr.code === 'SQLITE_CONSTRAINT' || dbErr.message.includes('E11000')) {
          return `⚠️ *Duplicate Entry*\n\nThis exact transaction reference \\(${escMd(vd.transactionRef)}\\) has already been used to claim a ticket in our database\\!`;
        } else {
          console.error("DB Error:", dbErr);
          return `❌ *System Error*\n\nYour receipt was verified, but a database error occurred while generating your ticket\\. Please contact support\\.`;
        }
      }
    } else {
      return `❌ *Verification Failed*\n\n${escMd(verification.error)}\n\n_Please ensure the screenshot is genuine and clearly shows the transaction details\\._`;
    }

  } catch (err) {
    console.error("Error processing receipt:", err);
    return "❌ *Internal Error*\n\nAn unexpected error occurred while communicating with the bank servers\\. Please try again later\\.";
  }
}

bot.on('photo', async (ctx) => {
  let localFilePath = null;
  try {
    const photos = ctx.message.photo;
    const highestResPhoto = photos[photos.length - 1];
    
    const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
    
    const safeExt = path.extname(fileLink.href).split('?')[0]; 
    const tempFileName = crypto.randomUUID() + (safeExt || '.jpg');
    localFilePath = path.join(tempDir, tempFileName);

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

    // Send professional waiting message
    const msg = await ctx.reply("🔍 *Analyzing receipt\\.\\.\\.*\n_Communicating with secure banking endpoints\\._", { parse_mode: 'MarkdownV2' });
    
    const userId = ctx.from.id;
    const resultMsg = await processReceipt(localFilePath, userId);
    
    // Update the message with the final result
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, resultMsg, { parse_mode: 'MarkdownV2' });

  } catch (error) {
    console.error(error);
    ctx.reply("❌ *Error*\n\nFailed to download or process your image\\. Please try again\\.", { parse_mode: 'MarkdownV2' });
  } finally {
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (err) {
        console.error(`Failed to delete temp file ${localFilePath}:`, err);
      }
    }
  }
});

bot.command('start', (ctx) => {
  ctx.reply("👋 *Welcome to Wavemart Lottery!*\n\nTo participate, simply upload a clear screenshot of your bank receipt \\(CBE, Telebirr, etc\\.\\)\\.\n\nOur secure system will automatically verify your payment and issue your lottery ticket\\!", { parse_mode: 'MarkdownV2' });
});

const WEB_PORT = process.env.PORT || 8080;

if (process.env.NODE_ENV !== 'test') {
  initDb().catch(err => console.error("Failed to initialize database:", err));
  
  bot.launch();
  console.log("Telegram Bot started in Secure Mode.");
  
  webApp.listen(WEB_PORT, () => {
    console.log("Web Enterprise dashboard running on port " + WEB_PORT);
  });
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { processReceipt, verifyWithVerifyET };
