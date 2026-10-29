# Sharika Android staging alpha — original Sharika UI

This branch now packages the **user's exact original Sharika HTML/CSS**
inside an Android WebView, with native Firebase Auth and a separate Cloudflare
D1 adapter. It is a staging alpha, not a finished user-facing release.
The previous Android login/API diagnostic screen remains unexported for test
purposes; the launcher now opens the original designed app.

## Safety

- Android application ID: `com.soverixnet.sharika`.
- Firebase project: `sharika-voice-chat-app` (the uploaded Android
  `google-services.json` was checked for this exact package and project).
- Backend: `https://sharika-api-staging.soverixnet.workers.dev`.
- The new launcher `SharikaActivity` packages `../app/index.html` unchanged
  and substitutes only an Android-specific `staging-connection.js` for the
  former Supabase bridge. Native Firebase Auth and a narrow allowlist of HTTP
  calls connect **only** to the new Cloudflare staging Worker. No Supabase
  production session, service key or old account is imported.
- It supports native Firebase email/password account creation, Google sign-in
  using Android Credential Manager, email verification, D1 profile creation,
  live reads of wallet/room lists, joining/leaving rooms and setting seats.
  The original 3D room UI is loaded from the original HTML asset.
  Voice connection code requests a scoped token when available, but the
  Sharika-specific LiveKit credentials are not configured/verified yet.
  A `404 profile_not_found` after Firebase token verification is expected:
  existing Supabase users have not been imported into staging D1.
- No financial/gift/game/admin mutations or migrations are performed.
  Original placeholder game/gift/message buttons are intercepted so they
  cannot generate false payouts or impersonate real users. Real voice,
  background audio, real-time chat and admin operations remain unverified.
  Any microphone access requires Android runtime permission.
- Do not distribute this staging test APK as a finished app. It may share a
  package name with a future release; avoid installing over an existing app.

## Build

The separate branch workflow
`.github/workflows/sharika-android-staging-apk.yml` verifies the
original HTML/staging adapter contract and runs an automated
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

**Important:** The GitHub Actions workflow requires the stable encrypted staging keystore
and checks the expected SHA-1 before publishing an artifact. It refuses to
fall back to an ephemeral debug certificate. A production/Play release
requires its own separate fingerprint and private key.


## New staging profile and room controls (not the live app)

The test APK now exercises these isolated D1 endpoints using a verified Firebase
ID token. The Worker independently authenticates every request:

| App control | Worker endpoint | Effect |
| --- | --- | --- |
| Create staging profile | `POST /api/v1/me` | Adds only a NEW Firebase identity to staging D1 with the schema-defined welcome ledger entry; never copies existing Supabase users |
| Read staging profile | `GET /api/v1/me` | Read-only |
| Read staging wallet | `GET /api/v1/wallet` | Read-only; no transfer, recharge, gift, or payout |
| Create staging room | `POST /api/v1/rooms` | Makes a new staging room owned by the signed-in user |
| List staging rooms | `GET /api/v1/rooms` | Read-only |
| Join / leave room | `POST /api/v1/rooms/:id/join`, `/leave` | Staging membership only |
| View members | `GET /api/v1/rooms/:id/members` | Read-only |
| Take / release a seat | `PUT /api/v1/rooms/:id/seat` | Staging seating only; 0 in the tester means no seat |

To test: install the *stable-signature staging APK* without replacing an
existing live Sharika installation; sign in with Google or a verified
email account; create a profile (name, real date of birth, country); then
create or join a room. The room ID is 8 digits. A profile must exist
before wallet and room operations. An unimported existing Supabase user
will not appear automatically.

**Not yet connected:** original full Sharika UI, microphone/LiveKit voice,
other-device live presence, gifts, games, paid wallet actions, admin mutations,
ranking, identity import and production cutover. Backend operations may require
further security and end-to-end testing before real users access them.
Do not enable billing or merge this branch to production.


## Original-design Android alpha test plan

1. Keep the existing Firebase staging project and the stable Android
   signer registered. **Do not use the old Supabase login.**
2. Install the new staging APK over the previous *same-signed test APK*.
   Never uninstall a different live installation or clear its data.
3. On the original Sharika login page, use **Continue with Google** or
   sign up with an email and a password of at least 12 characters.
4. For email signup, click the verification link and sign in again.
   New Google accounts may be asked for a real name/date of birth.
5. Create a new isolated D1 profile. Room creation, listing, member joining
   and seat updates should then be available in the original room design.
6. A Sharika-scoped LiveKit WSS address/API credentials are required on the
   Worker for real voice. Neither microphone audio nor 2-device voice is
   claimed tested before those secrets and device permissions are configured.
7. Wallet/game/gift/message/admin controls that lack a transactional backend
   are intentionally unavailable, not simulated.

A physical Android device and a second distinct user account are still
required for honest end-to-end verification before any production release.
No live app or historical data has been changed.
