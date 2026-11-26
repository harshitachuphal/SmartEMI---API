
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "smartemi.db");

const db = new sqlite3.Database(dbPath);

const ready = new Promise((resolve, reject) => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS borrowers (
                borrowerId TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                emiAmount REAL NOT NULL,
                dueDate TEXT NOT NULL,
                paymentStatus TEXT NOT NULL
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS call_outcomes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                borrowerId TEXT NOT NULL,
                callStatus TEXT NOT NULL,
                borrowerIntent TEXT NOT NULL,
                paymentCommitmentDate TEXT,
                paymentCommitmentAmount REAL,
                callbackDateTime TEXT,
                humanAssistanceRequired INTEGER DEFAULT 0,
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const insert = db.prepare(`
            INSERT OR IGNORE INTO borrowers
            (borrowerId, name, emiAmount, dueDate, paymentStatus)
            VALUES (?, ?, ?, ?, ?)
        `);

        insert.run("B001", "Rahul Sharma", 5000, "2026-11-20", "Overdue");
        insert.run("B002", "Priya Verma", 3500, "2026-11-22", "Overdue");

        insert.finalize((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
});

module.exports = { db, ready };
