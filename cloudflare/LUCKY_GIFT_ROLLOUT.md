# Sharika Lucky Gift — isolated staging rollout (2026-10-30)

## Verified state

- Reviewed Lucky Gift source: `feature/sharika-lucky-gifts-20261030` (review PR #4).
- Original Sharika HTML/CSS/room artwork is unchanged.
- Cryptographic server-only odds preserve the original Lucky Gift table:
  `0x=70.2%, 1x=15%, 2x=8%, 5x=4%, 10x=2.5%, 50x=0.3%`.
- Adult gating currently derives from the Firebase-authenticated user's stored profile
  birthdate and minor flag; it is **not legal identity or age verification**.
- Money changes use one D1 batch: gift debit, immutable debit ledger,
  optional Lucky reward credit/ledger, a single outcome record, recipient
  gift events/XP. Idempotency uses existing `sender_uid,request_id` uniqueness.
- No result may be supplied by the Android client.

## Applied only to isolated staging D1

The additive SQL in `migrations/0013_lucky_gift_outcomes.sql` was applied
to the **existing staging D1 only** on 2026-10-30 using a single batch
(create table, index, replace event-validation trigger).

The initial and post-change read-only checks both showed:
`users=2; gift_transactions=5; gift_events=5; ledger_entries=20`.
The new Lucky outcome table has zero records. Event-validation guard exists.

**Important legacy migration journal drift:** remote `d1_migrations` still
contains only one row, although later migrations' tables exist. Do **not**
blindly run `wrangler d1 migrations apply --remote` on this database.
Reconcile journal vs actual schema with an explicit maintenance plan first.
No existing data was deleted and the journal was not modified.

## Worker and Android build

- CI with unit tests and disposable in-memory SQLite migrations:
  https://github.com/soverixnet-design/Sharika/actions/runs/41080589173
- New Android debug APK workflow:
  https://github.com/soverixnet-design/Sharika/actions/runs/41080757134
- Verified staging API source deployment:
  https://github.com/soverixnet-design/Sharika/actions/runs/41082603727
- The reviewed source pin is `bb4aeea0910a5109458f4ee9c7f5c4403516832e`.
- API health returned 200; unauthenticated gift endpoint returned 401.
- Worker name is `sharika-api-staging`, **not production**.
- `SHARIKA_LUCKY_GIFTS_ENABLED` is explicitly `false` in deployed bindings.

## Before activating Lucky coin payouts

1. Clarify whether coins can ever be transferred, redeemed, sold back or
   exchanged for real-world value; review required platform/market rules.
2. Implement any needed true age and location restrictions. Self-declared DOB
   does not constitute strong age verification.
3. Confirm that the staged Lucky catalogue contains approved active tab=2
   gift items and that all wallet balances are test-only.
4. Test 18+ sending, insufficient coins, replay, 0x and 50x, sender and
   recipient animation, room history, and concurrent requests using isolated
   controlled test accounts.
5. Only after this review, explicitly enable the feature on **staging only**.
   Production rollout is a separate authorization and migration.

The present APK contains the Lucky Gift client code, but Lucky may remain
hidden until the staging feature flag is intentionally enabled.
