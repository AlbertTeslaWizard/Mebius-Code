# Mebius Code Android

Native Kotlin + Jetpack Compose companion app for Mebius Code.

## Scope

The Android app is a lightweight companion client:

- Sign in to an existing Mebius API.
- View projects, recent sessions, active work, and pending approvals.
- Open a session, follow SSE status/token updates, send Build messages, and create Plan Mode tasks.
- Review Plan cards and tool approvals.
- Approve tools with `Allow once` only, or reject them.

It intentionally does not provide a phone IDE, local workspace binding, Git publishing, MCP/Skills management, model provider setup, or background push notifications.

## Run

Open `android/` in Android Studio or run from this directory with a local Android Gradle setup:

```bash
gradle :app:assembleDebug
```

Debug builds default to the Android emulator API URL:

```text
http://10.0.2.2:3000/api
```

Release APKs default to the public course API:

```text
http://182.92.150.169/api
```

Users can still change the API address before signing in or later from Settings.
Course demo releases are distributed as signed APKs through GitHub Releases; app
store submission is not required for the course demo path.
