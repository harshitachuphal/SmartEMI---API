
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { db, ready } = require("./database");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;

const validCallStatuses = ["answered", "not_answered", "completed"];

const validIntents = [
    "agree_to_pay",
    "promise_to_pay",
    "needs_more_time",
    "financial_difficulty",
    "already_paid",
    "wrong_number",
    "callback_later",
    "busy",
    "dispute",
    "no_account",
    "other"
];

// API authentication
function authenticate(req, res, next) {
    const key = req.headers["x-api-key"];

    if (!API_KEY || key !== API_KEY) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized access"
        });
    }

    next();
}

// Update borrower payment status after authorized verification
app.patch("/api/borrowers/:borrowerId/payment-status", authenticate, (req, res) => {
    const { paymentStatus } = req.body || {};
    const borrowerId = req.params.borrowerId;

    const allowedStatuses = ["Overdue", "Paid"];

    if (!allowedStatuses.includes(paymentStatus)) {
        return res.status(400).json({
            success: false,
            message: "Invalid payment status"
        });
    }

    db.run(
        "UPDATE borrowers SET paymentStatus = ? WHERE borrowerId = ?",
        [paymentStatus, borrowerId],
        function (err) {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Borrower not found"
                });
            }

            res.json({
                success: true,
                message: "Payment status updated successfully",
                borrowerId,
                paymentStatus
            });
        }
    );
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "SmartEMI API is running"
    });
});

// Fetch borrower details
app.get("/api/borrowers/:borrowerId", authenticate, (req, res) => {
    const borrowerId = req.params.borrowerId.trim();

    if (!borrowerId) {
        return res.status(400).json({
            success: false,
            message: "Borrower ID is required"
        });
    }

    const sql = `
        SELECT borrowerId, name, emiAmount, dueDate, paymentStatus
        FROM borrowers
        WHERE borrowerId = ?
    `;

    db.get(sql, [borrowerId], (err, borrower) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error"
            });
        }

        if (!borrower) {
            return res.status(404).json({
                success: false,
                message: "Borrower not found"
            });
        }

        res.json({
            success: true,
            data: borrower
        });
    });
});

// Save call outcome
app.post("/api/call-outcomes", authenticate, (req, res) => {
    const {
        borrowerId,
        callStatus,
        borrowerIntent,
        paymentCommitmentDate,
        paymentCommitmentAmount,
        callbackDateTime,
        humanAssistanceRequired
    } = req.body || {};

    // Required field validation
    if (
        typeof borrowerId !== "string" ||
        !borrowerId.trim() ||
        !callStatus ||
        !borrowerIntent
    ) {
        return res.status(400).json({
            success: false,
            message: "Borrower ID, call status and intent are required"
        });
    }

    // Validate call status
    if (!validCallStatuses.includes(callStatus)) {
        return res.status(400).json({
            success: false,
            message: "Invalid call status"
        });
    }

    // Validate borrower intent
    if (!validIntents.includes(borrowerIntent)) {
        return res.status(400).json({
            success: false,
            message: "Invalid borrower intent"
        });
    }

    // Validate payment amount
    if (
        paymentCommitmentAmount !== undefined &&
        paymentCommitmentAmount !== null &&
        (
            typeof paymentCommitmentAmount !== "number" ||
            !Number.isFinite(paymentCommitmentAmount) ||
            paymentCommitmentAmount <= 0
        )
    ) {
        return res.status(400).json({
            success: false,
            message: "Payment commitment amount must be a positive number"
        });
    }

    // Validate human assistance field
    if (
        humanAssistanceRequired !== undefined &&
        typeof humanAssistanceRequired !== "boolean"
    ) {
        return res.status(400).json({
            success: false,
            message: "Human assistance field must be true or false"
        });
    }

    // Check whether borrower exists
    db.get(
        "SELECT borrowerId FROM borrowers WHERE borrowerId = ?",
        [borrowerId.trim()],
        (lookupError, borrower) => {
            if (lookupError) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            if (!borrower) {
                return res.status(404).json({
                    success: false,
                    message: "Borrower not found"
                });
            }

            const sql = `
                INSERT INTO call_outcomes (
                    borrowerId, callStatus, borrowerIntent,
                    paymentCommitmentDate, paymentCommitmentAmount,
                    callbackDateTime, humanAssistanceRequired
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                borrowerId.trim(),
                callStatus,
                borrowerIntent,
                paymentCommitmentDate || null,
                paymentCommitmentAmount ?? null,
                callbackDateTime || null,
                humanAssistanceRequired ? 1 : 0
            ];

            db.run(sql, values, function (err) {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Could not save call outcome"
                    });
                }

                res.status(201).json({
                    success: true,
                    message: "Call outcome saved successfully",
                    data: {
                        id: this.lastID,
                        borrowerId: borrowerId.trim(),
                        callStatus,
                        borrowerIntent,
                        paymentCommitmentDate: paymentCommitmentDate || null,
                        paymentCommitmentAmount: paymentCommitmentAmount ?? null,
                        callbackDateTime: callbackDateTime || null,
                        humanAssistanceRequired: Boolean(humanAssistanceRequired)
                    }
                });
            });
        }
    );
});

// View saved outcomes
app.get("/api/call-outcomes", authenticate, (req, res) => {
    db.all(
        "SELECT * FROM call_outcomes ORDER BY id DESC",
        [],
        (err, outcomes) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            res.json({
                success: true,
                data: outcomes
            });
        }
    );
});

// Start server after database initialization
ready.then(() => {
    app.listen(PORT, () => {
        console.log("SmartEMI database connected successfully!");
        console.log(`SmartEMI API running on port ${PORT}`);
    });
}).catch((err) => {
    console.error("Database initialization failed:", err);
});
