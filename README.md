# Mebius Code

Mebius Code is a multi-client agentic coding platform for the Object-Oriented Technology and Methods course project. It provides a backend service for model configuration, project workspaces, coding sessions, Plan Mode, tool approvals, and server-side code operations.

The visible product name is **Mebius Code**. Engineering identifiers use lowercase names such as `mebius-code`, `mebius_code`, and `MEBIUS_CODE_`.

## Project Layout

```text
backend/                 NestJS backend service
frontend/                Vue 3 + TypeScript web workspace
docs/                    Markdown source documents for final DOCX deliverables
面向对象技术与方法结课设计.docx  Original course requirement document
```

## Backend Quick Start

```bash
cd backend
npm install
cp .env.example .env
docker compose up -d postgres
npm run start:dev
```

API base URL:

```text
http://localhost:3000/api
```

SSE session events:

```text
GET /api/sessions/:id/events?access_token=<jwt>
```

## Frontend Quick Start

```bash
cd frontend
npm install
npm run dev
```

The web app runs at `http://127.0.0.1:5173` and proxies `/api` to the backend.

Shell commands can be requested from the workspace **Runs** tab. Every command
requires review before execution. Administrators manage Git, Node.js, Python,
and custom command permissions from **Settings > Command permissions**.
