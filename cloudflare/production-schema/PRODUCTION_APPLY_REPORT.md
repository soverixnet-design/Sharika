# Sharika Production D1 baseline — applied and verified

Date: 2026-11-08 (UTC)

## Exact production target

- Account: `d81cf7c48fb9b36d468cb0a08720cd74`
- Database name: `sharika-production`
- Database UUID: `44425c0a-c691-4e39-a11a-a6e29089d1a3`
- Worker: `sharika-api-production` — **not deployed**, workers.dev disabled,
  preview URLs disabled, no zone routes
- Media: `sharika-production-media` — R2 public access disabled

## Migration record

- Applied: `../migrations-production/0001_production_baseline.sql`
- SQL SHA-256:
  `330b07245c18ad2f0291eb00ac96049c66e4b455df6b4cf2830bb2e07c03188e`
- 509 ordered statements: 154 `CREATE TABLE`, 112 `CREATE INDEX`,
  140 `CREATE TRIGGER`, 103 curated `INSERT OR IGNORE` defaults.
- Authenticated Cloudflare D1 REST `query` batches were used, each checked for
  successful per-statement execution. The Wrangler-compatible `d1_migrations`
  journal was created and `0001_production_baseline.sql` recorded **only
  after** all statements succeeded and object counts and defaults were verified.
- Production journal after apply: one entry,
  `0001_production_baseline.sql`, timestamp `2026-11-08 18:34:42` (UTC).
- Pre-apply D1 Time Travel bookmark:
  `00000006-00000000-0000511d-1d6840d84ab7d7ec17a2ea992296d525`.
  No restore was performed.

## Independent post-apply verification

| Check | Result |
| --- | --- |
| Production app tables | 154 |
| Explicit indexes | 112 |
| Triggers | 140 |
| Static curated default rows | 103 |
| `PRAGMA foreign_key_check` | 0 violations |
| Production users | 0 |
| Production wallet ledger | 0 |
| Legacy Family policy rows | 0 |
| Production cosmetics rows | 0 |
| Lucky Box prize pool rows | 0 |
| Lucky Box enabled | 0 (disabled) |
| Agency split | Host 40%, Agency 10%, BD 5% |
| Salary minimum target | 5,000,000 coins |
| Host display target rows | 1M, 2.5M, 5M, 10M |
| Staging migration journal | 71 entries, unchanged |
| Worker deployment | none |
| Production Worker and R2 public routes | disabled/absent |

The local Python SQLite integrity check passed (`ok`) with foreign keys enabled
and zero violations. Cloudflare D1 refused remote `PRAGMA integrity_check`
with `SQLITE_AUTH`, so **no remote integrity-check success is claimed**;
remote object counts, foreign keys and data checks succeeded instead.

## Production release remains blocked

- The public production API is not yet deployed. The versioned placeholder
  returns 503; an offline test confirmed the same fail-closed behavior.
- No production Firebase/SFU/TURN secrets, real-time voice behavior, payment
  receipts, Android production API routing or signed production AAB have been
  validated as part of this migration.
- New R2 is empty; cosmetics and dependent Lucky Box prizes were intentionally
  withheld. Family historical schema was retained for compatibility but no
  Family data or policy defaults were imported.
- Before public activation: test two-device audio, permissions, billing,
  currency/recharge policy, role/Wallet invariants, media uploads and account
  deletion, then run the Play closed-test requirements.

**Do not rerun this baseline on a populated database, alter the staging journal,
or expose the production Worker without a separate pre-release review.**
