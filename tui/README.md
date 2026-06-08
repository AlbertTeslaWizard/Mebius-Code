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
