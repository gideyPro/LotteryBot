const mongoose = require('mongoose');

// Connect to MongoDB Atlas
async function initDb() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB Atlas successfully.");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    throw err;
  }
}

// Define the schema
const transactionSchema = new mongoose.Schema({
  transaction_ref: { type: String, required: true, unique: true },
  user_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  lottery_ticket: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Settings schema for dashboard config
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const Settings = mongoose.model('Settings', settingsSchema);

async function getSetting(key, defaultValue) {
  const doc = await Settings.findOne({ key });
  return doc ? doc.value : defaultValue;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

/**
 * Inserts a transaction into the database
 * @param {string} transactionRef 
 * @param {number} userId 
 * @param {number} amount 
 * @param {string} lotteryTicket 
 * @returns {Promise<void>}
 */
async function insertTransaction(transactionRef, userId, amount, lotteryTicket) {
  try {
    const newTx = new Transaction({
      transaction_ref: transactionRef,
      user_id: userId,
      amount: amount,
      lottery_ticket: lotteryTicket
    });
    
    await newTx.save();
  } catch (err) {
    if (err.code === 11000) {
      // Simulate the SQLITE_CONSTRAINT for double spend backward compatibility
      const error = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.transaction_ref');
      error.code = 'SQLITE_CONSTRAINT';
      throw error;
    }
    throw err;
  }
}

function generateTicket() {
  // Generate random 6 character alphanumeric ticket
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `LOTO-${randomStr}`;
}

module.exports = {
  initDb,
  insertTransaction,
  generateTicket,
  Transaction,
  Settings,
  getSetting,
  setSetting
};
