# Sharika Workforce BD / Agency / Host — staging gate

This change **must not be described as user-ready** until all live checks pass.
Existing Family/Crystal tables are retained for audit, but new Family gift
commissions are retired and Family is removed from the Android/admin menus.

## Economic contract

- All members: **30% Diamond Exchange** in Main Wallet, after policy migration.
- Verified ordinary gifts **received by an active Host** (including self-gifts):
  Host **40%**, assigned Agency **10%**, parent BD **5%**, independently computed
  from the **same gift value**. Each amount enters an immutable salary ledger.
- Lucky Gifts excluded. No extra payout at the target milestone.
- First Host target **5,000,000** gift coins. Admin edits future tiers/rates;
  clients load latest policy from the authenticated Worker, and earning entries
  retain the rate and version at settlement time.
- Salary conversion to Main Wallet coins requires an adult active member, an
  enabled Super-Admin setting and earnings from a completed daily / weekly /
  monthly period; no automatic USD/USDT withdrawal is introduced.
- 1 USD = 500,000 coins is a display/reference conversion only.

## Required deployment sequence

1. Review D1 backup and current legacy Family balances; do not delete any data.
2. Run `npm run check` in `cloudflare/` and the Android center tests.
3. Manually dispatch `sharika-workforce-staging.yml` as `publish-staging` on
   `feature/sharika-bd-agency-host-centers-20261106`. It applies only migration
   **0057** and deploys the corresponding **staging** Worker together; it does
   not touch production or Google Play. It requires a protected staging token.
4. On staging, authenticate as a Super Admin and grant an adult test BD, BD
   assigns an Agency, Agency assigns a Host. Verify assistant access is read-only.
5. Gift a test Host **100** coins from a member and from the Host's own ID;
   verify three separate ledger credits **40/10/5** salary coins each time,
   unchanged normal diamond and room-reward ledger entries, and no duplicate
   on idempotent retry. Gift a normal user and confirm no salary commissions.
6. Edit percentages and targets in Admin Center. Verify **new** Host gifts use
   the new policy version and older salary ledger rows retain original rates.
   Reopen Android Centers on a second account and verify updated data.
7. Check Diamond Exchange quote **100 diamonds = 30 coins** on the new app.
   Older clients without the new revision must fail closed and upgrade.
8. Verify salary exchange is disabled by default and rejects current-period
   credits, minors, blocked members and duplicate requests. Then authorize an
   adult test account for a matured period and verify the D1 salary debit,
   Main Wallet credit, immutable ledger, and unchanged Family history.
9. Build the staging APK using the existing manual Android workflow; install
   on real Android devices, verify navigation, WebView loading, Admin controls,
   target animation, airplane/offline behavior and stale revision handling.
10. Complete Play Store payments/privacy/legal checks separately before any
    public release. No real-dollar/USDT withdrawal is enabled by this patch.

## Not yet verified by local tests

- Remote staging D1 migration status and actual role/ledger data.
- Android APK/AAB compilation, physical phone QA and UI screenshots.
- Google Sheets automatic sync and seller bonus tiers; those are separate
  workflows and are **not claimed complete** here.
