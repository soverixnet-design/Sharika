# Sharika — Cloudflare Workers + D1 (isolated staging)

## Verified deployment checkpoint — 30 October 2026

**Staging only.** The tested source branch is `feature/sharika-original-games-cards-20261030`, commit `b881bd946d0199902a311b832e017ebabc98823f`. GitHub checks and Android staging debug build passed. This source includes real game-bet retry protection and read-only Top Recharge rankings from approved wallet ledger transactions, **but these newer changes have not been deployed to the staging Worker**.

Direct read-only HTTP checks on 30 October:
- `GET /health` → **200**, `{"ok":true,"service":"sharika-cloudflare-staging","environment":"staging","auth_configured":true}`.
- Anonymous `GET /api/v1/me` → **401**, `{"error":"not_authenticated"}`.
- A two-phone authenticated microphone test and complete game payout test **have not passed**. No public/production release is claimed.

### Migration-journal drift: do not rerun old migrations

The isolated remote D1 database `sharika-staging` currently has the newer `sharika_*` tables (including original-game bets, manual recharge reviews and daily check-ins), **but `d1_migrations` records only `0001_initial.sql`**. This means its migration journal does not match the observed schema. Re-running `create-tables` / remote `d1 migrations apply` could reapply already-existing schema changes and damage staging records. First reconcile the exact D1 schema and migration history via a reviewed backup and migration-only procedure; **do not mark migrations applied or rebuild tables speculatively**.

As of this check the staging DB contains 2 users, 1 room and existing gift/wallet records. No remote D1 writes or reset were performed during this review. The new rankings require no new migration.

### Safe source promotion remains manual

The default-branch workflow `.github/workflows/sharika-d1-staging-initialize.yml` still checks out an **older pinned commit** (`98de712a20a2b7c37c1ff3fff5b94483afbd54a5`). **Do not use its `deploy-staging-worker` action as-is to publish the latest candidate**, or its `create-tables` action against the existing DB. A repository maintainer with GitHub Actions workflow-edit permission must first review/update the manual workflow's pinned commit to the tested candidate, remove or disable the unsafe migration path, keep the exact staging-only Worker/account/DB guardrails, then run its manual deploy action. Check the resulting health/auth endpoints before allowing test users.

Neither routine Git pushes nor this document deploy anything. Existing Sovera/Akira services, Cloudflare production routes and user data are out of scope.

---


This project builds a **separate staging backend** for Sharika. It is not the
currently running Sharika client. The original app and admin adapters still
use their existing Supabase endpoints, and nothing here changes or imports
Sovera/Earnbd data or modifies DigitalOcean and LiveKit servers.

## Verified staging resources (2026-10-29)

- Cloudflare Worker: `https://sharika-api-staging.soverixnet.workers.dev`
- Cloudflare account: `d81cf7c48fb9b36d468cb0a08720cd74`
- Isolated D1 database: `sharika-staging`, ID
  `b2c62252-12a5-4740-90c7-01a536d9a39a`
- The remote D1 migration `0001_initial.sql` **was applied** via the manual
  GitHub Actions workflow. The schema exists, but old user data has **not**
  been imported.
- The Worker was **deployed**, and `GET /health` returned HTTP 200 with D1
  healthy. Before configuring Firebase it reported `auth_configured: false`.
- The user created a new Firebase project: `sharika-voice-chat-app`.
  Its **public project ID** is now configured in `wrangler.jsonc`. This code
  change needs another explicit manual staging Worker deployment to take effect.
- No web/Android Firebase app registration, enabled sign-in providers, end-user
  sign-in, authenticated Worker request or old-user identity linking has yet
  been verified. Project ID configuration alone does not complete login.

## Deployment safety

- Cloudflare Worker and D1 are separate from the live app. No production
  domain route, existing frontend adapter, shared database, or billing plan
  is changed by the staging workflow.
- Every deploy requires a manual GitHub Actions selection:
  `deploy-staging-worker`; ordinary pushes run tests only.
- The default-branch manual workflow checks the exact Cloudflare account,
  database, staging-only Worker name and Firebase project ID, and checks out
  a **pinned candidate commit** before deploying. Change that pin deliberately
  when promoting a new candidate.
- The `CLOUDFLARE_API_TOKEN` is a GitHub Actions secret. Never paste secrets,
  service-account private keys, passwords, or recovery codes in this repo or
  in chat.
- All browser origins remain blocked (`ALLOWED_ORIGINS` is empty) until a
  dedicated staging frontend URL is reviewed.

## Current API foundation

- D1 profile and wallet ledger schema, room owners, room members, gift and
  admin staging tables; 8-digit public IDs.
- Cryptographic verification of Firebase ID tokens from the configured
  project against Google's JWKs.
- Endpoints: `GET /health`, `GET/POST/PATCH /api/v1/me`,
  `GET /api/v1/users/:publicId`, `GET /api/v1/wallet`,
  `GET/POST /api/v1/rooms`, room join/leave/seat/members and voice-token.
- New-user signup requires a verified Firebase ID token and an eligible
  profile; it creates a staging profile with a welcome ledger entry.
- Voice-token issuance additionally requires **Sharika-scoped** LiveKit
  secrets and URL. These are not configured by adding Firebase.
- Gifts, daily claims, exchange, games, recharge and admin mutations return
  HTTP 501 `migration_pending`. These features are not yet migrated.

## Development and checks

```sh
cd cloudflare
npm run check
```

The separate default-branch manual workflow
`.github/workflows/sharika-d1-staging-initialize.yml` supports
`verify-only`, `create-tables`, and `deploy-staging-worker`.
Do not repeat `create-tables` unless a schema migration needs applying.

## Remaining steps before switching any user

1. In the new Firebase console enable the intended providers under
   **Authentication → Sign-in method**. Register an appropriate Firebase
   Web or Android app for an isolated staging client; preserve its public
   SDK configuration. Do not share any private admin key.
2. Deploy the newly reviewed staging Worker candidate, verify `/health`,
   expect anonymous `/api/v1/me` to return HTTP 401, and test a *real*
   verified Firebase login on a separate staging frontend.
3. Register the exact staging frontend origin in `ALLOWED_ORIGINS` only
   after the staging client URL is known. Keep all live origins unchanged.
4. Make an approved backup and inventory of Sharika-only Supabase data.
   Map old Supabase user UUIDs to new Firebase UIDs securely; passwords
   cannot simply be copied. Do not silently duplicate accounts or re-credit
   the 2,000-coin welcome reward.
5. Reconcile historical balances and ledgers, and implement server-authoritative,
   transactional, idempotent financial/game/admin changes with tests.
6. Connect voice to an explicitly Sharika-scoped LiveKit service, test
   multiple devices, and evaluate Workers/D1 free-tier quotas.

No live cutover, data migration or paid upgrade is authorized by this stage.

References:
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
