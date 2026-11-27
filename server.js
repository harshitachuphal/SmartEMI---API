
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { db, ready } = require("./database");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY;

const validCallStatuses = [
    "answered",
    "not_answered",
    "completed",
    "unknown"
];

const validIntents = [
    "agree_to_pay",
    "promise_to_pay",
    "payment_commitment",
    "needs_more_time",
    "financial_difficulty",
    "already_paid",
    "wrong_number",
    "callback_later",
    "busy",
    "dispute",
    "no_account",
    "human_escalation",
    "no_response",
    "other"
];

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

function firstValue(...values) {
    return values.find(
        (value) =>
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
    );
}

function normalizeCallStatus(value) {
    const status = String(value || "unknown")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");

    const aliases = {
        na: "unknown",
        answered: "answered",
        completed: "completed",
        complete: "completed",
        not_answered: "not_answered",
        unanswered: "not_answered",
        no_answer: "not_answered",
        no_response: "not_answered",
        disconnected: "unknown",
        failed: "unknown"
    };

    return aliases[status] || "unknown";
}

function normalizeIntent(value) {
    const intent = String(value || "other")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");

    const aliases = {
        payment_commitment: "promise_to_pay",
        agree_to_pay: "promise_to_pay",
        promise_to_pay: "promise_to_pay",
        need_more_time: "needs_more_time",
        callback: "callback_later",
        human_escalation: "human_escalation",
        no_response: "no_response"
    };

    return aliases[intent] || intent;
}

function parseAmount(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const cleaned = String(value).replace(/,/g, "");
    const match = cleaned.match(/\d+(\.\d+)?/);

    if (!match) return null;

    const amount = Number(match[0]);

    return Number.isFinite(amount) && amount > 0
        ? amount
        : null;
}

function parseBoolean(value) {
    if (value === true || value === 1) return true;

    const normalized = String(value).trim().toLowerCase();

    return ["true", "1", "yes", "required"].includes(normalized);
}

function cleanText(value) {
    if (value === undefined || value === null) return null;

    const text = String(value).trim();

    if (!text || text.toLowerCase() === "null") return null;

    return text;
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
    db.get(
        "SELECT * FROM borrowers WHERE borrowerId = ?",
        [req.params.borrowerId],
        (err, borrower) => {
            if (err) {
                console.error("Borrower fetch error:", err);

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

// Update payment status only when verified by a trusted process.
app.patch(
    "/api/borrowers/:borrowerId/payment-status",
    authenticate,
    (req, res) => {
        const paymentStatus = cleanText(req.body?.paymentStatus);

        if (!paymentStatus) {
            return res.status(400).json({
                success: false,
                message: "Valid payment status is required"
            });
        }

        db.run(
            "UPDATE borrowers SET paymentStatus = ? WHERE borrowerId = ?",
            [paymentStatus, req.params.borrowerId],
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

// Save Inya post-call outcome
app.post("/api/call-outcomes", authenticate, (req, res) => {
    const body = req.body || {};

    const extraction =
        body.post_call_extraction_v2 ||
        body.disposition_result ||
        body.data?.post_call_extraction_v2 ||
        body.data?.disposition_result ||
        body.data ||
        {};

    const userContext = body.user_context || {};

    const borrowerId = firstValue(
        body.borrowerId,
        body.borrowerID,
        body.borrower_id,
        userContext.borrowerId,
        userContext.borrowerID,
        extraction.borrower_id
    );

    const conversationId = cleanText(firstValue(
        body.conversation_id,
        body.conversationId,
        body.call_infra?.conversation_id
    ));

    const callStatus = normalizeCallStatus(firstValue(
        extraction.call_status,
        body.callStatus,
        body.call_status,
        body.call_infra?.call_status?.callStatus
    ));

    const borrowerIntent = normalizeIntent(firstValue(
        extraction.DISPOSITION,
        extraction.disposition,
        body.borrowerIntent,
        body.borrower_intent
    ));

    const paymentCommitmentDate = cleanText(firstValue(
        extraction.payment_commitment_date,
        extraction.paymentCommitmentDate
    ));

    const paymentCommitmentAmount = parseAmount(firstValue(
        extraction.payment_commitment_amount,
        extraction.paymentCommitmentAmount
    ));

    const callbackDateTime = cleanText(firstValue(
        extraction.callback_datetime,
        extraction.callbackDateTime
    ));

    const reasonForDelay = cleanText(firstValue(
        extraction.reason_for_delay,
        extraction.reasonForDelay
    ));

    const emiAmountDiscussed = cleanText(firstValue(
        extraction.emi_amount_discussed,
        extraction.emiAmountDiscussed
    ));

    const rawHumanAssistance = firstValue(
        extraction.human_assistance_required,
        extraction.humanAssistanceRequired,
        false
    );

    const humanAssistanceRequired = parseBoolean(rawHumanAssistance);

    if (!borrowerId || typeof borrowerId !== "string") {
        return res.status(400).json({
            success: false,
            message: "Borrower ID is missing from call context"
        });
    }

    if (!validCallStatuses.includes(callStatus)) {
        return res.status(400).json({
            success: false,
            message: "Invalid call status",
            received: callStatus
        });
    }

    if (!validIntents.includes(borrowerIntent)) {
        return res.status(400).json({
            success: false,
            message: "Invalid borrower intent",
            received: borrowerIntent
        });
    }

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
                INSERT OR IGNORE INTO call_outcomes (
                    borrowerId,
                    callStatus,
                    borrowerIntent,
                    paymentCommitmentDate,
                    paymentCommitmentAmount,
                    callbackDateTime,
                    humanAssistanceRequired,
                    reasonForDelay,
                    emiAmountDiscussed,
                    conversationId
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                borrowerId.trim(),
                callStatus,
                borrowerIntent,
                paymentCommitmentDate,
                paymentCommitmentAmount,
                callbackDateTime,
                humanAssistanceRequired ? 1 : 0,
                reasonForDelay,
                emiAmountDiscussed,
                conversationId
            ];

            db.run(sql, values, function (err) {
                if (err) {
                    console.error("Call outcome save error:", err);

                    return res.status(500).json({
                        success: false,
                        message: "Could not save call outcome"
                    });
                }

                // Existing conversation ID means webhook was already processed.
                if (this.changes === 0 && conversationId) {
                    return db.get(
                        "SELECT * FROM call_outcomes WHERE conversationId = ?",
                        [conversationId],
                        (findError, existing) => {
                            if (findError) {
                                return res.status(500).json({
                                    success: false,
                                    message: "Could not retrieve existing outcome"
                                });
                            }

                            return res.status(200).json({
                                success: true,
                                duplicate: true,
                                message: "This conversation was already saved",
                                data: existing
                            });
                        }
                    );
                }

                const savedId = this.lastID;

                return res.status(201).json({
                    success: true,
                    duplicate: false,
                    message: "Call outcome saved successfully",
                    data: {
                        id: savedId,
                        borrowerId: borrowerId.trim(),
                        conversationId,
                        callStatus,
                        borrowerIntent,
                        paymentCommitmentDate,
                        paymentCommitmentAmount,
                        callbackDateTime,
                        humanAssistanceRequired,
                        reasonForDelay,
                        emiAmountDiscussed
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
