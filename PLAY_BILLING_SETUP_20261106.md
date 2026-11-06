# Sharika Google Play Billing — staged integration

**Status: implemented for internal testing; payments remain DISABLED. NOT ready for public Play release.**

The Android app uses Play Billing Library **9.1.0**, native one-time-product checkout, Google-sourced localized prices, and purchase restoration. The Cloudflare Worker uses the authenticated Firebase account, Google Play Developer API `purchases.productsv2.getproductpurchasev2`, SHA-256 purchase token IDs, and atomic D1 wallet/ledger crediting. Nothing here changes pre-existing accounts, coins, gift or game history.

## Products to create in Google Play Console

Create **one-time products**, consumable, with exactly these IDs:

| Play Console product ID | Coins credited | Initial intended reference price |
|---|---:|---:|
| `sharika_coins_500k` | 500,000 | USD 1 equivalent |
| `sharika_coins_2500k` | 2,500,000 | USD 5 equivalent |
| `sharika_coins_5000k` | 5,000,000 | USD 10 equivalent |

Set regional prices in Play Console. The UI will show Google's actual localized prices, taxes and currency; **not** hardcoded `$1` labels. Adjusting the app's generic recharge-to-USD settings does **not** silently change these SKU coin amounts or Google Play prices. New packs require an explicit backend + Android update.

## Private setup (never put credentials in GitHub or chat)

1. Set up the merchant profile and the app `com.soverixnet.sharika` in Play Console. Register the product IDs above and activate their purchase options.
2. Enable **Google Play Android Developer API**, link the Google Cloud service account to Play Console, and grant only the necessary application-level financial-order verification permissions.
3. Store the **complete** service-account JSON as the Cloudflare Worker secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Do not embed it in the Android app, JavaScript, a public JSON file or the Wrangler `vars` section.
4. Leave `SHARIKA_PLAY_BILLING_ENABLED=false` until **production API URL, correct Play upload signing, refund/chargeback reconciliation, policies, and real Play internal-track testing** are complete. The flag is deliberately false in `cloudflare/wrangler.jsonc`.
5. Apply the additive `0068_google_play_billing.sql` migration to the intended isolated database with an approved migration/backup workflow. Do not migrate production without reviewing the target D1 binding.
6. Upload a **proper production-signed** AAB to an internal test track. Add license testers and install from Google Play, then test a purchase, pending payment, cancellation, same-token retry, cross-account switch, refund, Play Store offline/reconnect and wallet reconciliation. Do not use a sideloaded staging APK to declare Play Billing production-ready.

## Security & launch blockers

- An unverified, pending or wrong-account purchase gives **zero coins**; only Google's verified `PURCHASED` state and matching obfuscated Firebase UID may credit the wallet.
- Each purchase token hashes to one globally unique D1 row and one immutable wallet ledger receipt. Retrying returns the same existing credit; a different user cannot claim it.
- The Android Play Billing UI will **not open checkout** until the authenticated Worker catalog explicitly confirms Play Billing is enabled. The Worker catalog is empty while disabled.
- After the server confirms credit, the Android client consumes the in-app product. If consumption fails, **Restore pending Play purchases** retries it; it never repeats the coin grant.
- **Refunds and chargebacks:** Real-time Developer Notifications (RTDN), voided-purchases reconciliation, negative-balance/fraud workflow and account support are **not yet implemented**. These are mandatory operational decisions before enabling live paid packs.
- The existing seller/manual recharge surfaces still exist. A production Play release must review them against Google Play Payments policy; Play Billing addition by itself does not authorize steering purchases to external payments.
- Lucky Gift, paid virtual wagers, invite cash commission, adult eligibility and payout policies must be assessed separately. Play Billing alone does **not** make any cash-value betting system compliant.
- The prior '40% first recharge bonus' and external-referral commissions are **not automatically added** to Google Play receipts. Packs credit exactly the indicated SKU coins. Confirm a Play-specific promotion/commission model before launch; do not advertise a bonus that the Play purchase does not grant.
- Account deletion web endpoint, privacy/data safety disclosures and two-device voice/game/login testing remain prerequisites for a public release.

## Official references

- Android Billing: https://developer.android.com/google/play/billing/integrate
- Publisher API: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2
- Lifecycle and refunds: https://developer.android.com/google/play/billing/lifecycle/one-time
- Policy: https://support.google.com/googleplay/android-developer/answer/9858738
