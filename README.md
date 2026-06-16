# MCQ Engine API

Lightweight Node.js/Express backend for the MCQ Engine. Handles file uploads, text extraction, regex-based answer parsing, and Gemini AI normalization.

## Features

- **File ingestion**: PDF, DOCX, DOC, TXT via `pdf-parse` and `mammoth`
- **Scenario A (regex)**: Detects answer keys, inline answers, and marked options
- **Scenarios B & C (AI)**: Falls back to Google Gemini for hidden/missing answers
- **Session storage**: In-memory quiz sessions with TTL
- **Quiz sampling**: All questions or random subset

## Setup

```bash
cd back
npm install
cp .env.example .env
# Add your Gemini API key to .env (free at https://aistudio.google.com/apikey)
npm run dev
```

API runs at `http://localhost:3001`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Upload file or text, returns quiz session |
| GET | `/api/quiz/:sessionId` | Get session questions |
| POST | `/api/quiz/:sessionId/submit` | Submit answers, get score |

### POST /api/upload

Multipart form fields:
- `file` (optional): PDF/DOCX/TXT file
- `text` (optional): Pasted MCQ text
- `mode`: `all` or `random`
- `sampleSize` (optional): Number for random mode

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `SESSION_TTL_MS` | `3600000` | Session expiry (1 hour) |
