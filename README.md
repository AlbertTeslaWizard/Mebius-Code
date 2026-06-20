<p align="center">
  <img src="frontend/src/assets/mebius-loop.png" alt="Mebius Loop — humans and AI moving forward together" width="100%" />
</p>

<h1 align="center">Mebius Code</h1>

<p align="center"><strong>Humans and AI, building side by side.</strong></p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="http://182.92.150.169/">Open the Web app</a> ·
  <a href="https://www.npmjs.com/package/mebius-code">Install the TUI</a> ·
  <a href="https://github.com/AlbertTeslaWizard/Mebius-Code/releases">Download a release</a>
</p>

Mebius Code is a multi-client agentic coding platform. Its NestJS backend powers
a full Web workspace, a terminal-native TUI, and an Android companion app, so a
coding session can move with you without giving up plans, approvals, or context.

## Why “Mebius”?

The name **Mebius** pays tribute to *Ultraman Mebius*, a story centered on the
friendship and bonds between humans and Ultraman. We chose it to express the
hope that humans and AI can also become partners who stand side by side, build
trust through shared work, and form lasting friendship and bonds.

The **Mebius Loop** carries a second meaning. Its `∞` form represents the
limitless potential created when human judgment and creativity connect with AI
capabilities and both move forward together.

## What Mebius Code provides

- **Build and Plan workflows** — work directly with the coding agent or develop,
  review, revise, and approve a plan before implementation.
- **Real project workspaces** — create projects on the server, import Git
  repositories or archives, or attach a real local path to a local-runtime
  backend.
- **Code and Git tools** — inspect and edit files, preview patches, run approved
  commands, and manage common Git staging, commit, and push operations.
- **Controlled automation** — sandboxed paths, tool approvals, command policies,
  session grants, audit records, and encrypted model credentials.
- **Extensible context** — repository-level `AGENTS.md` instructions,
  OpenAI-compatible model providers, MCP tools, Web search, and local TUI Skills.
- **Live multi-client sessions** — session history, SSE activity and token
  updates, Plan state, and pending approvals are shared through one API.

## Choose a client

| Client | Best for | Highlights |
| --- | --- | --- |
| [Web](frontend/README.md) | Full project and workspace management | File tree and editor, Build/Plan workbench, model and command settings, Git workflow, approvals, and audit records |
| [TUI](tui/README.md) | Daily coding from a terminal | Build/Plan composer, local paths, MCP browser, Skills, slash commands, model switching, and interactive approvals |
| [Android](android/README.md) | Following work away from the desk | Projects and sessions, live status, Build/Plan messages, Plan review, and allow-once/reject decisions |

The Android app is intentionally a companion rather than a phone IDE. Model
setup, Git publishing, MCP/Skills management, and local workspace binding remain
Web or TUI workflows.

## Try the hosted service

### Web

Open the [Mebius Code Web app](http://182.92.150.169/), register or sign in,
configure a model under **Settings → Models**, then create or import a project.
The API is available at `http://182.92.150.169/api`.

> The hosted endpoint currently uses plain HTTP. Treat it as a public evaluation
> environment: do not reuse a sensitive password or upload confidential source
> code.

### TUI

The npm package requires Node.js 18 or newer:

```bash
npm install -g mebius-code
mebius login --api http://182.92.150.169/api
mebius
```

Native Windows, Linux, and macOS builds are also available from
[GitHub Releases](https://github.com/AlbertTeslaWizard/Mebius-Code/releases).
The install scripts and full command reference are documented in
[tui/README.md](tui/README.md).

The public API creates workspaces on the Mebius server. It cannot open a path
from your computer such as `D:\Code\Python` or `/home/me/project`; use a local
backend for that workflow.

### Android

Download the signed `Mebius-Code-android-x.x.x.apk` and `SHA256SUMS` from
[GitHub Releases](https://github.com/AlbertTeslaWizard/Mebius-Code/releases).
After allowing installation from the selected source on your Android device,
install the APK and sign in. The API address can be changed from the login or
Settings screen.

## Local development

### Prerequisites

- Node.js 18 or newer and npm
- Docker with Docker Compose for PostgreSQL
- [Bun](https://bun.sh/) when running the TUI from source
- JDK 17 and Android SDK 35 when building the Android app

### Backend and PostgreSQL

```bash
cd backend
npm install
cp .env.example .env
docker compose up -d postgres
npm run start:dev
```

In PowerShell, use `Copy-Item .env.example .env` instead of `cp`. The API runs
at `http://localhost:3000/api`.

New-account registration requires email verification. Configure
`MAIL_ENABLED=true`, `MAIL_FROM`, `SMTP_USER`, and `SMTP_PASS` in
`backend/.env` before requesting a registration code. Model API keys are
configured after sign-in and are encrypted with `MEBIUS_CODE_MASTER_KEY`.

### Web

Start the backend first, then open another terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite app runs at `http://127.0.0.1:5173` and proxies `/api` to the local
backend.

### TUI and real local paths

To let the TUI attach a path from your computer, set these values in
`backend/.env` before starting the backend:

```env
MEBIUS_CODE_SERVER_MODE=local_runtime
MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true
```

Then connect an installed TUI:

```bash
mebius login --api http://localhost:3000/api
mebius doctor <workspace-path>
mebius <workspace-path>
```

Or run it from source:

```bash
cd tui
bun install
bun run start
```

See [tui/README.md](tui/README.md) for API switching, local-path behavior,
troubleshooting, shortcuts, MCP, Skills, and slash commands.

### Android

Open `android/` in Android Studio, or use the Gradle wrapper:

```bash
cd android
./gradlew :app:assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

On Windows, use `gradlew.bat`. An Android emulator reaches a backend on the host
machine through `http://10.0.2.2:3000/api`.

### Reset the local database

From the `backend/` directory:

```bash
docker compose down -v
```

The `-v` flag permanently removes the local PostgreSQL and backend workspace
volumes.

## Repository layout

```text
backend/                 NestJS API, agent runtime, tools, and PostgreSQL entities
frontend/                Vue 3 + TypeScript Web workspace
tui/                     Bun + OpenTUI terminal client and npm package
android/                 Kotlin + Jetpack Compose companion app
scripts/                 TUI installation scripts
.github/workflows/       TUI and Android release automation
```

Display text uses **Mebius Code**. Engineering identifiers use forms such as
`mebius-code`, `mebius_code`, and `MEBIUS_CODE_`.

## Detailed documentation

- [Backend setup, API surface, Web search, and security defaults](backend/README.md)
- [Web development and quality checks](frontend/README.md)
- [TUI installation, configuration, commands, and shortcuts](tui/README.md)
- [Android scope, build, and release process](android/README.md)
