// mock-test.js
require('dotenv').config();
process.env.NODE_ENV = 'test'; // Ensure bot doesn't start

const { initDb, insertTransaction, Transaction } = require('./database');
const bot = require('./app');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Mock data
const MOCK_FT_CODE = 'FT123456789';
const MOCK_ACCOUNT_SUFFIX = '12345678';

// Override axios.post to simulate Verify.ET API
axios.post = async (url, payload, options) => {
  console.log(`[MOCK] axios.post called for URL: ${url}`);
  console.log(`[MOCK] Payload:`, payload);
  
  return {
    data: {
      success: true,
      message: "Transaction verified successfully.",
      data: [{
        bank: "cbe",
        status: "success",
        verified: true,
        amount: 500,
        currency: "ETB",
        senderName: "MOCK SENDER",
        receiverName: "MOCK RECEIVER",
        receiverAccount: "1****5678",
        referenceNumber: MOCK_FT_CODE,
        accountSuffix: MOCK_ACCOUNT_SUFFIX,
        timestamp: "2026-09-12T10:00:00.000Z",
        settlementAccountMatch: {
          matched: true,
          matchConfidence: "high",
          reason: "receiver_mask_matches_visible_digits"
        }
      }]
    }
  };
};

// Override axios.get for polling
axios.get = async (url, options) => {
  console.log(`[MOCK] axios.get called for URL: ${url}`);
  return {
    data: {
      success: true,
      data: {
        processingStatus: "completed",
        status: "success",
        verified: true
      }
    }
  };
};

// We will test verifyWithVerifyET directly, then test the DB double spend.
async function runTests() {
  console.log("=== Starting Local Mock Tests ===");
  
  // 1. Init Database (clear old DB for clean test)
  await initDb();
  await Transaction.deleteMany({});
  console.log("✅ Database Initialized.");

  // 2. Test Verify.ET API with dummy payload
  console.log("--- Testing Verify.ET API Integration ---");
  const verification = await bot.verifyWithVerifyET(MOCK_FT_CODE, MOCK_ACCOUNT_SUFFIX);
  
  if (verification.isValid && verification.data.verifiedAmount === 500) {
    console.log("✅ Verify.ET API extracted values correctly.");
    console.log(`   Sender: ${verification.data.senderName}`);
    console.log(`   Receiver: ${verification.data.receiverName}`);
    console.log(`   Settlement Match: ${verification.data.settlementMatched}`);
  } else {
    console.error("❌ Verify.ET API failed to extract values.", verification);
    process.exit(1);
  }

  // 3. Test Database Ticketing & Double Spend Protection
  console.log("--- Testing Database Double Spend ---");
  const userId = 999;
  const mockTicket = 'LOTO-MOCK12';

  // First insert (should succeed)
  try {
    await insertTransaction(MOCK_FT_CODE, userId, verification.data.verifiedAmount, mockTicket, {
      senderName: verification.data.senderName,
      receiverName: verification.data.receiverName,
      receiverAccount: verification.data.receiverAccount,
      verifiedAmount: verification.data.verifiedAmount,
      txTimestamp: verification.data.txTimestamp,
      settlementMatched: verification.data.settlementMatched
    });
    console.log(`✅ First insert successful for ${MOCK_FT_CODE}`);
  } catch (err) {
    console.error(`❌ First insert failed:`, err);
    process.exit(1);
  }

  // Second insert (should fail with constraint error)
  try {
    await insertTransaction(MOCK_FT_CODE, userId, verification.data.verifiedAmount, mockTicket, {
      senderName: verification.data.senderName,
      receiverName: verification.data.receiverName,
      receiverAccount: verification.data.receiverAccount,
      verifiedAmount: verification.data.verifiedAmount,
      txTimestamp: verification.data.txTimestamp,
      settlementMatched: verification.data.settlementMatched
    });
    console.error(`❌ Second insert SUCCEEDED - Double spend protection FAILED!`);
    process.exit(1);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      console.log(`✅ Double spend protection working. Caught constraint error: ${err.message}`);
    } else {
      console.error(`❌ Unexpected error on second insert:`, err);
      process.exit(1);
    }
  }

  console.log("=== All Mock Tests Passed ===");
  process.exit(0);
}

runTests();
