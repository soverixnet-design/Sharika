# Sharika Production Worker — release preflight (public release blocked)

Date: 2026-11-08 (UTC). The initial offline preflight did not deploy a
Worker or mutate D1/R2. Follow-up infrastructure work deployed the full
**compile-time-locked Production Worker internally**, with an isolated SQLite
Durable Object class and separate action/finance rate-limit bindings. There
is still **no public route or URL to the Production API Worker**. A later
Access-protected, **data-free QA probe** has its own separate route; see the
latest follow-up. Existing staging and user data remain untouched. The chronological record below distinguishes earlier stages from
the latest guarded deployment.

## Prepared in the isolated GitHub production branch

- `wrangler.production.jsonc` selects `src/production-entry.mjs` and binds
  **only** `sharika-production` D1 and `sharika-production-media` R2.
- A dedicated Production `VOICE_ROOMS` Durable Object class and isolated Rate
  Limit namespaces `410301` / `410302` were prepared in the config and later
  deployed independently of Staging (see the final follow-up section).
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
- Offline tests alone do not demonstrate live voice, Android device behavior,
  or billing validation. A later guarded Worker deployment was verified
  through the Cloudflare API, but **end-to-end app QA remains pending**.

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

## Follow-up: actual Production Worker bundle staged, not deployed (2026-11-08)

- Uploaded the CI-compiled `production-entry.js` full application bundle
  (755,531 bytes) as a **new version only** of the distinct Cloudflare Worker
  `sharika-api-production`. Cloudflare returned **version 7**,
  `d0cc7612-fd69-4031-9ae9-7b3dade993f4`, annotated with source commit
  `925ca3ae59b1a8e62e0ee69d98dad8a403fa70fc`.
- Version-upload metadata kept the previous `d1`, `r2_bucket`, `secret_text`
  and `plain_text` bindings. A read-only inspection of the new version's
  resources confirmed all **12 intended existing bindings** were retained,
  including the separate Production `DB` and `MEDIA_BUCKET`. Secret **values**
  were neither read nor included in this report.
- The latest **deployed** Worker remains the previous fail-closed maintenance
  deployment `ba728d4d-7fec-4a4d-9567-c77d65be9d4d`, serving version 6
  `f19395c0-ca4b-497c-a7f0-28ea35bafb2f` at 100%; the uploaded full
  version 7 receives **0% traffic**. The Worker subdomain and previews remain
  disabled, and the zone has **zero Worker routes**.
- This version-only upload made **no D1 or R2 data changes**, applied **no
  SQL or Durable Object migration**, and created **no live `VOICE_ROOMS`
  Durable Object or action/finance rate-limit bindings**. It does not count
  as a full Production Worker deployment or as end-to-end QA. The compiled
  entry retains `RELEASE_REVIEW_APPROVED=false`, which forces HTTP 503.

Next: review/apply the **new, isolated** SQLite Durable Object migration and
Production rate-limit bindings through an explicitly guarded Worker
deployment path (no old D1 migration replay); verify deployment/rollback,
then run restricted Firebase, wallet/game/agency, media and two-device voice
tests before approving any public URL or Production Play Store AAB.

## Follow-up: isolated Production Voice DO and rate limits deployed (2026-11-08)

- After inspecting Cloudflare's current Worker multipart-upload schema and
  Durable Object class-migration guidance, deployed the **same checksum-verified**
  755,531-byte bundle to **`sharika-api-production` only**, using the Worker
  Upload API. Bundle SHA-256:
  `dd430d3356b15947b0a372b8e77cb5bd3f02a693e44e470c433b02df3035425b`.
  New deployed **version 8**: `d6d8d200-64e6-47f9-a798-9fe518347eee`;
  deployment: `06c568ee-212e-47c5-ba7b-887cb71d3b73` at 100%.
- Applied exactly **one new Worker-level class migration**, tagged
  `v1_sharika_production_voice_rooms`, with
  `new_sqlite_classes: ["SharikaVoiceRoom"]`. The resulting Production
  namespace `0c6da952f7744ffc93d5e1cbee33ffe5` is separate from Staging's
  `ccfdddd52ef74433ae04b11e437b991d`. This is **not a D1 SQL migration**;
  no old SQL migration was run or replayed.
- Added Production-only `VOICE_ROOMS` (`durable_object_namespace`) plus
  `SHARIKA_ACTION_RATE_LIMIT` (`410301`, 120 actions/60 seconds) and
  `SHARIKA_FINANCE_RATE_LIMIT` (`410302`, 20 actions/60 seconds). Cloudflare's
  rate-limit binding enforces approximate per-location limits; it is not a
  globally strict financial ledger lock.
