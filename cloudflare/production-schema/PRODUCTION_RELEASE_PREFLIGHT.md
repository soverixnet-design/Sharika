# Sharika Production Worker — release preflight (not deployed)

Date: 2026-11-08 (UTC). No Cloudflare Worker deployment or D1/R2 mutation
was performed during this preflight; existing staging resources and user data
remain untouched.

## Prepared in the isolated GitHub production branch

- `wrangler.production.jsonc` selects `src/production-entry.mjs` and binds
  **only** `sharika-production` D1 and `sharika-production-media` R2.
- A dedicated `VOICE_ROOMS` Durable Object class and isolated Rate Limit
  namespaces `410301` / `410302` are defined for a **future deployment**.
  The production Durable Object namespace does not exist until that release.
- Production coordinator keys are `sharika:presence:production` and
  `sharika:music-library:production`; existing staging keys are unchanged.
- Logs and traces are configured. Scheduled handlers and public Worker URLs
  remain off.
- `SHARIKA_PUBLIC_API_ENABLED=false`, production client-URL review remains
  false, and a **compile-time** `RELEASE_REVIEW_APPROVED=false` guard denies
  **all requests with 503** even if a dashboard flag were accidentally set.
  The guarded module does not expose secret names or readiness failures to
  callers, and it never calls the real app until release approval is changed.
- The old fail-closed `src/production-placeholder.mjs` is retained as a
  rollback/reference option; it is no longer the configured source entry.

## Tests

- `npm run check`: 635/635 Node tests passed; all SQL and syntax checks passed.
- `node --test test/production-entry.test.mjs`: five production-isolation and
  fail-closed checks passed, included in the total above.
- `python3 test/production-schema-candidate.test.py`: 154 tables, 112 indexes,
  140 triggers, 103 curated seed rows; integrity and FK checks passed locally.
- None of these offline tests demonstrate live voice, Android device behavior,
  billing validation, or Cloudflare Worker deployment success.

## Unresolved release blockers

1. **Production Firebase identity and Cloudflare Realtime SFU/TURN secrets**
   must be scoped to production and verified without copying staging secrets.
2. **Android app and invite URLs are hard-coded to Staging** in several places:
   `MainActivity.java`, `SharikaMessagingService.java`,
   `SharikaActivity.java`, `android-staging/staging-connection.js`,
   `admin/connection.js`, and `src/invite-link.mjs`.
   The production app must use independently reviewed production endpoints,
   but must not switch existing testers until the API is validated.
3. **Real API readiness**: the existing `src/index.mjs` still returns
   `migration_pending` for unimplemented financial/admin routes. Wallet,
   Agency, game, seller, recharge, and payout behaviors must be tested
   end-to-end against disposable production test accounts before launch.
4. **Production DO namespace and bindings** will be created only by a future,
   separately reviewed deployment. R2 media is empty; media URL and product
   catalog migration must not copy private user data or missing assets blindly.
5. **Voice, permissions, support, age protection, Play Billing, and signed AAB**
   require live integration, two-device QA, and Google Play release checks.

## Existing Play candidate inspection

- `release_inspect/Sharika-Play-Store-Candidate.aab` exists locally (89,257,735
  bytes). `unzip -t` passed and the bundle contains `META-INF/SHARIKA-.RSA`
  and `.SF`, but no cryptographic signing-certificate verification was done.
- Gradle currently declares `versionName '1.0.3-staging'`, `versionCode 103`,
  and explicit staging-candidate build support. The Java `MainActivity`
  still hard-codes the staging API origin. **This existing bundle is not a
  verified production-release artifact** and must not be uploaded to the
  public Production track as-is.

Never disable the compile-time gate or enable routing automatically. Require
an explicit production release review when the above blockers are cleared.

## Follow-up: Android routing and Voice prerequisites (2026-11-08)

- Android `MainActivity`, the FCM registration service and `SharikaActivity`
  now obtain the endpoint from the build-variant `SHARIKA_API_ORIGIN`; the
  HTTPS invite intent-filter uses a variant-specific manifest placeholder.
- A **release-only** generated `connection.js` overlays the unchanged staging
  adapter when `SHARIKA_PLAY_API_ORIGIN` is supplied. Its staging origin and
  escaped strict-host URL validators are rewritten to the selected production
  hostname; the debug build and original staging source stay unchanged.
- The production-invite landing will not offer the staging APK. The staging
  landing still has its test download option.
- The production Worker config requires *separately provisioned* SFU and TURN
  secret bindings. The preflight gate rejects a missing TURN relay as well as
  missing SFU credentials. No credentials have been copied or created.
- Read-only Cloudflare binding inspection: staging has the four named SFU/TURN
  secret bindings; production has **zero** secret bindings. Production Worker
  remains undeployed, and no public route is available.
- Offline Node tests: **638 passed**, none failed. This includes tests for
  Android variant host references and staging/production URL replacement.
- No Gradle/Android SDK build was available in this executor, so the new
  manifest merging, release asset overlay, signing and on-device behavior
  remain **unverified**. No new AAB was produced or submitted to Play.

Next release gate: choose and verify the eventual HTTPS Production API origin,
provision independent SFU/TURN credentials through the authorized secret
workflow, run a real release-format build and inspect its merged Android
manifest/packaged `connection.js`, then test audio on two devices. Retain the
compile-time Worker gate until full app and economic QA passes.
