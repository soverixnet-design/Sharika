# Sharika Android staging alpha — original Sharika UI

## Greedy Wheel (isolated staging candidate, 2026-10-31)

The supplied `greedy-wheel-full(1).zip` now appears as the fourth card in the
original Home/room Games sheet. Its original HTML, CSS, JS, and ten food images
are copied under `app/src/main/assets/greedy-wheel/`. The other three game
screens and the original Sharika app/room design remain unchanged.

`sharika-bridge.js` keeps the wheel in **online-only** mode. It transports
state, bet, and records requests to the authenticated Android parent, whose
native Firebase bridge only permits exact `/api/v1/greedy-wheel/*` routes.
All wagers and payouts use the existing staging D1 user `coins` balance and
immutable wallet ledger. There are no fake players, simulated coin grants, or
independent local-wallet balances in this app integration. The supplied
standalone Node server is not deployed; an equivalent D1 handler lives in
`cloudflare/src/greedy-wheel.mjs`.

**Required deployment order:** apply the new staging migration
`cloudflare/migrations/0027_greedy_wheel.sql`, deploy the updated staging
Worker, then build/test the Android staging APK. A newly built APK pointed at
the old Worker cannot take Greedy bets; no existing live service is changed by
this branch. Verify actual two-device betting, result timing, and ledger
reconciliation before any user rollout. This implementation is restricted to
non-redeemable virtual coins and verified adult staging accounts; paid gaming
or public store distribution requires separate legal and platform review.

## Android Firebase bridge route allowlist

The native shell explicitly permits only known signed-in staging API routes:
rooms/voice, gifts, mutual follow/messages/support, wallet exchange,
verified rankings and the two server games. Google/Firebase tokens are never
exposed in page JavaScript. Unlisted paths (including all admin routes),
arbitrary hosts and encoded path tricks are still blocked.

## Server-verified virtual-coin games (isolated staging only)

Food Wheel and Jackpot Fruit now use 40-second UTC rounds with 28 seconds
open for one bet per verified adult account per game and round. A user may bet
any whole-coin amount up to their available wallet balance (subject to safe
integer limits). The fixed payout schedule is **9x** for one of nine equal Food
Wheel sectors, and **36x** when all three of six equally likely Jackpot Fruit
reels match. All other outcomes pay zero. The expected return is 100% before
rounding; no operator edge or cash redemption is implemented.

D1 stores round commitments, accepted bets, settled results and immutable
wallet ledger entries. Bet debits and win payouts use one-time SQLite triggers.
The SHA-256 commitment is published before betting and the random seed becomes
visible after each round closes. Results are computed by the Worker, not
Android localStorage. Settlement happens on a returning player's next game or
wallet request; background payout broadcasting and full multi-device end-to-end
testing are not yet complete.

**Never deploy this staging feature to a cash-equivalent wallet or Play Store
without country-by-country legal, age-gating and gaming-policy review.**

## Food Wheel game card (staging preview, 2026-10-30)

The supplied Food Wheel artwork is packaged locally as `app/src/main/assets/food-wheel-card.jpg`.
The original Home **Games** shortcut and the in-room **Games** button open its
game-selection card inside the existing sheets without changing the original
HTML, room design, or voice code. This is a visual card only: clicking it displays
an explicit message that server-verified game rounds and coin settlement are
not enabled. It cannot place a bet, spend wallet coins, or fabricate a win.
The Android APK CI checks that this image is actually inside the built APK.

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

**Google sign-in config refresh (1 November 2026):** The owner-supplied
`app/google-services.json` now includes the stable staging APK signer's
SHA-1 `ab491a1a905a42bf42417d7b62c658b379f32bb0` as an Android
OAuth client, with unchanged Firebase project ID, Android package, app ID and
Web OAuth client. CI checks this exact certificate hash at build time.
The updated config resolves the previously detected *file-level* mismatch.
It does not by itself prove that Google Authentication is enabled or that
the complete Google sign-in flow succeeds on a physical phone. Verify those
separately before release; never hand-edit OAuth IDs or fingerprints.


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
