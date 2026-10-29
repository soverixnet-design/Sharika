# Sharika — Cloudflare Workers + D1 (isolated preview)

This is an **unpublished, isolated, no-spend migration foundation**. It does not
replace or write the existing Supabase project, Sovera/Earnbd data, DigitalOcean
droplets, LiveKit services, or the original Sharika app/admin HTML and adapters.

## Account-linked staging status (2026-10-29)

- Cloudflare account `d81cf7c48fb9b36d468cb0a08720cd74` and D1 database
  `sharika-staging` (`b2c62252-12a5-4740-90c7-01a536d9a39a`) are now
  pinned in `wrangler.jsonc`. These identifiers are not secret credentials.
- The user created the empty remote D1 database. **The remote schema has NOT
  been applied; no staging Worker has been published.**
- A staging-only guarded rollout workflow is in
  `.github/workflows/sharika-cloudflare-staging.yml`. A normal push only
  validates locally; remote schema initialization and Worker deployment
  require a specifically chosen manual action plus a separately stored GitHub
  Actions secret `CLOUDFLARE_API_TOKEN` with narrowly scoped permissions.
- GitHub requires a manually dispatched workflow file to also exist on the
  repository's default branch; since this remains an unmerged draft, its
  "Run workflow" control is **not yet available**. Do not merge the full
  migration branch just to activate that control.
- Secrets belong in GitHub Actions Secrets, never in source code, screenshots
  or chat. Do not configure production routes or live app adapters yet.

## Delivered in this stage

- D1 schema for Sharika profiles (8-digit IDs), rooms, seats, wallet history and
  future gift/admin data. No demo/admin accounts and no fake payment results.
- Firebase ID-token verifier using Google's signed public keys. Email/password,
  Google, and Facebook sign-in can be provided by Firebase Auth once configured.
  **A Firebase project is NOT created or configured by this commit.**
- Authenticated API: `GET /health`, `GET/POST/PATCH /api/v1/me`,
  `GET /api/v1/users/:publicId`, `GET /api/v1/wallet`,
  `GET/POST /api/v1/rooms`, `POST /api/v1/rooms/:id/join`,
  `POST /api/v1/rooms/:id/leave`, `PUT /api/v1/rooms/:id/seat`,
  `GET /api/v1/rooms/:id/members`, `POST /api/v1/rooms/:id/voice-token`.
- Gift sending, daily claims, exchange, games, recharges and **all admin
  mutations** intentionally return HTTP 501 `migration_pending`. They have not
  been migrated or claimed as working.
- Cross-origin browser requests are denied unless their origin appears in
  `ALLOWED_ORIGINS`. D1 uses bound parameters for all input values.

## Reproduce/tests (requires Node.js 22+)

```sh
cd cloudflare
npm run check
```

## Local-only setup when you have a Cloudflare account

Cloudflare Workers and D1 have free quotas, but exceeding them can stop requests.
No billing account or paid feature is necessary for this proof of concept.

1. Install a current Wrangler CLI using Cloudflare's official instructions and
   sign in **to your own account** (`npx wrangler login`). No credentials in Git.
2. From `cloudflare/`, use `npx wrangler d1 create sharika-staging`.
3. Replace the all-zero `database_id` in `wrangler.jsonc` with the newly
   allocated D1 database ID. **Do not point at a live D1 database.**
4. Run `npx wrangler d1 migrations apply sharika-staging --local`.
5. Supply your own free Firebase Auth project ID and exact staging frontend
   origins via Wrangler vars. No `FIREBASE_PROJECT_ID` means fail-closed 503.
6. For voice token testing only, set `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET` as Worker secrets and `LIVEKIT_URL` as a variable
   for an existing **Sharika-scoped** LiveKit service. Never commit secrets.
7. Run `npx wrangler dev` and inspect `/health`. A remote D1 migration or
   remote deployment is **not** part of this stage.

## Required work before any live cutover

1. Obtain an explicit user-approved migration window and encrypted export
   / backup for Sharika data only (no Sovera/Earnbd tables).
2. Securely map Supabase user UUIDs to Firebase Auth UIDs. Existing Supabase
   passwords cannot be copied into Firebase as plaintext; use verified account
   linking / password reset instead of silently replacing identities.
3. Import all existing `sharika_*` profiles, ID assignments, transaction
   history, balances, memberships, gifts, configs and admin roles **once**.
   Reconcile ledger totals before enabling financial writes. Do not re-credit
   the 2,000-coin welcome gift for imported accounts.
4. Implement transactional, idempotent server-authoritative gifts, games,
   exchange, recharge approval and admin audit with concurrency tests.
5. Wire **new** app/admin adapters behind an explicit staging-only flag,
   test Google/email sign-in, voice, identity, seats, wallet and moderation
   across multiple real devices. Do not switch the live frontend until verified.
6. Assess traffic and Workers/D1 daily limits; free tier is not unlimited.

The original `app/connection.js` and `admin/connection.js` still talk to
Supabase intentionally. This keeps live users and old data untouched.

References:
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
