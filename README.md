
# SmartEMI - Voice Collections Bot

## Project Overview
SmartEMI is a voice-based EMI collections assistant designed to help NBFCs communicate with borrowers who have overdue EMI payments.

The assistant is built using the Inya voice agent platform and integrates with a backend API to retrieve borrower information and record call outcomes.

## Key Features
- Borrower verification and account information retrieval.
- EMI amount, due date and payment status communication.
- Promise-to-pay and payment commitment handling.
- Callback requests and financial difficulty handling.
- Wrong number and no-account classification.
- Payment disputes and human escalation.
- Post-call outcome extraction and database storage.
- English and Hindi conversational support.

## Technology Stack
- Node.js
- Express.js
- SQLite database
- Inya Voice Agent
- Render deployment
- GitHub

## Backend API

Base URL:
https://smartemi-api-kfvg.onrender.com

### Available Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/health | Backend health check |
| GET | /api/borrowers/:borrowerId | Fetch borrower details |
| PATCH | /api/borrowers/:borrowerId/payment-status | Update payment status |
| POST | /api/call-outcomes | Save call outcomes |

## Demo Borrower
- Borrower ID: B001
- Name: Rahul Sharma
- EMI Amount: ₹5,000
- Due Date: 20 November 2026

Demo borrower information is used for testing purposes.

## Environment Variables

Create a `.env` file and configure:

- PORT
- API_KEY

Never commit API keys or other secret credentials to GitHub.

## Project Repository
https://github.com/harshitachuphal/SmartEMI---API

## Deployment
Backend hosted on Render:
https://smartemi-api-kfvg.onrender.com

## Note
This project is a demonstration of a voice-based EMI collections workflow. Production deployment requires appropriate borrower authentication, data protection and integration validation.
