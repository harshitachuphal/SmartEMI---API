
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath =
    process.env.DB_PATH || path.join(__dirname, "smartemi.db");

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function addColumnIfMissing(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    const exists = columns.some((item) => item.name === column);

    if (!exists) {
        await run(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
    }
}

const ready = (async () => {
    await run(`
        CREATE TABLE IF NOT EXISTS borrowers (
            borrowerId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            emiAmount REAL NOT NULL,
            dueDate TEXT NOT NULL,
            paymentStatus TEXT NOT NULL
        )
    `);

    await run(`
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

    // Safely upgrade existing databases without deleting old records.
    await addColumnIfMissing(
        "call_outcomes",
        "reasonForDelay",
        "TEXT"
    );

    await addColumnIfMissing(
        "call_outcomes",
        "emiAmountDiscussed",
        "TEXT"
    );

    await addColumnIfMissing(
        "call_outcomes",
        "conversationId",
        "TEXT"
    );

    // One outcome per Inya conversation.
    await run(`
        CREATE UNIQUE INDEX IF NOT EXISTS
        idx_call_outcomes_conversation
        ON call_outcomes(conversationId)
        WHERE conversationId IS NOT NULL
          AND conversationId != ''
    `);

    await run(`
        INSERT OR IGNORE INTO borrowers
        (borrowerId, name, emiAmount, dueDate, paymentStatus)
        VALUES (?, ?, ?, ?, ?)
    `, ["B001", "Rahul Sharma", 5000, "2026-11-20", "Overdue"]);

    await run(`
        INSERT OR IGNORE INTO borrowers
        (borrowerId, name, emiAmount, dueDate, paymentStatus)
        VALUES (?, ?, ?, ?, ?)
    `, ["B002", "Priya Verma", 3500, "2026-11-22", "Overdue"]);

    console.log("Database initialized and migrations completed.");
})();

module.exports = { db, ready };
