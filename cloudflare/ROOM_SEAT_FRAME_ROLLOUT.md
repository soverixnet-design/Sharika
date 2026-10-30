# Sharika room seat-frame persistence rollout — staging

Date: 31 Oct 2026 (Asia/Muscat).

## Purpose
The original room sheet let owners choose `Colorful`, `Gold`, `Neon` or `Chowka` seat rings, but stored that choice only in iframe-local state. The server now has an owner-only, allowlisted `seat_frame_style` field. Members polling `/rooms/:id/members` will render the same selected style when the updated Worker is deployed.

## Staging D1 change applied and verified
- Account: `d81cf7c48fb9b36d468cb0a08720cd74`
- Database: `sharika-staging` (`b2c62252-12a5-4740-90c7-01a536d9a39a`)
- Applied only one additive `ALTER TABLE sharika_rooms ADD COLUMN seat_frame_style` equivalent to `migrations/0021_room_seat_frame_style.sql`; no other migrations executed.
- Pre-change Time Travel bookmark: `00000064-00000000-00005114-014b00499ea1d75c218696da1855a3c0`.
- Pre/post counts verified unchanged: 1 room, 2 users, 34 wallet-ledger entries.
- Existing room received `grad` default. Column is present and uses a SQL CHECK allowlist.
- **Do not run all historical D1 migrations to catch up:** this staging database was previously migrated manually and has migration-journal drift. Inspect `d1_migrations` and reconcile against already-applied schema before using `wrangler d1 migrations apply`.

## Worker staging rollout pending
- [x] Additive D1 column safely applied.
- [x] Server owner PATCH, members GET and Android renderer implemented on the draft feature branch.
- [x] Cloudflare automated tests passed with new migration and value validation.
- [ ] Deploy the updated source to `sharika-api-staging` only while preserving D1/Durable Object bindings, Firebase secrets, and existing service routes.
- [ ] Verify authenticated `PATCH /api/v1/rooms/:id` with `seat_frame_style:'gold'`, confirm D1 and `GET /api/v1/rooms/:id/members` reflect it, then restore original `grad` for staging room if desired.
- [ ] Test owner and guest on separate Android phones, including rejoin/restart and 5–21 seat settings; leave production unchanged until owner acceptance.

Rollback guidance: restore the previous Worker version for code regressions. The new additive column is harmless to the old Worker and need not be dropped. Do not restore a historical D1 bookmark after new user activity without reviewing intervening writes.
