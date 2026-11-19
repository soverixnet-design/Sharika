# Sharika Royal LiveOps — Staging rollout and release gate
Updated: 2026-11-20

## Ownership and routing
- **Single existing Admin Panel:** `https://sharika-admin-staging.soverixnet.workers.dev/admin/` — Firebase Super Admin; Game / Ranking / Event / Module Publish/Hide and proposed odds drafts. No second admin login on the website.
- **Private member website:** `https://sharika-private-center-staging.soverixnet.workers.dev/` — authenticated games and `/center.html` (Royal Events, verified rankings, gifts, wallet).
- **API:** `sharika-api-staging` via current Worker + D1; own database and Cloudflare R2 existing media. Production/Play remain separate.
- **Android staging:** Fullscreen GameCenter Activity and 65%-height room game Dialog use the SAME one-time Firebase-authenticated 90-second launch ticket. Private site consumes the ticket once and sets a 30-minute HttpOnly cookie. Room audio stays in its original Activity.

## Current implementation
- Publication is server-enforced. Hidden items do not appear in member manifest; game bets and game entry HTML require enabled + published, and Event banner/leaderboard endpoints independently require global Events ON, the individual event ON, an unexpired published event, and member session.
- Private game iframe explicitly permits same-origin embedding and sandboxed scripts from its own private origin. Legacy public-host-only CSP was corrected; pages not meant for framing remain DENY.
- Browser practice mode is disabled on the private origin. Real gameplay requires the Android native bridge and the existing server-verified wallet, result and idempotency logic.
- Event page: uploaded JPEG poster (only if provided by admin), Royal Golden 3D CSS, phase indicator, countdown, event-specific Top-3 prize labels, selected settled-gift leaderboard, no unrelated cards in event detail.
- Rankings: Rich, Charm, Room and verified CP, BD, Agency, Host; all period boundaries UTC. CP = settled CP gifts; BD/Agency/Host = actual accrued agency salary ledger amounts converted from 1/10000 units into virtual salary coins. No fabricated names or scores. Only explicitly published categories are visible.
- Win rate and RTP controls are proposals in D1 only. No code silently changes active rounds. Per-engine audited fairness/payout adapters, release notes and player disclosure are required for activation.

## Important live staging facts (verified before this rollout)
- `sharika_center_publishing`: 12 game engine records, 10 enabled/published at the engine level. However, one legacy `food-wheel` engine lacks a distinct private hosted HTML asset; the website manifest excludes this unhosted item to prevent a dead card. That leaves **9 hosted and published titles** until this engine is ported. Two games stay disabled.
- Three existing ranking categories (Rich, Charm, Room) were published. CP, BD, Agency, Host and other categories are off until deliberately enabled in the Admin Panel.
- Two old Event records remain Draft with expired date ranges, and the global Event module is OFF. No old or test Event is auto-published.
- Legacy public game website has **not** been retired; it must only be locked down after signed-in production cutover, to avoid breaking older clients.

## Release acceptance gate
1. Staging CI: syntax, private frontend+admin+API dry-run, full Cloudflare regression suite, private access tests, real D1 SQL schema probes and separate Android debug APK compilation.
2. Verify on a physical Android device: Google Login signed debug build, room audio while the half-height game panel is open, one-time ticket expiry and session refresh, 2 genuine accounts playing server-verified games, proper wallet debits and settles.
3. With a new non-expired **test** event kept private, admin checks image, countdown, reward labels, event-specific leaderboard and OFF propagation to app/site/image URL; only later publish an actual event.
4. Preserve old accepted game bets, wallets, image data, event prizes and permissions; never auto-convert odds drafts into live configs.
5. After approval and device QA, plan independent Production migration, old public host access retirement and Play Store compliance review. Do not push staging endpoints into an approved Play build.

## Source paths
- `cloudflare/src/private-center.mjs`: publication and super-admin controls, launch tickets.
- `cloudflare/src/center-rankings.mjs`: CP/BD/Agency/Host verified ranking SQL.
- `hosted-game-center/src/private-index.mjs`: protected static games, image and leaderboard routes, browser session.
- `hosted-game-center/web/center.html`, `center.css`, `center.js`: Royal Events and rankings UI.
- `admin/connection.js`: existing Super Admin controls.
- `android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java`
  and `SharikaRoomGameDialog.java`: secure Android entry.
- QA: `cloudflare/test/private-center.test.mjs`, `cloudflare/test/center-rankings.test.mjs`,
  `hosted-game-center/test/private-event-access.test.mjs`.

All listed controls are staging only. No completion or Play publication claim should be made based solely on a successful build.
