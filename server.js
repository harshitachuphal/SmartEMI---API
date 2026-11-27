
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { db, ready } = require("./database");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;

// Allowed call statuses
const validCallStatuses = [
    "answered",
    "not_answered",
    "completed"
];

// Allowed borrower intents
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

// API authentication middleware
function authenticate(req, res, next) {
    const providedKey = req.headers["x-api-key"];

    if (!API_KEY || providedKey !== API_KEY) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized access"
        });
    }

    next();
}

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "SmartEMI API is running"
    });
});

// Fetch borrower details
app.get("/api/borrowers/:borrowerId", authenticate, (req, res) => {
    const borrowerId = req.params.borrowerId;

    db.get(
        "SELECT * FROM borrowers WHERE borrowerId = ?",
        [borrowerId],
        (err, borrower) => {
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
        }
    );
});

// Update borrower payment status
app.patch(
    "/api/borrowers/:borrowerId/payment-status",
    authenticate,
    (req, res) => {
        const borrowerId = req.params.borrowerId;
        const { paymentStatus } = req.body;

        if (!paymentStatus || typeof paymentStatus !== "string") {
            return res.status(400).json({
                success: false,
                message: "Valid payment status is required"
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
                    message: "Payment status updated successfully"
                });
            }
        );
    }
);

// Save call outcome
app.post("/api/call-outcomes", authenticate, (req, res) => {
    console.log("POST CALL OUTCOME PAYLOAD:", JSON.stringify(req.body));
    const body = req.body || {};
    const data = body.data || body;

    const borrowerId =
        data.borrowerId ||
        data.borrowerID ||
        data.borrower_id;

    const callStatus =
        data.callStatus ||
        data.call_status;

    const borrowerIntent =
        data.borrowerIntent ||
        data.disposition ||
        data.DISPOSITION;

    const paymentCommitmentDate =
        data.paymentCommitmentDate ||
        data.payment_commitment_date ||
        null;

    const rawAmount =
        data.paymentCommitmentAmount ??
        data.payment_commitment_amount ??
        null;

    const callbackDateTime =
        data.callbackDateTime ||
        data.callbackDatetime ||
        data.callback_datetime ||
        null;

    const humanAssistanceRequired =
        data.humanAssistanceRequired ??
        data.human_assistance_required ??
        false;

    // Convert amount such as "5,000 rupees" into a number
    let paymentCommitmentAmount = null;

    if (rawAmount !== null && rawAmount !== "") {
        if (typeof rawAmount === "number") {
            paymentCommitmentAmount = rawAmount;
        } else {
            const cleanedAmount = String(rawAmount).replace(/,/g, "");
            const match = cleanedAmount.match(/\d+(\.\d+)?/);

            if (!match) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid payment commitment amount"
                });
            }

            paymentCommitmentAmount = Number(match[0]);
        }
    }

    // Validate required fields
    if (
        typeof borrowerId !== "string" ||
        !borrowerId.trim() ||
        !callStatus ||
        !borrowerIntent
    ) {
        return res.status(400).json({
            success: false,
            message: "Borrower ID, call status and intent are required",
            receivedFields: Object.keys(data)
        });
    }

    if (!validCallStatuses.includes(callStatus)) {
        return res.status(400).json({
            success: false,
            message: "Invalid call status"
        });
    }

    if (!validIntents.includes(borrowerIntent)) {
        return res.status(400).json({
            success: false,
            message: "Invalid borrower intent"
        });
    }

    if (
        paymentCommitmentAmount !== null &&
        (!Number.isFinite(paymentCommitmentAmount) ||
            paymentCommitmentAmount <= 0)
    ) {
        return res.status(400).json({
            success: false,
            message: "Payment amount must be positive"
        });
    }

    if (
        typeof humanAssistanceRequired !== "boolean" &&
        humanAssistanceRequired !== 0 &&
        humanAssistanceRequired !== 1
    ) {
        return res.status(400).json({
            success: false,
            message: "Human assistance must be true or false"
        });
    }

    // Verify borrower exists
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
                    borrowerId,
                    callStatus,
                    borrowerIntent,
                    paymentCommitmentDate,
                    paymentCommitmentAmount,
                    callbackDateTime,
                    humanAssistanceRequired
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                borrowerId.trim(),
                callStatus,
                borrowerIntent,
                paymentCommitmentDate,
                paymentCommitmentAmount,
                callbackDateTime,
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
                        paymentCommitmentDate,
                        paymentCommitmentAmount,
                        callbackDateTime,
                        humanAssistanceRequired: Boolean(
                            humanAssistanceRequired
                        )
                    }
                });
            });
        }
    );
});

// Fetch saved call outcomes
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
                count: outcomes.length,
                data: outcomes
            });
        }
    );
});

// Start server after database initialization
ready
    .then(() => {
        app.listen(PORT, () => {
            console.log("SmartEMI database connected successfully!");
            console.log(`SmartEMI API running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error("Database initialization failed:", err);
        process.exit(1);
    });
