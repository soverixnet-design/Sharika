# User-provided Sharika game originals

Visual references for replacing the previous staging Food Wheel and Jackpot Fruit game screens. These HTML files are **reference-only** and are deliberately not loaded into the APK: their scripts use localStorage balances, Math.random outcomes, and simulated winner lists. The game adapter must keep the original graphics/animations while routing every coin debit, round result, and payout through authenticated server endpoints. No existing player wallets, historical bets, room UI, or voice modules may be reset.

Original assets:
- `sovera-food-wheel.html` — 8-slot Food Wheel with multipliers and grouped betting, integrated voice-room preview.
- `night-food-wheel.html` — alternate 8-slot Food Wheel visual.
- `jackpot-fruit.html` — eight-spot Jackpot Fruit game with bonus indicators and an illustrative jackpot pool.
- The two original cover PNGs are under `android-staging/app/src/main/assets/`.

**Pending:** choose which Food Wheel variant should replace the active game and confirm the original betting rules/bonus pool before wiring to the real virtual-coin wallet. Do not deploy the unmodified demo scripts to users.
