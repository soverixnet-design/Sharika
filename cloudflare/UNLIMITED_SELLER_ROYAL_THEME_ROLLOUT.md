# Sharika Winged Royal Gold + Unlimited Seller Stock (staging)

## What changes
- Only Super Admin may enable or disable non-depleting seller stock for an approved seller, with an 8–200 character reason.
- All sellers start in finite-stock mode. No existing balances, allocations, or historical transfers are modified.
- The arbitrary 1,000,000-coin request cap is removed. Transfers are bounded by the existing 1-trillion-coin recipient wallet capacity (including bonuses); finite allocations may fill the existing 1-billion-coin stock capacity. There is no lifetime total ceiling for a Super Admin-authorized unlimited seller; each transfer is individually authenticated, idempotent and ledgered.
- The public seller directory remains read-only. The private Seller Wallet shows an infinity badge only when authorized.
- The supplied winged crown artwork and separate 12-icon atlas style Home, rankings, messages, wallet, default room, shop and backpack; Main Profile is excluded.

## Required staging rollout order
1. Review this branch and pass the Cloudflare Node tests, in-memory SQLite migration tests and Android staging build.
2. Apply `cloudflare/migrations/0037_unlimited_seller_stock.sql` and then `0038_seller_large_transfers.sql` to **sharika-staging** D1 before publishing the Worker. Take a backup first.
3. Publish the staging Worker and admin UI together. Do not enable unlimited stock for anybody automatically.
4. Build and install the new staging APK; verify one finite seller and one opted-in seller on two devices.
5. Test permission rejection, enable/revoke, one credit, duplicate replay, transfer history, seller self-recharge, and 10,000,000-coin transfer and wallet-capacity rejection. Reconcile the recipient wallet ledger and stock.
6. Do not promote to production or Play Store until reconciled and approved.

## Safeguards
- No automated or live coin grant is made by this change.
- Non-depleting seller mode is a persistent admin permission, **not** an infinite integer balance.
- Underlying wallet and finite-stock capacities remain in force.
- Every mode change has an immutable audit row, and every transfer retains its existing unique request ID and wallet ledger record.
- If the migration is missing, the new Worker must not be deployed: queries to `unlimited_stock` will fail.

## Visual QA checklist
- Main Profile background and components remain unchanged.
- Open Home, rankings, messages, recharge/Seller Wallet, Shop, Backpack and default room; compare color, contrast and buttons with the winged background.
- A room owner's custom theme must still win over the Royal default room image.
- On a narrow Android screen, icons must remain legible, scrolling responsive and 3D motion disabled with reduced-motion settings.
