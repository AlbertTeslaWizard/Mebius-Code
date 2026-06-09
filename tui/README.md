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
- `/plan <goal>`: create a plan.
- `/plan-approve`: approve the latest plan.
- `/approve`: approve the active tool request.
- `/reject`: reject the active tool request.
- `/run <command>`: request a shell command run.
- `/open <path>`: open a project file.
- `/exit`: exit the TUI.
- `/quit`: exit the TUI.
