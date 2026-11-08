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

1. **Production Firebase live sign-in** remains unverified; the user selected
   the existing Android Firebase project and the Production Worker has since
   received its project ID. Separate Production SFU/TURN credentials have also
   been provisioned (see follow-up sections).
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

Still blocked: Production Firebase live sign-in and auth validation; full Worker
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
  `sharika-voice-chat-app`; the Staging Worker uses the same project. At this
  audit checkpoint, Production had no `FIREBASE_PROJECT_ID` binding. The user
  subsequently chose shared Firebase identity (see next follow-up). Never
  assume a token from another Firebase project is valid. Production D1
  accounts and balances remain isolated.
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

## Follow-up: shared Firebase identity chosen and bound (2026-11-08)

- Owner selected **Option 1**: retain the Android app's existing Firebase
  Authentication project (`sharika-voice-chat-app`) for both environments.
  The Staging Worker already matched that exact project ID. The Production
  Worker now has `FIREBASE_PROJECT_ID` as a protected `secret_text` binding,
  and the future Wrangler config declares it as required.
- A source regression test ensures the Android `google-services.json` project
  matches the Staging Wrangler identity project; Production must use the same
  ID. No Firebase user export, profile copy, wallet transfer, or D1 mutation
  was performed. Signing in with the same Firebase identity will still access
  separate app records in the distinct Production D1 database.
- Read-only Cloudflare verification after binding: Production D1 and R2 remain
  unchanged, the Staging Firebase binding is unchanged, and Production has zero
  public Worker routes or custom domains; workers.dev and previews are off.
- The full Worker check passes **638/638 tests**, including the guarded
  Production entry. These are offline tests, **not** a verified end-to-end
  Firebase sign-in against the not-yet-public Production API.

Next blockers: reviewed real Worker deployment with isolated Durable Objects
and throttles, verified Production login and app records using test identities,
functional wallet/game/agency QA, two-device voice QA, media readiness,
release AAB build/signing and Google Play validation.

## Follow-up: isolated Production branch Android build preflight (2026-11-08)

- The existing GitHub Actions `sharika-play-release-aab.yml` now also runs on
  pushes to `feature/sharika-production-schema-safety-20261108`. For **this
  branch only**, `SHARIKA_PLAY_API_ORIGIN` is forced to the existing Staging
  origin and `SHARIKA_PLAY_STAGING_CANDIDATE=true`; this is a compile/packaging
  test, **not** an installable Production-backend release. The GitHub-release
  publication step is excluded by its unchanged branch condition.
- GitHub Actions [run #77](https://github.com/soverixnet-design/Sharika/actions/runs/42515633118)
  on source SHA `2d242d57d2c1afae2f8085a26019fe25c195cd63` completed
  **successfully**. Source/Worker checks, cosmetic media checkout,
  Android platform installation, Gradle `bundleRelease`, JAR signing
  verification, packaged JavaScript/UI checks, and artifact upload passed.
- Uploaded private workflow artifact: `Sharika-Play-Store-Candidate-AAB`
  (GitHub artifact ID `13631775269`, about 89 MB; expires 2026-12-08).
  The AAB SHA-256 from the workflow is
  `ef234c5bf17a427a97078532fc3d854657af910a1d2563ae2e894ad278b65448`.
- The signing path was **`existing-stable`**, not a separately provisioned
  Play Upload signer. This proves the test candidate is signed but does **not**
  prove its certificate matches the Google Play Console's upload certificate.
- Cloudflare Production Worker remains on its fail-closed internal placeholder;
  no Production Durable Object class was deployed, no financial route was
  enabled, no DNS/Worker routing was created, and no user data was transferred.

Remaining activation gates: obtain a validated Production code deployment
path with correctly scoped Durable Object/rate-limit bindings; verify real
Firebase sign-in and voice on devices using a restricted test origin; review
wallet/recharge/game/agency settlement; verify Play upload signing certificate;
then build a **separate** Production-origin AAB. Do not upload the successful
Staging candidate to the Production Play track.

## Follow-up: Production Worker and Durable Object dry-run passes (2026-11-08)

- Added a separate **read-only CI compilation workflow** at
  `.github/workflows/sharika-production-worker-preflight.yml`, restricted to
  the isolated Production preparation branch. It checks the fail-closed guard
  and database schema, then runs `wrangler deploy --dry-run` with the Production
  configuration. **The workflow has no Cloudflare API token and cannot deploy.**
- [GitHub Actions Production Worker run](https://github.com/soverixnet-design/Sharika/actions/runs/42516166340)
  for commit `925ca3ae59b1a8e62e0ee69d98dad8a403fa70fc` completed
  **successfully**. Wrangler bundled the actual Production entrypoint and its
  exported `SharikaVoiceRoom` Durable Object class. Output was approximately
  737.82 KiB (148.51 KiB gzip). The generated bundle was saved to the private
  `Sharika-Production-Worker-Dry-Run` artifact (ID `13631661377`).
- The dry-run enumerated the intended `VOICE_ROOMS` Durable Object binding
  and `SHARIKA_ACTION_RATE_LIMIT` binding. It proves packaging and config
  parsing only; **no class migration, namespace or rate limiter was created**.
- Read-only post-run Cloudflare inspection confirms the existing Production
  Worker still has **no live DO or action-rate-limit binding**, no public
  Worker URL, previews, zone routes or custom domains. Production D1 still
  points to `44425c0a-c691-4e39-a11a-a6e29089d1a3` and R2 to
  `sharika-production-media`. Migration journals remain **Staging 71** and
  **Production 1**. No D1/R2 mutation or old migration replay occurred.
- CI displayed low-priority Node/toolchain deprecation warnings (punycode,
  legacy url.parse and Node 20-based GitHub Actions), but no Worker bundling
  errors. These do not establish runtime audio, payment or auth behavior.

Next required review: upload/deploy the guarded real Worker through a
properly scoped Cloudflare deployment path that applies the new SQLite-backed
Durable Object migration and rate-limit bindings while keeping all public
routes and schedules disabled. Reconcile existing Production secret bindings
before deployment. A successful dry-run does **not** authorize enabling live
wallet, game, recharge, or Play Store traffic.
