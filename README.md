# Mebius Code

Language: **English** | [简体中文](README.zh-CN.md)

Mebius Code is a multi-client agentic coding platform. It provides a backend service for model configuration, project workspaces, coding sessions, Plan Mode, tool approvals, and server-side code operations.

The visible product name is **Mebius Code**. Engineering identifiers use lowercase names such as `mebius-code`, `mebius_code`, and `MEBIUS_CODE_`.

## Project Layout

```text
backend/                 NestJS backend service
frontend/                Vue 3 + TypeScript web workspace
tui/                     Bun + OpenTUI terminal workspace
android/                 Native Kotlin + Jetpack Compose Android companion app
docs/                    Project requirements, design, and management documents
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

Email verification for registration uses SMTP. For Brevo's free SMTP relay,
set `MAIL_ENABLED=true`, `MAIL_FROM`, `SMTP_USER`, and `SMTP_PASS` in
`backend/.env` after creating a Brevo transactional sender and SMTP key.

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

Mebius Code reads a project root `AGENTS.md` as repository-level agent
instructions. In the TUI, run `/init` to generate a starter file.

## TUI Quick Start

The TUI connects to an already running backend API. It does not start the
backend in the MVP. Release builds default to the public API:

```text
http://182.92.150.169/api
```

Install the released TUI with one of these methods:

```bash
npm install -g mebius-code
```

```bash
curl -fsSL https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.ps1 | iex
```

For local development:

```bash
cd tui
bun install
bun run start
```

The installed CLI command is `mebius`. Use `mebius login`, or
`mebius login --api http://localhost:3000/api` for a local backend, to persist
credentials and API configuration.

Public API mode opens a workspace on the remote Mebius server. It cannot access
paths from the user's machine, such as `D:\Code\Python`. Use a local API with
local workspace support enabled when binding a real local path:

```powershell
mebius config set api http://localhost:3000/api
mebius login
mebius doctor D:\Code\Python
mebius D:\Code\Python
```

Use `mebius config show` to inspect the active API and
`mebius config reset api` to return to the public API. See
[tui/README.md](tui/README.md) for full TUI API mode, workspace path,
troubleshooting, command, and shortcut details.

## Android Quick Start

The Android app is a lightweight companion client for existing Mebius API
instances. It supports project/session browsing, Build and Plan messages, SSE
status updates, and one-time approval/reject actions.

Open `android/` in Android Studio, or run from that directory with a local
Android Gradle setup:

```bash
gradle :app:assembleDebug
```

Debug and release builds default to `http://182.92.150.169/api`. For local
emulator development, manually change the login screen API URL to
`http://10.0.2.2:3000/api`. The API address can still be changed from the login
and settings screens. APKs are published from GitHub Releases and can be
installed directly without app store submission.

Download signed Android APKs from the repository
[Releases](https://github.com/AlbertTeslaWizard/Mebius-Code/releases). Android
releases use independent tags such as `android-v0.1.0` and publish an asset
named `Mebius-Code-android-0.1.0.apk` with `SHA256SUMS`.

Maintainers publish a new Android APK by configuring these GitHub Secrets and
pushing an `android-v*` tag:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

The release keystore must be long-lived. Replacing it later can prevent users
from installing updates over an existing APK.

For the first Android release:

```bash
git tag android-v0.1.0
git push origin android-v0.1.0
```