- Preserved all **12 existing D1/R2/secret/plain-text bindings**, then added
  these three bindings and four explicit fail-closed `plain_text` policy flags.
  Read-only inspection confirms **19 total bindings** and enabled Worker
  logs/traces. No secret values were exposed in the report.
- Read-only D1 migration journal queries **after deployment** show unchanged
  counts: Production `1`, Staging `71`. Staging Worker still binds its own D1
  `b2c62252-12a5-4740-90c7-01a536d9a39a`, R2
  `sharika-staging-media` and original Voice DO namespace. Production D1 is
  `44425c0a-c691-4e39-a11a-a6e29089d1a3` and Production R2 remains
  `sharika-production-media`.
- **Public rollout remains blocked:** Production `workers.dev` and preview
  subdomains are disabled; there are zero zone Worker routes. The deployed
  source contains `RELEASE_REVIEW_APPROVED=false`, and
  `SHARIKA_PUBLIC_API_ENABLED=false` is bound. No cron/scheduled handler was
  exported. Therefore **0% public app traffic** is routed to this Worker.
- Rollback reference: former maintenance version 6
  `f19395c0-ca4b-497c-a7f0-28ea35bafb2f` remains in version history.
  A code rollback does **not** undo newly created Durable Object resources;
  no rollback is currently needed.

Next: perform a restricted API test path with explicit access controls, then
verify Firebase identity against separate Production app records, two-device
voice and media, coin ledger/recharge/agency invariants, app URL routing and
Play upload certificate. Do **not** open public routes or upload a
Production-origin AAB until these release checks pass.

## Follow-up: Access-protected QA URL prerequisite blocked (2026-11-09)

- Investigated the next release gate: an **Access-protected** restricted QA
  hostname, intended to allow verified testers to exercise Production before
  any public API release. The Cloudflare API responded **HTTP 403** with
  `access.api.error.not_enabled` for Access apps, reusable policies, and
  identity-provider inventory. This is a **Zero Trust Access onboarding
  prerequisite**, not evidence that a policy is protecting an endpoint.
- Opened the Cloudflare Dashboard in the available cloud browser, but it
  presented the **Sign in to Cloudflare** page; no authenticated owner session
  or Access onboarding was available there. No credentials were requested or
  reproduced. Access onboarding could involve organization/team or plan
  choices, so no new account setup was attempted without the owner.
- **Safety gate upheld:** no QA DNS record, Cloudflare Access application or
  reusable policy, Worker route, public workers.dev URL, or preview URL was
  created. The Production API remains compile-time locked and unreachable
  publicly. No policy-bypass substitute was introduced.
- A separate **read-only** D1 `PRAGMA quick_check` returned `ok` for both
  isolated Production and Staging databases. The check did not create or
  mutate tables or user data.

**Owner prerequisite:** enable Cloudflare Zero Trust Access in the existing
Cloudflare account through an authenticated owner Dashboard session (choose
the intended plan/team identity as applicable). After that, recheck the
identity providers, create a reusable **single-email allow** policy and
self-hosted QA application, test unauthorized denial **before** attaching any
restricted route, and retain `RELEASE_REVIEW_APPROVED=false` until separate
on-device functional QA is ready. Production API must remain closed in the
interim.


## Follow-up: Zero Trust owner-only QA access prepared (2026-11-09)

- The owner activated **Cloudflare Zero Trust Free** on the same account.
  Read-only Access API checks now succeed; organization/team:
  `broken-dew-401f` (`broken-dew-401f.cloudflareaccess.com`).
  The configured Cloudflare identity provider is present. The former
  `access.api.error.not_enabled` prerequisite is resolved.
- Created a **reusable**, single-email Access `allow` policy, named
  **Sharika Production QA - Owner Only**, ID
  `d4af9e02-cc48-4fcb-9819-2755d06a4af2`. The sole `include` selector
  is the verified owner's `soverixnet@gmail.com` email; session duration
  is one hour. No wildcard, everyone, or broad group selector was added.
- Created a **self-hosted** Access application named
  **Sharika Production QA - Owner Access**, ID
  `f40580a8-1a45-4814-86fc-fb28921efd01`, with intended hostname
  `qa-api.sharika.app`, hidden from the app launcher and linked to the
  reusable owner-only allow policy at precedence 1. Read-only GET checks
  confirmed the policy and application are present and linked as intended.
