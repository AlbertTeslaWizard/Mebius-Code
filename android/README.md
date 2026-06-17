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

Debug and release builds default to the public course API:

```text
http://182.92.150.169/api
```

For local emulator development, manually change the login screen API URL to
`http://10.0.2.2:3000/api`.

Users can still change the API address before signing in or later from Settings.
Course demo releases are distributed as signed APKs through GitHub Releases; app
store submission is not required for the course demo path.

## Release

Android releases are published independently from the TUI/npm release line. A
tag such as `android-v0.1.0` triggers `.github/workflows/android-release.yml`,
which builds a signed release APK and uploads it to GitHub Releases as:

```text
Mebius-Code-android-0.1.0.apk
```

The workflow requires these repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Generate and keep one long-lived release keystore. Do not commit the keystore to
the repository; replacing it later can prevent installed APKs from upgrading.
The tag must match `versionName`; for example `android-v0.1.0` requires
`versionName = "0.1.0"`.
