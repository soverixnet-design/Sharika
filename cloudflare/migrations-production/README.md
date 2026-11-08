# Production migrations — intentionally empty

This directory is exclusively for **approved** migrations targeting `sharika-production`
through `wrangler.production.jsonc`. The 81 legacy staging SQL files are not copied here.

The structural candidate is in `../production-schema/`, outside the configured
`migrations_dir` so `wrangler d1 migrations apply` cannot accidentally run it.

Do not apply a production schema until preflight checks, code and data contract checks,
seed defaults review, and a backup/rollback plan have been approved. Never point this
config at the staging database. Never insert fake applied migration journal entries.
