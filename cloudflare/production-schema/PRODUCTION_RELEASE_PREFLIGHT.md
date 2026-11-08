# Sharika Production Worker — release preflight (public release blocked)

Date: 2026-11-08 (UTC). The initial offline preflight did not deploy a
Worker or mutate D1/R2. A subsequent separate infrastructure setup deployed
only the fail-closed 503 maintenance Worker internally, without any public
route or URL. Existing staging resources and user data remain untouched.

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

1. **Production Firebase identity** remains unverified. Separate Production
   SFU/TURN credentials have since been provisioned (see final follow-up).
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
  missing SFU credentials. At this earlier checkpoint, none had been created.
- Earlier read-only Cloudflare binding inspection: staging had the four named
  SFU/TURN secret bindings; production then had **zero** secret bindings and
  was undeployed. See final follow-up for the newer Production state.
- Offline Node tests: **638 passed**, none failed. This includes tests for
  Android variant host references and staging/production URL replacement.
- No Gradle/Android SDK build was available in this executor, so the new
  manifest merging, release asset overlay, signing and on-device behavior
  remain **unverified**. No new AAB was produced or submitted to Play.

Next release gate: choose and verify the eventual HTTPS Production API origin,
run a real release-format build and inspect its merged Android
manifest/packaged `connection.js`, then test audio on two devices. Retain the
compile-time Worker gate until full app and economic QA passes.

## Follow-up: isolated Production SFU/TURN provisioned (2026-11-08)

Production-only Cloudflare Realtime resources were created:

| Resource | Name | Cloudflare resource ID |
| --- | --- | --- |
| SFU application | `sharika-production-audio` | `e5be747936071f3b0bdaea80d26d9793` |
| TURN key | `sharika-production-voice-turn` | `62335412afb939c770491eeeb73267cd` |

- The Production Worker `sharika-api-production` has all four bindings of type
  `secret_text`: `REALTIME_SFU_APP_ID`, `REALTIME_SFU_APP_SECRET`,
  `REALTIME_TURN_KEY_ID`, and `REALTIME_TURN_API_TOKEN`. Secret **values are not
  stored in this repository** and were not copied from staging.
- An internal maintenance version was deployed to permit secret binding.
  Cloudflare subsequently generated new internal deployments on bulk-secret
  updates. The Worker still serves the **fail-closed 503 placeholder**, not the
  real application. Its workers.dev subdomain and preview URLs remain disabled;
  the `sharika.app` zone has **no Worker routes**, and the script has no custom
  Worker domain. This is **not a public API**.
- Live read-only bindings inspection confirms D1 `DB` points to the Production
  database `44425c0a-c691-4e39-a11a-a6e29089d1a3` and R2 `MEDIA_BUCKET`
  points to `sharika-production-media`. No D1 migrations were rerun and no
  R2 contents were copied. Read-only journal counts: Production 1 baseline,
  Staging 71 entries; no old migration was blindly replayed.
- During setup, four incomplete, newly created and unused Realtime resources
  were removed after verifying their exact IDs. The sole existing staging SFU
  and TURN resources were preserved. Those removed empty resources can be
  recreated with new IDs but their one-time keys cannot be recovered.
- The planned future Production origin is `https://api.sharika.app`; it is
  **not yet configured, verified, or routed**, and there is no DNS record for
  `api.sharika.app`. Do not point a Play release AAB
  or users to it before application QA and a separately reviewed activation.

Still blocked: Production Firebase identity and auth validation; full Worker
app deployment with Durable Objects and isolated rate-limit bindings;
production media population; server-side wallet/recharge/agency/game audit;
two-device voice QA; Android release build/signing; Play Store review.

## Follow-up: Production Invite secrets and Firebase/CI audit (2026-11-08)

- Fresh cryptographically random, **Production-only** credentials were generated
  and verified as Cloudflare Worker `secret_text` bindings:
  `INVITE_DEVICE_PEPPER` (one-device invite digest) and
  `INVITE_BANK_ENCRYPTION_KEY_B64` (32-byte AES-GCM bank-data key).
  Neither secret value is present in GitHub or this report, and neither was
  copied from staging. Retain the Worker secret binding across future releases;
  encrypted bank records would become unreadable if its key is lost.
- The guarded production entry now fails readiness if either key is missing
  or malformed, and `wrangler.production.jsonc` declares them required.
  This addition is **source-only** until a separately reviewed application
  deployment; the live Worker continues to serve its isolated 503 placeholder.
- The Android bundle's `google-services.json` points to Firebase project
  `sharika-voice-chat-app`; the Staging Worker uses the same project.
  The Production Worker has **no** `FIREBASE_PROJECT_ID` binding. The decision
  to share that identity provider or separately configure a Production Firebase
  project is pending; never assume a token from another Firebase project is
  valid. Production D1 accounts and balances remain isolated either way.
- The staging Worker has additional bindings for the legacy Family Sheets
  integration; they were **not** copied to Production, since Family has been
  superseded by Agency. The Production DO and rate-limit bindings also remain
  absent until the real application is explicitly reviewed for deployment.
- Full local `npm run check` completed again: **638 tests passed, 0 failed**.
  The runner has Java but no Gradle, Android SDK manager, or bundletool, so
  no new AAB or merged-manifest verification was possible here.
- The Production Worker has no public route, custom domain, `workers.dev`
  subdomain, or preview URL. `api.sharika.app` is only a proposed endpoint,
  with no DNS record; no Google Play publication was initiated.
