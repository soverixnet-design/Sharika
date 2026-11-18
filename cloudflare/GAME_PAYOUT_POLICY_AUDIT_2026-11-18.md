# Sharika games — payout, settlement, offline and policy audit
Date: 2026-11-18. Scope: **staging** repository and D1; not a production certification.

## Verified evidence
- Connected GitHub source branch: `feature/sharika-royal-ace-server-room-20261118`.
- Cloudflare Worker: `sharika-api-staging`; D1: `sharika-staging`. No production query or changes were performed for this report.
- D1 ledger comparison: Greedy Wheel 2,090 debits; Food Deluxe 80; Greedy Classic 31; Gaddy 26; Cleopatra 138 paid; SuperAce 149 paid. Matching win-ledger totals for these games were inspected.
- No overdue `accepted` bets were found in the inspected tables. SuperAce and Cleopatra settlement snapshot columns had no null settlement.
- Nonredeemable virtual coins only. Verify separately that game coins **cannot** be converted to host/seller cash benefits or externally traded.
- Existing D1 sampled wager-to-win ratios must **not** be presented as true probability or RTP. SuperAce had historical rules and 231 free spins; its 149 paid spins alone paid 94.8% before including free credit.

## Theoretical return from CURRENT wheel weights and multipliers
Theoretical return for a player staking only one eligible icon, **not** the probability of winning and not a guaranteed result:

| Game | Server outcome model | Minimum expected virtual coin return | Maximum |
|---|---|---:|---:|
| Greedy Wheel | 10 outcomes; salad/pizza groups | 98.94% | 98.96% |
| Greedy Classic | 10 outcomes; salad/pizza groups | 97.26% | 97.59% |
| Food Wheel Deluxe | Eight inverse-multiplier weighted icons | 97.19% | 97.19% |
| Sovera Gaddy | Eight individual outcomes plus 2 grouped outcomes | 97.40% | 97.40% |

Exact calculation: `return = sum(P(outcome) * payout_multiplier_for_that_pick)`.
For grouped specials include their contribution, even though they have a separate multiplier in Sovera Gaddy. The authenticated admin settings in staging for Gaddy currently equal the source defaults. All these returns are below 100%; payout variance may still be very high in small samples.

## Slot engines
- **SuperAce Deluxe:** source now credits 7.5% of the original paytable gross, capped at 10× the stake per spin; paid spins and recursively awarded free spins are included in its separate Monte Carlo check. A previous 10,000× maximum shown by the original HTML was a misleading *visual* bug and was corrected in the staging source. This is NOT a guarantee of 7.5% overall RTP.
- **Cleopatra:** currently configured at payout scale 0.60; normal line payouts, bonus free spins, jackpot pool and max win must be assessed together. The historical 138 paid sample returned 72.8% before counting 10 free spins; those observations alone do not establish long-run RTP.

## Bugs found and repairs
1. Greedy Classic used a **1 ms spinning window**. Staging changed this to 3,500 ms, leaving 4,500 ms for the result in the existing 38 s round. Existing D1 rounds retain their original timing; newly created rounds use the new timing.
2. SuperAce Rules UI claimed **10,000×** where the Worker caps paid-out wins at **10×**. It now states the correct 7.5%-of-original-gross/10× cap, including the example equation.
3. Client-based re-credit and browser local coin storage are unsafe. All audited new slot credits must come from D1; same-ID retries prevent double debit after a timeout.
4. Low-bandwidth wheel UIs: preserve last verified state, lower polling rates when reported effective connection is slow, avoid external font fetches. Physical device testing remains required; WebView Chromium tests do not prove in-room audio continuity.
5. Original game cards are embedded local images, not mislabelled jackpots.

## Publication and consumer-safety boundary
Official policies (verify before every production release):
- Real-Money Gambling, Games, and Contests: https://support.google.com/googleplay/android-developer/answer/9877032
- Payments and virtual currencies: https://support.google.com/googleplay/android-developer/answer/9858738
- Age-Restricted Content and Functionality: https://support.google.com/googleplay/android-developer/answer/16302250
- Families Policy: https://support.google.com/googleplay/android-developer/answer/9893335
- Randomized virtual item odds disclosure: https://support.google.com/googleplay/android-developer/answer/6223646

A no-cash-withdrawal claim alone is not a policy clearance. Purchased coins or transferrable game winnings MUST NOT yield a real-world prize unless an approved licensed gambling program applies; check age rating, geographic restrictions, marketing, and content-rating declarations. The isolated Play-virtual build must not expose the staging betting routes or a link to them. Neither ads for real-money gambling nor deceptive odds claims should be present. Any paid random virtual item must have applicable odds information visible before purchase.

## No-go gates before production release
- Correct Play/staging isolation and adult access controls.
- Single debit and single corresponding win credit, idempotent retries and immutable audit ledger.
- Stale `accepted` bets = 0; each settled bet matches exactly one ledger debit and one appropriate credit.
- Actual RTP/odds simulation across paid + bonus rounds after each change; player-visible rules match code; publish odds/selection method where required.
- Run the verified Android APK on a physical phone with a 2G/3G-style throttled connection, airplane-mode interruption mid-bet, repeated taps, room-voice on/off, reopen, and account history sync.
- Do not merge or deploy to production solely because unit tests passed.