- **Important: Access configuration does not make this hostname live.**
  Read-only verification showed **zero** DNS records for
  `qa-api.sharika.app` and **zero** Cloudflare zone Worker routes.
  Production `workers.dev`/preview URLs remain disabled, and the deployed
  Worker has compile-time `RELEASE_REVIEW_APPROVED=false` plus
  `SHARIKA_PUBLIC_API_ENABLED=false`. No public API traffic was enabled.
- No D1 SQL migrations, storage changes, user-data edits, or staging changes
  were made by this Access setup. These settings are **configuration-only**;
  they do not constitute browser-login verification or an end-to-end API test.

**Next release gate:** validate Access-denied behavior for an unapproved
identity and owner sign-in via a controlled temporary route, with a reviewed
activation and rollback plan **before DNS/route exposure**. Then run the
separate Production Firebase, wallet/agency/game, media, two-device voice,
Android build/signing and Play Store release checks. Do not unlock the
Production API merely because the Access policy now exists.


## Follow-up: live Access-gated QA probe published, Production API closed (2026-11-09)

- Created a single **proxied A DNS record** at `qa-api.sharika.app` pointing
  to Cloudflare's **originless documentation placeholder** `192.0.2.0`
  (record ID `ba89cfe00b430da02fb12f5ea126299f`). This does not point to
  Production D1, R2, the app's existing origin, or an external server.
- Before connecting a Worker route, opened the QA hostname in a clean cloud
  browser. It redirected to the correctly named **Cloudflare Access sign-in**
  page. The Access application remained linked to the **single-email owner**
  allow policy. This proves an unauthenticated browser is challenged, **not**
  yet that a different authenticated identity is denied.
- Deployed an isolated **`sharika-qa-access-probe`** Worker containing only a
  static Royal-style QA confirmation page. Its source is committed in
  `cloudflare/qa-probe/worker.mjs`. Local syntax and four handler smoke tests
  passed. It has **zero bindings**, no storage/secret access, no external fetch
  and no access to the Production Worker. Direct `workers.dev` and preview
  subdomains were set to **disabled** and verified through the API.
- Added exactly one scoped Worker route:
  `qa-api.sharika.app/*` → `sharika-qa-access-probe`, route ID
  `e2b715e8b64c4fc490b77dbe1cdcb851`. Browser verification **after**
  adding the route again redirected the unauthenticated visit to Cloudflare
  Access sign-in. There is **no route pointing to**
  `sharika-api-production`. Its `SHARIKA_PUBLIC_API_ENABLED=false` binding,
  internal compile-time `RELEASE_REVIEW_APPROVED=false`, and disabled
  `workers.dev`/previews remain unchanged.
- **Owner sign-in is pending:** the owner must open
  `https://qa-api.sharika.app/` from their phone and authenticate using the
  approved `soverixnet@gmail.com` Cloudflare identity. Successful sign-in
  should reveal the standalone QA confirmation page; it does not expose
  real app functions. A signed-in, **unapproved** identity still requires a
  separate explicit deny test or Access authentication-log evidence.
- No Production/Staging D1 SQL migration, R2 change, voice-room action,
  financial operation or user-data mutation was performed. **This is not an
  app functional QA pass or authorization to unlock the Production API.**

**Rollback:** remove only the precisely scoped route
`e2b715e8b64c4fc490b77dbe1cdcb851` and, if appropriate, the test-only
DNS record `ba89cfe00b430da02fb12f5ea126299f`; preserve the Access
policy/application and the original Production/Staging Workers and data.
No rollback is currently indicated. Next: verify owner login and alternate
identity denial, then plan guarded functional tests in a separate release
review before any real Production API route or Play Store publication.


## Follow-up: owner mobile QA login independently verified (2026-11-09)

- The owner provided a mobile screenshot showing the actual
  `https://qa-api.sharika.app/` page with heading **Sharika QA Access** and
  the expected data-free confirmation text (phone screenshot around 00:32
  Asia/Muscat time). The screenshot alone cannot prove which identity signed
  in, so a separate Cloudflare log verification was performed.
- Read-only GET of the account's **Access authentication logs** returned an
  `action: login`, `allowed: true` event at
  **2026-11-08T20:31:56Z** for the QA Access application UUID
  `f40580a8-1a45-4814-86fc-fb28921efd01`, authenticated as exactly
  **`soverixnet@gmail.com`**. The Access user registry also shows this
  exact owner's identity. This matches the mobile screenshot time and target.
- **Owner identity and end-to-end Access sign-in are now verified.** The
  previously demonstrated unauthenticated challenge remains confirmed.
  An explicit signed-in **unapproved account denial test is still pending**;
  do not infer that test passed merely from the single-email allow selector.
