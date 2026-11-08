# Sharika launch level reset — preparation only

Status: **NOT IMPLEMENTED / NOT ARMED**. No command, route, cron, or button in
this repository may reset all accounts today. Staging coins and live balances
must remain independent. The Super Admin must approve the exact release scope
when a verified Play Store production deployment is ready.

## Reason a direct `UPDATE sharika_users SET wealth_level=0` is unsafe

Royal Sent/Received levels are rendered from settled gift totals and a
`level_progress_v2` policy baseline, while the legacy `wealth_level` and
`charm_level` retain other premium entitlements. Rewriting those two columns
would neither produce durable level zero nor preserve every entitlement.

## Safe future design

1. Take a verified and restorable D1 backup; snapshot account count, gift
   histories, wallet balances, seller balances and active subscriptions.
2. Introduce a **separate launch-era level policy** with a generation ID and
   per-user `sent_baseline_coins`/`received_baseline_coins` equal to each user's
   current verified gift totals. UI displays new-era levels from the difference
   without altering historical gift transactions.
3. Make launch level **0** an explicit value in the new-era policy; keep the
   existing 1–100 algorithm and its premium dependencies intact until separately
   migrated and tested. Do not silently change any user's wallet, VIP, IDs,
   BD/Agency/Host role, CP, frame purchase or salary.
4. Require Super Admin, a typed environment-scoped confirmation, a preview of
   affected user count, dual approval, an idempotency token, and an immutable
   audit record. Forbid executing on production until after a successful dry-run
   in the isolated staging D1 and restoration rehearsal.
5. Verify fresh gifts progress from zero and that a rollback restores levels
   with no coin duplication or lost ranking history.

The current reward-prize configuration is **display-only**: publishing its
coin figures does not credit wallets or grant frames/medals. A separate
audited payout/settlement specification and tests are required before actual
coin rewards can be issued safely.
