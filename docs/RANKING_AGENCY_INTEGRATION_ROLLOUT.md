# Sharika — central verified Ranking & Reward integration (staging candidate)

## Why this branch exists

Draft PR #102 built an alternative `0059_bd_agency_host.sql` against an older
Family branch. The **actual** `sharika-staging` D1 database already contains
`0059_agency_host_earnings.sql` through `0064_agency_salary_targets_exchange.sql`
from the later Agency/Salary branch. Both versions create
`sharika_agency_hosts` with **incompatible columns** (`agency_id` vs
`family_id`). Running the older draft's migration on the deployed schema
would be unsafe, even though both are nominally additive.

This integration is based on the existing
`feature/sharika-agency-salary-targets-integrated-20261106` branch.
It cherry-picks **only** the independently tested ranking phases (verified
activity, read-only API, guarded TOP rewards), retains the installed
Agency/Salary system, and renumbers the additive migrations to 0065 and 0066.
The alternative Agency/Host 0059 migration is **not included**.

## Existing business rules are unchanged

- Host 40%, Agency Owner 10%, BD 5% of original gift value.
- USD 1 = 500,000 virtual coins; minimum Agency host target 5,000,000 coins.
- Salary Exchange remains disabled until explicitly enabled by an authorized
  Super Admin. Ranking coin prizes do not convert salary or crystals.
- Existing Diamond Exchange rate and custom account overrides are untouched.
- Existing Agency, Family history, wallet, recharge and game ledgers are
  retained. No historical ranking entries are backfilled or paid.

## New central verified API / unchanged app layout

| Existing Android tab | API source | Display |
| --- | --- | --- |
| Rich / Sending | `GET /api/v1/rankings/verified?kind=sending&period=weekly` | Sent gift coins |
| Play | `GET /api/v1/rankings/verified?kind=game&metric=wins&period=weekly` | Real game wins |
| Recharge | `GET /api/v1/rankings/verified?kind=recharge&period=weekly` | Approved recharge coins |

Daily, weekly and monthly filters use the existing UI; the API computes UTC
windows. The verified activity journal captures successfully settled gift
transactions, approved recharge receipts and server-settled game bets,
including Sovera Gaddy. Active Special IDs stay masked; users can open a
verified profile using the displayed searchable ID. Historic Lucky/Charm/Room
tabs continue to use their existing authenticated, settled-gift service.

The Admin website's existing **Rankings** menu offers verified leaderboards,
editable TOP 1–7 targets and coin prizes, future-period versioning, a global
emergency pause and a last-period preview. Super Admin actions are audited.
The server owns scores/winners; no client result or arbitrary user ID may
mint an award. The automatic ranking flag in `wrangler.jsonc` stays `false`,
and migration 0066 seeds a paused rewards switch, with no default prize rules.

## Staging release gates — NOT yet completed

1. Confirm `sharika-staging` account ID, database UUID, installed Worker
   version and currently applied migrations. Do **not** apply the alternative
   Agency 0059 from PR #102.
2. Review **all pending migration files**, not just 0065–0066. At inspection,
   the database did not yet report some unrelated files found in this branch
   (including Sovera Gaddy and premium media), so a blanket Wrangler
   `migrations apply` may introduce other features. Perform a complete schema
   diff and explicitly approve the combined staging migration set.
3. Capture a D1 SQL export and Time Travel bookmark immediately before any
   remote changes. Protect the export and test the recovery path. Record the
   pre-change wallet sum and row counts in a private release log.
4. Apply approved migrations on an isolated **copy** first, run `PRAGMA
   foreign_key_check` and test real simulated gift, recharge, Sovera Gaddy,
   other game, and Agency accrual with retries. Only then migrate the intended
   staging database. Never replay 0059 Agency schema variants.
5. Deploy only `sharika-api-staging`, then the matching staging Admin frontend.
   Keep automatic ranking award environment flag off and global pause on.
6. Run a **new full UTC ranking period** with consented test accounts; compare
   leaderboard scores with source receipts, old wallet balances, and Agency
   salaries. Verify Android APK on at least two physical phones, including
   Google/Gmail sign-in and Room voice during game/leaderboard use.
7. Super Admin must select exact TOP prize amounts, targets and activation
   windows before any settlement is enabled. Verify one controlled test award
   with wallet + ledger reconciliation, then a replay and pause test.
8. Play Store AAB / production deployment requires a separate final QA review.

## Local evidence

- `cd cloudflare && npm run check` — JS and existing SQL suites.
- `python3 cloudflare/test/verified-activity-sql.test.py` — an in-memory
  migration replay, real settled events and exact-once receipts for five
  game families, recharge filtering, immutable history and rollback.
- Applying every migration in this **merged local tree** to fresh in-memory
  SQLite must succeed before uploading a candidate.
- GitHub Actions can build a **staging-only** APK with the existing stable
  staging signing certificate; an APK artifact is not a production release.

No remote D1 migration, API deployment, salary conversion or payout is
authorized by this checklist alone. Record verification evidence first.
