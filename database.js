const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'lottery.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `CREATE TABLE IF NOT EXISTS transactions (
          transaction_ref TEXT PRIMARY KEY,
          user_id INTEGER,
          amount REAL,
          lottery_ticket TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  });
}

/**
 * Inserts a transaction into the database securely using parameterized queries.
 * @param {string} transactionRef 
 * @param {number} userId 
 * @param {number} amount 
 * @param {string} lotteryTicket 
 * @returns {Promise<void>}
 */
function insertTransaction(transactionRef, userId, amount, lotteryTicket) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      `INSERT INTO transactions (transaction_ref, user_id, amount, lottery_ticket)
       VALUES (?, ?, ?, ?)`
    );

    stmt.run([transactionRef, userId, amount, lotteryTicket], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });

    stmt.finalize();
  });
}

function generateTicket() {
  // Generate random 6 character alphanumeric ticket
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `LOTO-${randomStr}`;
}

module.exports = {
  db,
  initDb,
  insertTransaction,
  generateTicket
};
