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
  Firebase Google sign-in using Credential Manager, verification emails,
  and read-only requests to `/health` and `/api/v1/me`.
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

1. Enable Firebase Authentication Email/Password **and Google** in the new project.
   Add the **exact signing certificate SHA-1 (and SHA-256)** of the APK being
   installed to Firebase project settings. The new configuration includes the
   Android OAuth client and the generated `default_web_client_id` Web client.
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

## Google Sign-In and signing-certificate stability

The explicit **Continue with Google** button requests a Google ID token using
Android Credential Manager. Firebase signs the user into this **new staging
Firebase project**, then the existing read-only Cloudflare API check can verify
its Firebase ID token. Google sign-in is only functional after Google is enabled
under Firebase Authentication → Sign-in method.

**Important:** The GitHub Actions hosted debug runner generates a different
Android debug keystore on a new run. Firebase SHA-1 records are therefore tied
to one particular downloaded APK, and a newer build may require registering a
new certificate fingerprint. For reliable repeated testing, configure a stable,
secret-backed test signing keystore in GitHub Actions before distributing more
builds. **Never commit a keystore or a private signing key to the repository.**
A production/Play release needs the real signing fingerprint separately.
