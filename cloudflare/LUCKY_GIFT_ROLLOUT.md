# Sharika Lucky Gift — isolated staging rollout (2026-10-30)

## Verified state

- Reviewed Lucky Gift source: `feature/sharika-lucky-gifts-20261030` (review PR #4).
- Original Sharika HTML/CSS/room artwork is unchanged.
- Cryptographic server-only odds preserve the original Lucky Gift table:
  `0x=70.2%, 1x=15%, 2x=8%, 5x=4%, 10x=2.5%, 50x=0.3%`.
- Adult gating currently derives from the Firebase-authenticated user's stored profile
  birthdate and minor flag; it is **not legal identity or age verification**.
- Money changes use one D1 batch: gift debit, immutable debit ledger,
  optional Lucky reward credit/ledger, a single outcome record, recipient
  gift events/XP. Idempotency uses existing `sender_uid,request_id` uniqueness.
- No result may be supplied by the Android client.

## Applied only to isolated staging D1

The additive SQL in `migrations/0013_lucky_gift_outcomes.sql` was applied
to the **existing staging D1 only** on 2026-10-30 using a single batch
(create table, index, replace event-validation trigger).

The initial and post-change read-only checks both showed:
`users=2; gift_transactions=5; gift_events=5; ledger_entries=20`.
The new Lucky outcome table has zero records. Event-validation guard exists.

**Important legacy migration journal drift:** remote `d1_migrations` still
contains only one row, although later migrations' tables exist. Do **not**
blindly run `wrangler d1 migrations apply --remote` on this database.
Reconcile journal vs actual schema with an explicit maintenance plan first.
No existing data was deleted and the journal was not modified.

## Worker and Android build

- CI with unit tests and disposable in-memory SQLite migrations:
  https://github.com/soverixnet-design/Sharika/actions/runs/41080589173
- New Android debug APK workflow:
  https://github.com/soverixnet-design/Sharika/actions/runs/41080757134
- Verified staging API source deployment:
  https://github.com/soverixnet-design/Sharika/actions/runs/41082603727
- The deployed staging Worker remains pinned to `bb4aeea0910a5109458f4ee9c7f5c4403516832e` with the live Lucky flag `false`.
- The newer cashout safety hold exists in draft PR #4 source and passed its own CI: https://github.com/soverixnet-design/Sharika/actions/runs/41084037034. It has **not yet been deployed** to the staging Worker; the deployed feature flag is still OFF.
- API health returned 200; unauthenticated gift endpoint returned 401.
- Worker name is `sharika-api-staging`, **not production**.
- `SHARIKA_LUCKY_GIFTS_ENABLED` is explicitly `false` in deployed bindings.

## CASHOUT CONFIRMED — mandatory compliance hold (2026-10-30)

The app owner confirmed that **Sharika coins can be converted to cash**. Therefore,
Lucky Gift's purchase-and-chance-based 0x–50x reward is not a harmless
virtual-currency animation: it can be a real-money gambling product.
**No legal license, Play gambling certification, payout/KYC provider approval,
or territorial authorization has been supplied or independently verified.**
A self-reported profile birthday is inadequate age/identity verification.

**Security decision:** Lucky Gift is held OFF at source-code level via
`CASHOUT_LUCKY_GIFTS_BLOCKED = true`. Even if someone accidentally sets
`SHARIKA_LUCKY_GIFTS_ENABLED=true`, the API hides tab=2 gifts and rejects
Lucky spend **before any D1 wallet/ledger mutation**, returning
`lucky_cashout_approval_required`. The odds and code remain as dormant,
reviewable reference logic. Existing regular gifts and room appearance remain unchanged.

Before releasing any cash-redeemable chance-based gifts, require:
1. Owner-specified operating countries and a **valid regulator-issued gambling
   license for this exact kind of game** in each territory.
2. Where publishing on Google Play, a **successful Google Play gambling-app
   certification for every distribution market and product category**; obtain
   adult-only rating and implement responsible-gambling disclosures. No Play Billing.
3. Real independent **identity/age (KYC) verification**, server-enforced
   licensed-country geofencing (including VPN/location spoofing controls),
   financial transaction and anti-fraud/AML reviews where applicable.
4. Deposit/loss limits, self-exclusion, cooling-off and support workflows,
   transparent official rules and odds, verified coin-to-cash conversion,
   withdrawal audit trail and reconciliation with the payment provider.
5. Independent security and fairness review followed by isolated testing,
   then a **new source-code release** that can remove the compliance hold.
   A flag toggle by itself must never make Lucky Gift cash rewards live.

Google Play policy: https://support.google.com/googleplay/android-developer/answer/9877032?hl=en
Google Play application: https://support.google.com/googleplay/android-developer/contact/gambling?hl=en

**Scope warning:** The same cashout economics require separate review of
Food Wheel, Night Food Wheel and Jackpot Fruit because those games involve
coins and random winnings. Their prior `virtual_coins_only` API labels are
not proof that money redemption is impossible. Do not market them as
legally cleared for cashout until they pass the same review.

## Before activating Lucky coin payouts

1. **Resolved: coins are cash-redeemable.** Obtain and independently verify the exact gambling license, territorial allowance and platform certification before proceeding.
2. Implement any needed true age and location restrictions. Self-declared DOB
   does not constitute strong age verification.
3. Confirm that the staged Lucky catalogue contains approved active tab=2
   gift items and that all wallet balances are test-only.
4. Test 18+ sending, insufficient coins, replay, 0x and 50x, sender and
   recipient animation, room history, and concurrent requests using isolated
   controlled test accounts.
5. Only after this review, explicitly enable the feature on **staging only**.
   Production rollout is a separate authorization and migration.

The present APK contains the Lucky Gift client code, but Lucky may remain
hidden until the staging feature flag is intentionally enabled.

## Recipient and room revenue share (source-only draft)

Owner's Lucky Gift rules (2026-10-30):
- Sender pays the full gift price **once** from the existing Sharika wallet.
  The 5% receiver and 1% room rewards create no extra sender debit.
- Every selected recipient earns **5% of that recipient's gift price in
  diamond units** (1 coin of gift face value = 1 diamond for percentage
  calculation). This is an earning-unit rule, not a promise of equal cash value.
- The hosting ROOM earns **1% of the whole transaction in coin units**.
  The amount belongs to the room's audited balance, **not** automatically
  to the room owner's personal cashout wallet.
- Sender's original stochastic 0x/1x/2x/5x/10x/50x payout remains separate.
  Receiver and room shares are independent of whether the sender wins.
- Entitlements are stored in hundredths: for example 5 spent coins accrue
  0.25 receiver diamonds and 0.05 room coins. This avoids rounding small
  gifts down to zero forever. Whole diamonds are credited to the recipient's
  wallet by an atomic SQL trigger with immutable ledger records. Room fractional
  entitlements stay in the room ledger, not withdrawable without further policy.
- New additive migration: `0014_lucky_reward_shares.sql`. Not applied to
  the existing staging D1; migration journal must be reconciled first.
- This is DORMANT implementation only. `CASHOUT_LUCKY_GIFTS_BLOCKED` remains
  `true` and `SHARIKA_LUCKY_GIFTS_ENABLED` remains `false`. No new
  real-money chance rewards have been activated.

## Owner correction — coins are entertainment-only virtual items

On 2026-10-30 the owner clarified that Sharika **does not offer cashout,
sellback, cash conversion, external prize redemption, or an in-app coin resale
system**. Users purchase coins from the operator solely to use them in the
same voice-chat app (gifts, rooms, games). This **supersedes** the earlier
statement that coins could be cashed out. Do not label the economy cash-
redeemable without new evidence.

The previous unconditional `CASHOUT_LUCKY_GIFTS_BLOCKED` source hold was
therefore replaced with a fail-closed virtual-economy requirement:
`SHARIKA_COINS_CASH_REDEEMABLE=false` must be **explicitly** configured and
`SHARIKA_LUCKY_GIFTS_ENABLED=true` must be enabled separately before Lucky
Gift catalogue/spend are available. Any missing value or change to
`SHARIKA_COINS_CASH_REDEEMABLE=true` blocks Lucky spending again.
The Lucky feature flag itself remains **false** in staging; no live deposits,
withdrawals or randomized gifts have been activated.

For Google Play distribution, disclose the exact 0x/1x/2x/5x/10x/50x odds
immediately adjacent to the send action. Added a small inline text disclosure
to the existing original gift modal; it does not redesign the modal.
Google Play's payments policy generally requires Play Billing for in-app
virtual currency sold in Play-distributed apps, subject to listed regional
program exceptions. The existing operator/seller top-up workflow must be
reviewed for compliance before Play Store publication:
https://support.google.com/googleplay/android-developer/answer/9858738?hl=en

Important: Whether a virtual random-reward mechanic needs additional local
restrictions still depends on the countries where it is offered. Do not
represent the PR as legal clearance. **0014 was manually applied as additive schema-only SQL to the isolated
`sharika-staging` D1 on 2026-10-30.** Before and after read-only counts
both showed `users=2, gift_transactions=5, gift_events=5,
wallet_ledger=20, lucky_outcomes=0`. New recipient/room reward and diamond
accrual tables all have zero rows. No test gift was spent; no user balance
changed. A D1 Time Travel bookmark was captured before the migration.
The legacy migration journal was not altered. Do not run automatic historical
migrations until journal drift is reconciled.

**Deployment boundary:** Latest virtual-only source and Android odds
disclosure are only in this draft PR. The staging Worker remains on an older,
disabled version; `SHARIKA_LUCKY_GIFTS_ENABLED=false` in the branch.
Before enabling, deploy and verify the reviewed Worker and Android staging
build, and use controlled test accounts for end-to-end gift checks.