- The test hostname still routes only to the isolated, no-binding
  `sharika-qa-access-probe` Worker. It does **not** route to the guarded
  `sharika-api-production` Worker. The successful QA page does **not**
  verify Production Firebase, financial ledgers, room voice, games, media or
  Android release readiness. No data migration or production rollout occurred.

Next: run/record an authenticated unapproved-identity negative test using a
separate existing test account if one is available; then review the remaining
high-priority functional blockers and build/signing readiness. Keep the
Production API fail-closed until those tests pass and a separate release
approval is recorded.


## Follow-up: staging functional preflight and Play publication gates (2026-11-09)

- Ran the current **local staging worktree's** `cloudflare/npm run check`
  without deploying: **638/638 Node tests passed**, along with SQL fixtures
  covering Agency/BD/Host split, Salary -> Coin Seller settlement replay
  protection, gifts and rooms. Separate Android banner test: **3/3 passed**.
  The key staging UI/room/game JS syntax checks passed. These are code and
  in-memory SQL checks, **not** two-device voice, live games, or app QA.
- The local staging checkout contains **uncommitted existing changes**.
  These local test results cannot be claimed as a retest of the exact remote
  signed AAB artifact's commit without a separate source-match review.
- **Read-only D1 checks**: `PRAGMA quick_check=ok` for both Staging and
  Production. Staging has **two active adult Coin Sellers**, weekly Agency
  settlement policy enabled at a 5,000,000-coin host target, and recorded
  Agency earnings. An aggregate read-only calculation using the SQL guard's
  maturity/target/consumed-Salary criteria returned **zero accounts with at
  least 10,000 matured available Salary units**. The live Salary -> Seller
  transfer acceptance test is therefore **not currently runnable** with
  natural matured funds; no test wallets, credits, or user records were
  fabricated or mutated. Staging migration journal remains at **71**.
- Rechecked the existing successful **GitHub Actions AAB preflight run**
  [#77](https://github.com/soverixnet-design/Sharika/actions/runs/42515633118):
  all build, verification and artifact upload steps passed. Existing artifact
  `Sharika-Play-Store-Candidate-AAB`, ID `13631775269`, is not expired
  and was built at source SHA `2d242d57d2c1afae2f8085a26019fe25c195cd63`.
  It packages **Staging** and uses an `existing-stable` signer; its Play
  Console upload certificate match is **unverified**. It must **not** be
  submitted as a Production-backend release.
- Attempted to inspect the Android build workflow in the authenticated
  GitHub browser; GitHub required an additional **2FA setup verification**.
  This protected security checkpoint was **not skipped**. The current local
  environment also has Java but **no Gradle CLI/Android SDK**, and the
  connected GitHub tools do not expose workflow dispatch; **no new AAB was
  built or submitted in this follow-up**.
- Verified Google's current official Play requirements:
  [target API 36 for new apps](https://developer.android.com/google/play/requirements/target-sdk)
  is present in Gradle (`targetSdk 36`, `versionCode 103`). If the owner's
  Personal developer account was created after 2023-11-13, Play requires at
  least **12 testers continuously opted in for 14 days** before applying for
  Production access:
  https://support.google.com/googleplay/android-developer/answer/14151465 .
  Supplying tester email addresses alone does not establish opt-in.
- **Policy review needed before public release:** in-app Coin Seller/Official
  Recharge flows could direct purchasers to payments outside Play Billing,
  and paid-coin games with cash/redeemable prizes would require separate
  real-money gaming scrutiny. Check the actual shipped behavior against
  https://support.google.com/googleplay/android-developer/answer/9858738
  and https://support.google.com/googleplay/android-developer/answer/9877032 .
  Do **not** assume that an 18+ rating resolves payment/gambling restrictions.
  No seller/payment/game behavior has been changed unilaterally.
- The owner-only Cloudflare Access login was independently verified in the
  preceding follow-up. A denied sign-in from an **authenticated, unapproved**
  Cloudflare identity remains **untested**, because only the owner identity
  appears in the current Access user registry/authentication log.

**Next release decisions:** complete GitHub 2FA verification and a new
signed *test* AAB build; obtain a second already-existing test identity for
Access denial without granting it application permission; run two-device
voice and wallet/agency/gaming QA using appropriately isolated test data;
and settle the Play Billing/coin-recharge/payout policy design before a
Production API unlock or worldwide Play Store distribution. No Production
publishing, routing or financial feature flags were changed by this work.
