# Royal Champions Podium — Design QA

Date: 2026-11-08 (Asia/Muscat)
Reference: user-selected design option 1, the gold/plum "Royal Champions Podium" mobile ranking concept.
Target: isolated Sharika Android staging branch `feature/sharika-full-integrated-staging-20261107`.

## Implemented

- Sharika-branded ranking header, Gift / Recharge / Games / CP shortcuts, preserved access to all old ranking categories.
- Golden 3-place podium using real leaderboard names, avatars and equipped media; dedicated lightweight background art.
- Current verified UTC-week label, official CP Top 1–7 coin/frame/medal rules from the existing `/bonds/rewards` endpoint.
- Previous-week leaderboard view from read-only, completed-week `week_offset=1` query, with a strict date guard against an older Worker silently ignoring that parameter.
- Historical position is explicitly **not** a claim that a prize was awarded. Existing CP award receipts remain authoritative.
- No modifications to coin balances, award rules, gift values or payout paths.

## Verification

- Backend and Android bridge static checks: passed.
- Existing Cloudflare test suite: 593 tests passed, 0 failed.
- Staging GitHub Actions APK and Play candidate build for first implementation commit: succeeded.
- Browser visual review: **blocked**. The isolated UI browser cannot connect to the local preview server (`ERR_CONNECTION_REFUSED`), so no rendered screenshot comparison was completed.
- Historical staging data: **not yet verified end-to-end**. The staging Worker carrying `week_offset=1` is not confirmed deployed; the UI fails closed instead of showing the current week as history.
- Real-device portrait/landscape, dark theme, keyboard and screen-reader checks: pending.

## Release acceptance

1. Deploy the tested read-only historical rankings endpoint to the **isolated staging** Worker after checking current staging migration/configuration. Never run broad D1 migration or change live wallet data for this design.
2. Verify previous-week `start_at` and `end_at` against the current week on staging, and confirm actual leaderboard entries.
3. Open the exact generated staging APK on a phone, compare against option 1 reference and check no clipped 3D podium, reward card overlap or lost old ranking tabs.
4. Verify an enabled/disabled CP reward policy, Top 1–7 display and the historical award receipt status using test accounts.

**final result: blocked** — code and automated build passed; final visual and historical-API checks remain pending.
