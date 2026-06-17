# Mebius TUI

Terminal client for Mebius Code.

Release builds default to the public course API:

```text
http://182.92.150.169/api
```

## Install

With npm:

```bash
npm install -g mebius-code
```

macOS, Linux, or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.ps1 | iex
```

Then sign in:

```bash
mebius login
mebius doctor
mebius
```

Use `mebius config show` to inspect the current API and login state. Use
`mebius config reset api` to return to the public API, or
`mebius config set api <url>` to persist a different API URL.

## API Modes and Workspace Paths

Mebius TUI has two API modes. They differ in where files and commands are
executed.

### Public API mode

Release builds default to the public course API:

```text
http://182.92.150.169/api
```

This mode opens a workspace on the remote Mebius server. It cannot access a
path from your machine, such as `D:\Code\Python` or `/home/me/project`. If the
status panel shows a path like `/opt/mebius-code/workspaces/...`, that is the
server-side workspace for the current project.

Common public API commands:

```bash
mebius config reset api
mebius login
mebius doctor
mebius
```

### Local API mode

Use local API mode when you want TUI to bind a real path that is visible to a
local Mebius backend, such as `D:\Code\Python`.

Start the backend in local runtime mode first. In PowerShell:

```powershell
cd D:\Code\MebiusCode\backend
$env:MEBIUS_CODE_SERVER_MODE = "local_runtime"
$env:MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED = "true"
npm run start:dev
```

Then configure and log in from another shell:

```powershell
mebius config set api http://localhost:3000/api
mebius login
mebius doctor D:\Code\Python
mebius D:\Code\Python
```

You can also log in while setting the API:

```powershell
mebius login --api http://localhost:3000/api
mebius D:\Code\Python
```

For development from the `tui/` directory, the same commands can be run through
Bun:

```powershell
bun --preload @opentui/solid/preload src/cli.tsx login --api http://localhost:3000/api
bun --preload @opentui/solid/preload src/cli.tsx doctor D:\Code\Python
bun --preload @opentui/solid/preload src/cli.tsx D:\Code\Python
```

`--api` can temporarily override the API for a single command:

```powershell
mebius --api http://localhost:3000/api D:\Code\Python
mebius doctor --api http://localhost:3000/api D:\Code\Python
```

Tokens are API-specific. If you switch between public and local APIs, log in
again for the selected API.

### Troubleshooting

- `Not logged in`: run `mebius login` for the currently configured API, or
  `mebius login --api <url>` when switching APIs.
- `Local workspace support: disabled`: the connected backend is not running in
  local runtime mode or `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true` is missing.
- The workspace path is `/opt/mebius-code/workspaces/...`: you are connected to
  the public API and are viewing a remote server workspace.
- `Saved token is invalid or expired`: run `mebius login` again for the current
  API.
- `Request failed with HTTP 502`: the configured API is unreachable or the
  backend behind it is unhealthy. Run `mebius config show` to confirm the API.

## Development

```bash
bun install
bun run start
```

The installed command is `mebius`.

MVP behavior:

- `mebius` connects to an already running Mebius API; it does not start the backend.
- `mebius --api <url>` is a temporary override for the current run.
- `mebius login --api <url>` and `mebius config set api <url>` persist the API URL.
- Local workspace binding only happens for localhost API URLs and only when `/api/system/capabilities` says the backend supports it.
- Remote public API mode cannot register a path from the user's machine; create or import a project in the Web app first.
- `mebius config set api <url>` and `mebius config reset api` clear saved login and recent session state, because tokens and project IDs belong to one backend.

## Composer

The prompt has two modes:

- Build: regular text runs the coding agent.
- Plan: regular text creates a plan for the current session.

Slash commands always use command handling, regardless of the active composer mode.

## Shortcuts

- `Tab`: switch between Build and Plan.
- `Ctrl+P`: open the command palette.
- `Esc`: close the command palette or model picker.
- `Enter`: submit the current prompt or selected picker item.

## Commands

- `/models`: choose or configure the active model.
- `/mcp`: browse configured MCP servers and tools.
- `/mcp refresh` or `/mcp verbose`: open the MCP browser and probe enabled servers.
- `/mcp context7`, `/mcp add <slug> <url>`, `/mcp tools <slug>`, `/mcp enable <slug>`, `/mcp disable <slug>`, `/mcp remove <slug>`: run MCP management commands.
- MCP browser shortcuts: `Up/Down` navigate, `Enter` or `Tab` opens server details, `Space` enables or disables the selected server, `Ctrl+R` refreshes diagnostics, `Esc` goes back or closes.
- `/new <title>`: create and switch to a new session, inheriting the current model.
- `/clear`: clear the current chat and model context.
- `/compact`: compact the current chat into model context.
- `/init`: create an `AGENTS.md` project instruction file. Use `/init --preview` to preview without writing and `/init --replace` to overwrite an existing file.
- `/plan <goal>`: create a plan.
- `/plan-approve`: approve the latest plan.
- `/approve`: approve the active tool request.
- `/reject`: reject the active tool request.
- `/run <command>`: request a shell command run.
- `/open <path>`: open a project file.
- `/exit`: exit the TUI.
- `/quit`: exit the TUI.
