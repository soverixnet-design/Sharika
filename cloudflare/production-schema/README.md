# Sharika production schema candidate (not deployed)

## Provenance

`0001_staging_structural_candidate.sql` was generated from a read-only
`sqlite_master` inventory of `sharika-staging` on 2026-11-08. It contains 153
application table definitions, 109 explicit indexes and 140 triggers, with no
user data, wallets, recharge transactions or media. The code-required
`sharika_google_play_purchases` table and index from source migration 0066
are added to this *candidate* for review.

`0002_curated_defaults_candidate.sql` contains 103 **static** default rows
from the repository migrations, not staging user data. It deliberately omits
legacy Family policy defaults and 148 cosmetics catalog entries whose media
has not yet been prepared in the isolated production R2. It also excludes
21 Lucky Box prize-pool rows that reference the missing cosmetics catalog,
and defaults Lucky Box to disabled until those assets are installed. It proposes the
requested 1M/2.5M/5M/10M displayed host tiers but retains the existing 5M
salary minimum. Business-rule review is required before it is promoted.

The candidate retains historical Family schema to avoid silently dropping
or rewriting dependencies. It does not reactivate Family features or migrate
Family data. Product policy and endpoint removals need a separate review.

## Deployment gate

1. Review all trigger definitions, especially Salary/Seller, Wallet, Ranking,
   Recharge, Game and Play Billing; source and staging differ in several places.
2. Review the curated seed defaults, especially invite/recharge rates, game
   enablement, host targets and cosmetics; a schema-only database is **not**
   a functional Sharika backend.
3. Verify media references against the new, initially empty production R2.
4. Validate schema plus approved defaults in fresh local SQLite and through
   the same D1 runtime API, including authenticated end-to-end tests.
5. The reviewed, combined version is now
   `../migrations-production/0001_production_baseline.sql`. Do not mark old
   staging migrations as applied by hand.
6. Before any remote apply, assert exact database ID
   `44425c0a-c691-4e39-a11a-a6e29089d1a3` and zero Sharika tables,
   and take a recoverable export/snapshot as appropriate.

`wrangler.production.jsonc` intentionally points to a 503 placeholder,
has no scheduled triggers, has public Worker URLs disabled and binds only the
production D1/R2. The staging configuration is untouched.
