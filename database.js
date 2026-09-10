const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.json');

// Initialize database file if it doesn't exist
function initDb() {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify([], null, 2), 'utf8');
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Inserts a transaction into the database
 * @param {string} transactionRef 
 * @param {number} userId 
 * @param {number} amount 
 * @param {string} lotteryTicket 
 * @returns {Promise<void>}
 */
function insertTransaction(transactionRef, userId, amount, lotteryTicket) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(dbPath)) {
        // Create if missing just to be safe
        fs.writeFileSync(dbPath, JSON.stringify([], null, 2), 'utf8');
      }
      
      const data = fs.readFileSync(dbPath, 'utf8');
      const transactions = JSON.parse(data || '[]');
      
      // Check for duplicate transaction_ref (simulate UNIQUE constraint)
      const exists = transactions.some(t => t.transaction_ref === transactionRef);
      if (exists) {
        // Return a mock SQLITE_CONSTRAINT error to match previous behavior
        const err = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.transaction_ref');
        err.code = 'SQLITE_CONSTRAINT';
        return reject(err);
      }
      
      const newTx = {
        transaction_ref: transactionRef,
        user_id: userId,
        amount: amount,
        lottery_ticket: lotteryTicket,
        timestamp: new Date().toISOString()
      };
      
      transactions.push(newTx);
      
      fs.writeFileSync(dbPath, JSON.stringify(transactions, null, 2), 'utf8');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
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
  dbPath // Exporting path for tests
};
