# Mebius TUI

Terminal client for Mebius Code.

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
- `/plan <goal>`: create a plan.
- `/plan-approve`: approve the latest plan.
- `/approve`: approve the active tool request.
- `/reject`: reject the active tool request.
- `/run <command>`: request a shell command run.
- `/open <path>`: open a project file.
- `/exit`: exit the TUI.
- `/quit`: exit the TUI.
