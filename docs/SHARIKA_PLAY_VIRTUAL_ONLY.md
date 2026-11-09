# Sharika — virtual-only Personal Account Play edition

## Release boundary

This is a **code and CI candidate**, not a deployed or approved Google Play release. The existing staging Worker and D1 contain salary, BD/Agency, seller and referral ledgers. **Never enable the Play flag on that Worker or reuse its D1.** Do not migrate existing real-money balances into the Play database.

The Play API is a separate Worker, fresh D1 database, R2 bucket and Durable Object namespace. A starter configuration is in `cloudflare/wrangler.play.virtual.jsonc`. Replace `REPLACE_WITH_NEW_PLAY_D1_UUID` with an ID returned by creating a NEW D1 database, provision the named NEW R2 bucket, apply migrations to that NEW database, and bind new voice and purchase-verification secrets. Check all bindings and fresh data before deployment. Do not copy staging data or credentials that authorize cash payouts.

Required Play Worker variables (enforced before the Worker handles any request):

| Variable | Mandatory value |
| --- | --- |
| `SHARIKA_PLAY_VIRTUAL_ONLY` | `true` |
| `SHARIKA_PLAY_ISOLATED_DATA` | `true` |
| `SHARIKA_COINS_CASH_REDEEMABLE` | `false` |
| `SHARIKA_LUCKY_GIFTS_ENABLED` | `false` |
| `SHARIKA_PLAY_BILLING_ENABLED` | `false` until Play products and server receipt verification are live |

If `SHARIKA_PLAY_VIRTUAL_ONLY` or isolated data is enabled without all three safeguards, API requests return HTTP 503. Blocked finance/game APIs return HTTP 403 even if a modified APK calls the Worker directly. Invites, cash earnings, salary exchange/transfer, seller management, admin wallet tools, betting games, Lucky Box and game prizes are unavailable. New accounts cannot generate referral cash commission; normal room gifts do **not** generate Host/Agency/BD earning statements. Random Lucky Gifts cannot be listed or sent. Virtual room-owner coin rewards remain available and have **no cash withdrawal** pathway in this D1.

Android release `SHARIKA_PLAY_BUILD=true` blocks the same API families at the native bridge, hides finance/reward menus, and presents virtual-only terms. It uses **Google Play Billing only** for paid in-app virtual coins. No payment flow may link to external sellers. Signup does not submit a referral invite code.

## Build and verification

1. Run `cd cloudflare && npm run check`, plus `node --test test/play-virtual-only.test.mjs` and the SQLite migration tests.
2. Provision the **new** Worker, DB and R2 bucket using the Play-specific config; verify no existing staging D1 ID is present. For production, set `SHARIKA_PLAY_API_ORIGIN=https://<new-play-worker-host>` and use the real upload key to create the AAB. Without the origin, CI makes a staging-backed **test-only candidate that must not be uploaded to Play**.
3. In the new environment, verify HTTP 403 for `/api/v1/invites`, `/api/v1/agency/salary/transfer`, `/api/v1/sellers/transfer`, game bets, and game catalogs; verify account creation, virtual wallet/rooms/gifts, no salary/referral ledger entries, disabled Lucky Gifts, Play Billing verified purchase and idempotency.
4. Run on a device with a new account, check no Seller, Salary, Invite Reward, withdrawal or bet UI is reachable, and the Terms show **no cash value**. Verify screenshots and Store listing likewise contain no payouts or money-making promises.
5. Review the Google Play Console **Financial features declaration** based on the actual final build. Distinguish virtual coins and reward points from regulated cash services, and do **not** declare “no financial features” unless the final Play policy definitions and app functionality support it. Google makes the final determination.

## Play Console declaration review (not submitted)

Last observed Personal account: Social app `com.soverixnet.sharika`; financial features declaration includes “Rewards, points, frequent flier miles, and other incentives”. This must be reviewed after the **separate Play backend is live**: the Play build still has virtual coins and virtual room-owner rewards, even though it offers no cash redemption, withdrawal, salary, seller settlement or wagering. Changes to the Play Console declaration are **not** automatically performed by a code commit. The previous rejection and closed-test enrollment require separate resolution.
