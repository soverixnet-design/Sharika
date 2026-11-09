# Sharika readiness — 9 November 2026

Status: staging verified in the areas below; full app acceptance and Play production publication remain incomplete.

## Verified evidence

- Application commit: `b923a309068412411d878ee777e4f4cd14c1ae98` on `feature/sharika-full-integrated-staging-20261107`.
- Worker/Admin publish: [successful run](https://github.com/soverixnet-design/Sharika/actions/runs/42609070349).
- Signed Android AAB candidate: [successful build and artifact](https://github.com/soverixnet-design/Sharika/actions/runs/42609070268). Artifact ID `13669691574`, `Sharika-Play-Store-Candidate-AAB`. This is not evidence of Play approval or a production-ready purchase flow.
- Admin `/health` returned `ok:true` and `api_service_configured:true`; `/admin/` returned HTTP 200 with CSP and no-store; unauthenticated seller API returned HTTP 401.
- Served admin connector exactly matched the tested source (SHA-256 `254a7eb2c607f02fd9f2f36cbd86b4653134a9f6dc6a4c754ecf386e0fb67a28`).
- Local validation: 644 Node tests and all 18 standalone SQLite checks passed. The common `npm run check` now includes every SQLite regression, including purchase replay, seller migration, staff expiry, special IDs and banner events that were previously outside its explicit list. Tests run from a stable repository directory.

## Staging database work completed

The read-only schema inventory found migration `0066_google_play_verified_coins.sql` missing from staging. Applied its additive purchase receipt table and index to the existing `sharika-staging` database. Both now exist and the table has zero purchase rows. No billing switch was enabled.

Before/after checks matched: 9 users, total main coins 620825030, total diamonds 47328154, and 2746 wallet-ledger rows. No user balance or transaction was edited by this work.

Salary readiness query found one active adult account with at least 10000 matured available units, and two approved active adult sellers. Current policy: weekly settlement, 40% host / 10% agency / 5% BD, 5M minimum host target, 500000 coins/USD, shared exchange/transfer switch enabled. This is readiness evidence only: no live transfer or exchange was submitted.

Two salary-history indexes use different names and ordering on the live database (`sender_idx` / `receipts_idx`, ordered by ID) than the repository migration (`user_idx` / `recipient_idx`, ordered by date). Existing indexes and live triggers were preserved; a name difference was not treated as permission to replace financial guards.

## Concrete remaining work

1. **Authenticated acceptance:** admin opens at its sign-in form in the available browser. Sign in with an existing authorized account, then verify seller lists/history, agency settings, grants/revokes and login recovery. Do not bypass authentication or create a synthetic admin.
2. **Salary transaction QA:** eligible data now exists; perform an explicitly selected authenticated test and reconcile balances and audit rows. Read-only eligibility does not establish transaction success.
3. **Play Billing configuration:** staging has `SHARIKA_PLAY_BILLING_ENABLED=false` and no `PLAY_BILLING_SERVICE_ACCOUNT_JSON` binding. Configure authorized Publisher access and actual products in the intended release environment, then test purchase, replay, interrupted recovery and refunds. Seller-specific Play recharge remains explicitly unconfigured in source.
4. **Release environment:** verify a dedicated production API origin and database plan, upload certificate acceptance, Play-signing Firebase fingerprints, Console declarations, reviewer access and testing-track state. Existing AAB success does not verify these external requirements.
5. **Physical Android acceptance:** two accounts on two phones must verify bidirectional voice, microphone permission, background recovery, join/leave presence, device back, seat selection/locks, image refresh, gifts, keyboard layout and games while voice continues.
6. **Other feature enablement:** automatic ranking rewards remain disabled; FCM service-account binding is absent. Complete feature-specific configuration and verification before claiming automated rewards or push delivery works.

No Play Console submission, real purchase, salary transfer, payout or production publication was performed in this pass. Historical release checklists are not proof that current tasks have passed; use observed results above.
