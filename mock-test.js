// mock-test.js
process.env.NODE_ENV = 'test'; // Ensure bot doesn't start

const { initDb, insertTransaction } = require('./database');
const bot = require('./app');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Mock data
const MOCK_FT_CODE = 'FT123456789';
const MOCK_HTML = `
  <html>
    <body>
      <table>
        <tr>
          <td>Amount</td>
          <td>100.00</td>
        </tr>
        <tr>
          <td>Credited Account</td>
          <td>1000123456789</td>
        </tr>
      </table>
    </body>
  </html>
`;

// Override axios.post to simulate ShegerPay API
axios.post = async (url, payload, options) => {
  console.log(`[MOCK] axios.post called for URL: ${url}`);
  
  if (url.includes('verify-image')) {
    console.log(`[MOCK] Image upload simulated.`);
    return { data: { verified: true, data: { amount: 100, sender: "Mock User" } } };
  }
  
  console.log(`[MOCK] Payload:`, payload);
  return { data: { verified: true, data: { amount: payload.amount } } };
};

// We will test verifyWithShegerPay directly, then test the DB double spend.
async function runTests() {
  console.log("=== Starting Local Mock Tests ===");
  
  // 1. Init Database (clear old JSON file if exists for clean test)
  const { dbPath } = require('./database');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  
  await initDb();
  console.log("✅ Database Initialized.");

  // 2. Test ShegerPay API with dummy payload
  console.log("--- Testing ShegerPay API Integration ---");
  const verification = await bot.verifyWithShegerPay(MOCK_FT_CODE, 100.00);
  
  if (verification.isValid && verification.amount === 100.00) {
    console.log("✅ ShegerPay API extracted values correctly.");
  } else {
    console.error("❌ ShegerPay API failed to extract values.", verification);
    process.exit(1);
  }

  // 3. Test Database Ticketing & Double Spend Protection
  console.log("--- Testing Database Double Spend ---");
  const userId = 999;
  const mockTicket = 'LOTO-MOCK12';

  // First insert (should succeed)
  try {
    await insertTransaction(MOCK_FT_CODE, userId, verification.amount, mockTicket);
    console.log(`✅ First insert successful for ${MOCK_FT_CODE}`);
  } catch (err) {
    console.error(`❌ First insert failed:`, err);
    process.exit(1);
  }

  // Second insert (should fail with constraint error)
  try {
    await insertTransaction(MOCK_FT_CODE, userId, verification.amount, mockTicket);
    console.error(`❌ Second insert SUCCEEDED - Double spend protection FAILED!`);
    process.exit(1);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      console.log(`✅ Double spend protection working. Caught SQLite constraint error: ${err.message}`);
    } else {
      console.error(`❌ Unexpected error on second insert:`, err);
      process.exit(1);
    }
  }

  console.log("=== All Mock Tests Passed ===");
  process.exit(0);
}

runTests();
