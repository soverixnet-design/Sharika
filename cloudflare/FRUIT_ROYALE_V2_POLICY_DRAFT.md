# Fruit Royale V2 — Proposed Economy & Replacement Plan (NOT LIVE)

Status: draft for owner approval. No wagers with real Sharika coins may be enabled from this proposal alone.

## Scope
- Replace only the original Jackpot Fruit card with uploaded Fruit Royale UI.
- Do not remove Greedy Wheel, Sovera Food Wheel, or Night Food Wheel.
- Do not truncate/delete historic bets, coin ledger entries, jackpot pool balances, or user profiles.
- Use a new game ID and isolated D1 tables. Existing original-game CHECK constraints deliberately exclude new IDs.
- Disable old Jackpot Fruit NEW bets only after authenticated new backend and Android integration pass tests.
- Keep historic jackpot-fruit settlement/recovery routes until accepted bets settle.

## Proposed versioned public payout policy (V2 DRAFT)
One primary fruit is drawn per round. Outcomes are chosen by server-owned auditable weighted draws. Multiplier includes the stake; there is no separate refund.

| Fruit | Multiplier | Weight / 78 | Probability |
|---|---:|---:|---:|
| Lemon | 4x | 15 | 19.23% |
| Strawberry | 4x | 15 | 19.23% |
| Kiwi | 4x | 15 | 19.23% |
| Cherry | 20x | 3 | 3.85% |
| Plum | 15x | 4 | 5.13% |
| Watermelon | 10x | 6 | 7.69% |
| Mango | 6x | 10 | 12.82% |
| Apple | 6x | 10 | 12.82% |

Exclusive round bonuses:
- None: 92%
- Fruit +1: 3% (one extra independent fruit draw; same stake can win twice)
- Fruit +2: 1% (two extra independent fruit draws)
- x2: 2% (double base fruit winnings)
- x3: 1% (triple base fruit winnings)
- Jackpot: 1% (base fruit win plus pool-funded award)
- Fruit +3: OFF, pending separate approval.

Theoretical per-fruit base return is 60/78 = 76.923%. Bonus factor is 1.09; expected fruit payout about 83.846% of stake. Proposed jackpot pool contribution is 5% of accepted stakes. Assuming the full contributed pool ultimately gets distributed without leakage, overall long-run theoretical return is about 88.846%, before rounding and operational effects. This is a design proposal, not guaranteed payout or launch authorization.

## Proposed operational rules
- Real authenticated Sharika virtual-coin wallet, with no game cash redemption.
- Shared 40-second rounds; betting open first 28 seconds. Chips 1K,10K,100K,1M,10M and server-limited custom bet.
- Server-verified identity; atomic conditional debit/credit with immutable ledger; deduplicated request IDs; exactly-once settlement.
- Jackpot: when bonus is drawn and eligible real bets exist, reserve at most half of pool and distribute pro rata by stake across that round. Define remainder handling before live use.
- Daily, weekly and monthly ranking by totalWin, totalBet, net and distinct winning rounds; genuine profiles only.
- Admin disabling closes NEW bets without blocking existing settlement.
- Small room game view never invokes the voice SDK join/leave path.

## Safety / release gate
1. Owner approves every multiplier, probability, jackpot contribution and award allocation.
2. Add a separate versioned server engine, D1 tables, authenticated Android bridge and regression tests.
3. Test duplicates, concurrent devices, offline/retry, wallet correctness and settlement recovery.
4. Review Play policies for purchasable random-outcome virtual coins.
5. Only after staging tests, replace the old Jackpot Fruit game card and stop legacy NEW bets. Retain all legacy history.
6. Build APK and test voice/game on two real phones. Production release requires a separate decision.
