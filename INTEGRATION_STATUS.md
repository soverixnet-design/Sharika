# Sharika integration status — 29 October 2026

This branch is **an integration candidate, not a production release**. The original HTML/CSS, logos, layouts and admin menus are retained; only connection scripts were added. Demo game-win timers were disabled.

## Already deployed to existing Supabase project
- 25 isolated `sharika_*` tables with RLS; original Sovera/Earnbd objects unchanged.
- 30 original gift prices and categories.
- Server-only RPCs for signup welcome coins, gifts and Lucky payouts, weekly room rewards, daily check-in, diamond exchange, pending recharge and one-time admin approval.
- Supabase Edge Function `sharika-api` version 5 with verified user token checks and role-limited admin routes.

## Present in this branch
- `app/index.html`: original UI plus `app/connection.js`.
- `admin/index.html`: original admin UI plus `admin/connection.js`.
- Browser bridge for Supabase email/password auth, live wallet and room lists, gift requests, member seats, moderation protection and LiveKit SDK integration.
- Admin bridge verifies Sharika admin role before showing real user, room, recharge, audit, gifts and wallet data.

## Important remaining work
- Configure Supabase Edge secrets `SHARIKA_LIVEKIT_API_KEY`, `SHARIKA_LIVEKIT_API_SECRET`, `SHARIKA_LIVEKIT_URL` securely, using the existing LiveKit server with a public TLS/WSS host. Never put secrets into the repository or ChatGPT.
- Assign the intended admin user's Supabase Auth UID to `public.sharika_admin_users` through a trusted, reviewed admin process. **There are zero Sharika admins configured.**
- Enable/verify Supabase email/password provider and redirect/confirmation settings. Google and SMS sign-in require separate provider configuration.
- Implement server-authoritative Food Wheel and Jackpot Fruit rounds, payout configurations, and game client UI. Original supplied HTML had only placeholder game buttons.
- Implement messages, followers, ranking settlement, animation uploads/Storage, presence, moderation and other admin modules currently marked unavailable.
- Package/verify Android runtime with microphone permission and background audio, then test on physical devices.
- Run authenticated end-to-end tests of all money and gift transactions before merging; no production user test was performed yet.

## Security
The browser uses only a publishable Supabase key. Never put a Supabase service-role key, LiveKit secret or server SSH key into frontend code. Money SQL functions are callable by `service_role` only. Existing Sovera services are not modified.

Do not merge or publish this branch as complete until the checklist above passes.

## Automation added (29 October 2026)
- `.github/workflows/sharika-verify.yml` runs dependency-free bridge/source security checks on pull requests; [first run passed](https://github.com/soverixnet-design/Sharika/actions/runs/40899368028).
- `.github/workflows/sharika-server-sync.yml` contains an opt-in non-root, strict-host-key SSH file sync. It stays disabled until the owner configures the dedicated deploy SSH account and GitHub secrets/variables once; see `DEPLOYMENT_SETUP.md`.
- The sync only transfers `app/`, `admin/` and `backend/` and changes a Sharika-only symlink. It does not restart existing services, publish a site, deploy the Edge Function, migrate databases, or build an APK.
- The provided production server has **not been modified** by these workflows; no claim of live app/voice/game success is made.
