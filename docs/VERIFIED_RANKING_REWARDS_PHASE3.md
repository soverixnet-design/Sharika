# Sharika — verified ranking targets and automatic coin prizes (Phase 3)

## Safe-by-default staging integration

This feature extends the verified activity ledger from migration `0065` and its
read-only `GET /api/v1/rankings/verified` endpoint. It does **not** backfill
history, change Android layouts, migrate wallets or publish prizes on install.

- Migrations: `cloudflare/migrations/0065_verified_activity_events.sql`
  and `cloudflare/migrations/0066_automatic_ranking_rewards.sql`
- Worker: `cloudflare/src/ranking-rewards.mjs`
- Admin UI: **Rankings → Automatic Ranking Targets & Rewards**
- Test: `cd cloudflare && npm run check`

Publication alone **never pays** a user. All three independent controls must
permit settlement:

1. A verified Super Admin publishes a rule with `enabled: true`, with up to seven
   rank prizes and minimum target scores. A new immutable rule version is
   effective only from the **next full UTC day/week/month**. The previous
   version continues to govern the already-running period.
2. A Super Admin explicitly unpauses the global emergency switch. Migration
   `0066` seeds `paused=1`; D1 checks it again in the receipt transaction.
3. Cron automatic payment additionally requires `auto_award: true` on the
   effective published rule and the deployment environment variable
   `SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED=true`. Wrangler staging defaults
   it to `false`. Manual confirmed settlement remains available to a Super
   Admin even with the cron flag off, but still requires an enabled rule and
   the global switch unpaused.

No prize values or targets are prefilled. A Super Admin decides them; zero
prize is allowed for an unused rank. Individual prizes are capped at one
million coins and each rank has a separately editable minimum score.

## Verified score and winner selection

| Board | Verified source | Score | Period |
| --- | --- | --- | --- |
| Sending | Settled gift transactions | Coins spent | UTC daily / weekly / monthly |
| Recharge | Approved seller/finance recharge ledger | Coins credited | UTC daily / weekly / monthly |
| Games | Server-settled real bets | Wins / stake coins / payout coins; optionally per-game | UTC daily / weekly / monthly |

Rank is deterministic: descending verified score, then ascending canonical
user number to break ties. Only active users participate. The UI displays an
active Special ID instead of a hidden canonical number. Each rank must reach
its minimum score to collect its configured prize. Ranking history before
migration `0065` cannot qualify for this new payout system.

All automatic/manual settlements run only on the **last completed** period,
after a ten-minute delay to allow late server results. The system does not
scan or pay historical periods automatically. Re-running the same period
returns a duplicate receipt without crediting coins again.

## Wallet / concurrency safety

- D1 `batch()` atomically writes a unique `(policy_key,period_start)` batch,
  rank-specific award receipts, each protected wallet credit, immutable wallet
  ledger entries and a Super Admin audit record.
- A second invocation cannot insert the same batch; the whole transaction is
  rolled back. The same active user cannot win two ranks in one batch.
- Wallet updates require active accounts and a safe maximum balance; failures
  reject and roll back the full period.
- The global pause guard is a D1 trigger on the batch insert, protecting a
  concurrent Super Admin pause from the preflight/read race.
- A notification receipt may be issued **after** a committed award; an FCM
  outage cannot undo a paid prize.
- Existing CP ranking, manual event prizes, recharge flows, game results and
  wallet history stay separate.

## Authenticated Admin API

These routes are under `/api/v1/admin/` and require the usual verified Firebase
JWT and D1 admin role; no client-provided winner or balance is accepted.

- `GET ranking-rewards?kind=sending&period=weekly` — Super Admin or Finance:
  current/past rule, last finished verified TOP 7, eligible prize preview,
  settlement receipt, and emergency pause state.
- `GET ranking-rewards?kind=game&period=daily&metric=wins&game=fruit-royale`
  — optional exact validated game scope.
- `PATCH ranking-rewards` — Super Admin only, body: `{kind,period,metric?,game?,
  enabled,auto_award,targets:[7 integers],prizes:[7 integers]}`. Publishes a
  future-only version, audited in D1.
- `POST ranking-rewards/pause` — Super Admin only:
  `{paused:true|false,confirm:true}`.
- `POST ranking-rewards/settle` — Super Admin only:
  `{kind,period,metric?,game?,confirm:true}`. Pays only the last complete
  eligible period; no arbitrary backdated time or recipient IDs.

## Release checklist (not completed)

1. Review the draft PR and apply additive migrations `0065` and `0066` to a
   **backed-up isolated staging D1** first. Ensure old balances match before
   and after the migration. Migration alone does not enable rewards.
2. Deploy the staging Worker/Admin changes with automatic flag still `false`;
   verify authenticated read-only rankings and finance read permissions.
3. Let one full UTC window accumulate genuine verified transactions after
   migration, then verify displayed leaderboard and preview against wallet,
   gift, recharge and settled game receipts.
4. Super Admin approves exact prize/target amounts and publishes a version.
   Test small payouts with a staging-only user, audit ledger/replay, and pause.
5. Only after sign-off, explicitly unpause, opt in to `auto_award`, and decide
   whether to enable the **environment** cron switch. Keep production disabled
   until a separate full release review.

BD/Agency/Host salary and event banners are maintained by the existing
Agency integration and remain **separate** from ranking coin prizes. These
new migrations do not modify Agency compensation or existing Family/BD data.
