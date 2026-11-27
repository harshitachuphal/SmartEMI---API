
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
    "completed",
    "unknown"
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

// Save call outcome from Inya post-call payload
app.post("/api/call-outcomes", authenticate, (req, res) => {
    console.log(
        "POST CALL OUTCOME PAYLOAD:",
        JSON.stringify(req.body)
    );

    const body = req.body || {};

    const extraction =
        body.post_call_extraction_v2 ||
        body.disposition_result ||
        body.data?.post_call_extraction_v2 ||
        body.data?.disposition_result ||
        body.data ||
        {};

    const userContext = body.user_context || {};

    // Borrower ID comes from call context, not from the borrower
    const borrowerId =
        body.borrowerId ||
        body.borrowerID ||
        body.borrower_id ||
        userContext.borrowerId ||
        userContext.borrowerID ||
        extraction.borrower_id;

    const rawCallStatus =
        extraction.call_status ||
        body.callStatus ||
        body.call_status ||
        body.call_infra?.call_status?.callStatus ||
        "unknown";

    const callStatus = String(rawCallStatus).toLowerCase();

    const borrowerIntent =
        extraction.DISPOSITION ||
        extraction.disposition ||
        body.borrowerIntent ||
        body.borrower_intent ||
        "other";

    const paymentCommitmentDate =
        extraction.payment_commitment_date ||
        extraction.paymentCommitmentDate ||
        null;

    const rawAmount =
        extraction.payment_commitment_amount ??
        extraction.paymentCommitmentAmount ??
        null;

    let paymentCommitmentAmount = null;

    if (rawAmount !== null && rawAmount !== "") {
        const cleanedAmount = String(rawAmount).replace(/,/g, "");
        const match = cleanedAmount.match(/\d+(\.\d+)?/);

        if (!match) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment commitment amount"
            });
        }

        paymentCommitmentAmount = Number(match[0]);

        if (
            !Number.isFinite(paymentCommitmentAmount) ||
            paymentCommitmentAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment amount must be positive"
            });
        }
    }

    const callbackDateTime =
        extraction.callback_datetime ||
        extraction.callbackDateTime ||
        null;

    const rawHumanAssistance =
        extraction.human_assistance_required ??
        extraction.humanAssistanceRequired ??
        false;

    const humanAssistanceRequired =
        rawHumanAssistance === true ||
        rawHumanAssistance === 1 ||
        String(rawHumanAssistance).toLowerCase() === "true";

    // Validate required borrower ID
    if (
        typeof borrowerId !== "string" ||
        !borrowerId.trim()
    ) {
        return res.status(400).json({
            success: false,
            message: "Borrower ID is missing from call context"
        });
    }

    // Validate call status
    if (!validCallStatuses.includes(callStatus)) {
        return res.status(400).json({
            success: false,
            message: "Invalid call status",
            received: callStatus
        });
    }

    // Validate intent
    if (!validIntents.includes(borrowerIntent)) {
        return res.status(400).json({
            success: false,
            message: "Invalid borrower intent",
            received: borrowerIntent
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
                    console.error("Call outcome save error:", err);

                    return res.status(500).json({
                        success: false,
                        message: "Could not save call outcome"
                    });
                }

                console.log(
                    "CALL OUTCOME SAVED:",
                    this.lastID
                );

                return res.status(201).json({
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
                        humanAssistanceRequired
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
