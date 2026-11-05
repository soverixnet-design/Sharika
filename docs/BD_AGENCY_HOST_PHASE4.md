# Sharika Phase 4 — BD → Agency → Host

## User-approved model

This replaces the **visible Family feature** with an Agency Center while
preserving the historical Family membership, Crystal ledger, transfers, and
account balances. The new agency tables are separate; nothing is renamed or
deleted. Existing user logic for Diamond Exchange remains unchanged.

| Recipient / relationship | Gift basis | Default accrual | Who controls |
| --- | --- | --- | --- |
| Host | Total real gift coins received by their Host ID | 40% | Super Admin |
| Agency Owner | Real gift coins received by Hosts in their Agency | 10% | Super Admin |
| BD | Real gift coins received by Hosts in assigned Agencies | 5% | Super Admin |

All rates use integer basis points (4000 / 1000 / 500). In particular, Agency
and BD rates apply to the **full gift value**, not 10%/5% of the Host salary.
The Agency Owner is automatically enrolled as a Host and may accrue both
categories for the same gift.

User-specified **Diamond Exchange** is separate. The earlier discussions about
the exchange value and a 30% user share need reconciliation before any new
salary-to-wallet payout is activated. This phase does not change exchange
rates, seller stock, wallet balances or coin ↔ USD calculations.

## What this code does

- `0059_bd_agency_host.sql`: creates Agencies, Hosts, applications, BD grants,
  default-disabled 40/10/5 policy, nine role/period targets initially **5M
  gift coins**, and immutable receipt-level commission accrual ledger.
- `src/agencies.mjs`: user/BD/Owner authenticated API, admin policy edits,
  Host requests, owner approval and removal, BD assignment, Agency grants and
  target progress. Active Special IDs mask real IDs in the app. Owner approval
  and BD permissions are checked on the Worker.
- `admin/connection.js`: Royal Gold **BD · Agency · Host Center** with policy,
  separate Daily/Weekly/Monthly target settings, BD grant authority, and
  Agency creation. Values are read from central D1, not embedded in the APK.
- `android-staging/staging-connection.js`: replaces the visible Family tile
  with Agency Center, Host applications, BD center, rankings/targets, and
  accrued-salary preview. The Java bridge explicitly permits only the new
  known API paths.
- Existing verified home banners now support a safe `events` action. A Super
  Admin may update the title, image and destination in the web panel; tapping
  the banner opens the existing API-driven Events & Rewards template in the
  app. Event content changes do not require rebuilding the APK once this
  version of the app has been released.

Commission entries are inserted by a D1 trigger during the **same verified
gift transaction**. There is a unique `(gift_event_id, kind)` receipt, so a
retry cannot credit a second entry. One coin = 10,000 accrual units, avoiding
float rounding. A ledger row is *not spendable money*; payout controls remain
disabled and there is no automatic Salary Exchange in this phase.

## Safe activation

The new `sharika_agency_policy.active` defaults to `0`. Family's historic
commission policy remains unchanged until a verified Super Admin chooses to
activate Agency. The policy update uses one D1 `batch()` transaction to switch
old Family future accrual off and Agency future accrual on. The D1
`sharika_agency_legacy_exclusion` trigger fails closed if someone tries to
start Agency with Family still active. Historical ledgers are left untouched.

For example, Host ID receives 1,000 real gift coins in an active Agency:

- Host accrual: 400 coin-equivalents (`4,000,000 units`)
- Agency Owner accrual: 100 coin-equivalents (`1,000,000 units`)
- Active BD accrual: 50 coin-equivalents (`500,000 units`)

Removing a BD stops **future** BD accrual, but does not remove their Agencies
or previously earned ledger rows; Host and Agency Owner accrual continues.

## Verification and release blockers

`cd cloudflare && npm run check` validates the new D1 schema, 40/10/5 gift
entries, zero wallet changes, BD/Host permissions, Special ID masking,
historical Family preservation and replay protections.

Before staging release: back up the `sharika-staging` D1 database, apply
`0057`–`0059` migrations to an isolated copy, check existing ledger totals,
then test a full gift → recipient → Host/Agency/BD accrual through two real
authenticated Android clients. No live or production deployment yet.

Not yet included: automatic Salary Exchange into wallets, configurable salary
tiers beyond one minimum per role/period, BD/Agency/Host payout approvals,
cash withdrawal, and Google Sheets export for the new Agency ledger. Keep
those disabled until the owner approves exact payout and conversion policy.
