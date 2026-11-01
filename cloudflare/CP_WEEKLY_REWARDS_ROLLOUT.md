# Sharika CP Ranking Rewards — isolated staging rollout

The CP leaderboard now has **This Week**, **Last Week**, and **Reward** views.
Only verified CP gift events count. The reward screen uses real member photos
and verified public IDs; no seeded demo winners or fake balances are shown.

## Safety and order

1. **Back up staging D1** before any migration.
2. Apply the additive `0035_cp_weekly_rewards.sql` migration to **staging D1 only**.
   It creates rules and immutable weekly receipts; it does not credit any wallet.
3. Deploy the staging API Worker, then the staging admin Worker and Android test
   APK from the matching branch. Never deploy straight to the existing live app.
4. Verify an authenticated user can open CP Ranking and the Reward tab, and that
   Super Admin can open `CP Ranking, Rewards & Gifts` in the admin panel.
5. In Admin, select per-partner coins (0–1,000,000), an existing active Store
   frame and medal separately for ranks 1–7. Save then explicitly enable rewards.
   Defaults are **disabled** and all coin amounts are **zero**.
6. For manual settlement, review the completed Monday 00:00 UTC to Monday
   00:00 UTC period, then press the **Award last completed week once** button.
   This irreversible action credits both partners for the configured rank and
   grants permanent, selectable Store frame/medal entitlements.

## Automation

`auto_award` is off by default. Enabling it activates the **next full** UTC
Monday–Sunday week, avoiding retroactive automatic credits. The existing Worker
cron checks for a completed eligible week, and its unique batch receipt prevents
duplicate settlement. Manually completed weeks are not paid again.

## Financial and profile invariants

- The payout must pass the same active-account and safe-balance checks for both
  partners. Failure rolls back the whole D1 batch; no half-paid pair.
- The reward configuration is snapshotted into the completed week's winner
  records. Later Admin edits cannot change an already-paid result.
- Coin credits carry `cp_weekly_reward` reasons and immutable per-user ledger
  request IDs. Reward recipients have distinct, immutable member receipts.
- Frame and medal grants reuse server-owned Store inventory. Users can equip
  them normally; existing purchased cosmetics are not overwritten.
- A CP bond ended **after** the week's cutoff remains eligible for that closed
  period; a bond ended **before** the cutoff is not eligible.
- Rewards are virtual app items/coins only. No cash payout or withdrawal exists.

## Verification

Run `npm --prefix cloudflare run check`; `cp-rewards.test.mjs` validates default-off
configuration, Admin permissions, item kind restrictions, both partner credits,
idempotent settlement, Store grants, later unbinding, and empty leaderboards.
Android staging APK and a two-device visual/voice smoke test remain required
before publishing the feature to general users.
