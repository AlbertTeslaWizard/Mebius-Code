# Mebius Code Backend

NestJS backend for Mebius Code, an agentic coding platform with model configuration, server-side workspaces, Plan Mode, tool approvals, SSE events, and audit logging.

## Local Development

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run start:dev
```

Health check:

```text
GET http://localhost:3000/api/health
```

On Windows, if PowerShell returns a proxy-related `502 Bad Gateway`, bypass the local proxy:

```bash
curl.exe --noproxy "*" http://localhost:3000/api/health
```

## Docker Compose

From the repository root:

```bash
docker compose up --build
```

This starts:

- `api`: NestJS backend on port `3000`.
- `postgres`: PostgreSQL database on port `5432`.

## Core API Surface

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me

GET    /api/model-configs
POST   /api/model-configs
PATCH  /api/model-configs/:id
DELETE /api/model-configs/:id
POST   /api/model-configs/:id/test

GET  /api/projects
POST /api/projects
POST /api/projects/:id/import/git
GET  /api/projects/:id/tree
GET  /api/projects/:id/file?path=src/main.ts

POST /api/projects/:projectId/sessions
GET  /api/projects/:projectId/sessions
GET  /api/sessions/:id
GET  /api/sessions/:id/messages
POST /api/sessions/:id/messages
POST /api/sessions/:id/commands
GET  /api/sessions/:id/events?access_token=<jwt>

POST /api/sessions/:id/plan
POST /api/plans/:id/approve
POST /api/sessions/:id/run

GET  /api/approvals/pending
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject

GET  /api/audit-logs
```

`GET /api/audit-logs` supports `action`, `resourceType`, `resourceId`, `actorId`,
`limit`, and `offset` query parameters. Regular users are scoped to their own
logs; admins can query all actors.

## Slash Commands

`POST /api/sessions/:id/commands` supports these command flows:

```text
/clear
/compact
/model <modelConfigId>
/connect
/connect <provider search>
```

`/connect` returns searchable OpenAI-compatible provider options. Submit
`args.providerId` to get the connection form, then submit `args.providerId` and
`args.apiKey` to validate the provider, save the encrypted model config, and
switch the active session model. API keys must be passed through `args.apiKey`,
not embedded in the command string.

## Security Defaults

- Model API keys are encrypted with `MEBIUS_CODE_MASTER_KEY`.
- File tools are restricted to the project workspace root.
- `.git`, `.env`, `node_modules`, `dist`, and `coverage` are blocked by default.
- `create_patch` and `run_command` require approval.
- Commands must match `MEBIUS_CODE_COMMAND_ALLOWLIST`.
