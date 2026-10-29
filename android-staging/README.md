# Sharika Android Staging (private test APK, not the user app)

This is the **first isolated Android staging harness**, not the finished
Sharika Voice Chat app or its existing design.

## Safety

- Android application ID: `com.soverixnet.sharika`.
- Firebase project: `sharika-voice-chat-app` (the uploaded Android
  `google-services.json` was checked for this exact package and project).
- Backend: `https://sharika-api-staging.soverixnet.workers.dev`.
- The Java activity uses the Firebase Android SDK directly. All HTTP calls
  go **only** to the staging Worker; it never opens the existing HTML app,
  Supabase, DigitalOcean or the current Sharika frontend.
- It supports email/password **test** account creation and sign-in,
  verification emails, and read-only requests to `/health` and `/api/v1/me`.
  A `404 profile_not_found` after Firebase token verification is expected:
  existing Supabase users have not been imported into staging D1.
- No wallet transactions, gift/game actions, voice calls, demo currency,
  admin changes, migrations, or production installations are performed.
- Do not distribute this staging test APK as a finished app. It may share a
  package name with a future release; avoid installing over an existing app.

## Build

The separate branch workflow
`.github/workflows/sharika-android-staging-apk.yml` runs an automated
**debug APK** build on this feature branch and uploads the APK as a CI
artifact. The workflow never deploys a production app or creates paid cloud
resources.

For local development, install Android SDK Platform 35, Build Tools 35,
Java 17 and Gradle 8.9. Then run from `android-staging`:

```sh
gradle :app:assembleDebug --no-daemon
```

The resulting file is `app/build/outputs/apk/debug/app-debug.apk`.

## Before live login/voice features

1. Enable Firebase Authentication Email/Password in the new project.
2. For test email accounts, confirm verification using the emailed link.
3. Test that a real signed Firebase ID token reaches the protected Cloudflare
   endpoint. `/api/v1/me` returning 404 for an unimported user is expected.
4. Build the actual Android UI with the original Sharika experience while
   using new staging-only API adapters, not the existing Supabase adapter.
5. Plan and reconcile old user-ID and wallet data before **any** cutover.
6. Configure a Sharika-specific LiveKit instance and test voice/microphone.
7. Implement and test financial/gift/game/admin endpoints separately.
8. Never switch the original live app without explicit approval and backups.

Firebase `google-services.json` includes public, non-secret app
configuration identifiers; it does not include a service-account private key.
Keep privileged API tokens and service credentials out of source.
