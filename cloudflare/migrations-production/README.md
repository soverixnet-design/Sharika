# Production migrations — isolated baseline

This directory is exclusively for **approved** migrations targeting `sharika-production`
through `wrangler.production.jsonc`. The 81 legacy staging SQL files are not copied here.
`0001_production_baseline.sql` is the new, reviewed pre-traffic bootstrap from
the structural and curated seed candidates. It must never target staging.
It was applied to the empty production D1 on 2026-11-08 and recorded as the
single entry in that database's `d1_migrations` journal. See
`../production-schema/PRODUCTION_APPLY_REPORT.md` for the checksum, Time Travel
bookmark, post-apply checks and remaining release blockers.

The underlying candidate and audited source snapshots remain in
`../production-schema/` for review. Only the approved combined baseline is
discoverable by `wrangler d1 migrations apply` with this config.

Preflight must confirm the production database UUID, no existing Sharika data,
the Worker is not deployed, and a Time Travel bookmark is available. Never point
this config at the staging database. Never insert fake applied migration journal
entries for old staging migration filenames.
