# Sharika Google Play consumable coin purchases — sandbox QA

Status: **blocked on licensed tester and Play Console setup** as of 2026-11-10.
This is a test procedure, **not** evidence of a completed purchase.

## Verified prerequisites

- Isolated Play backend: `sharika-api-play-virtual`, safe Worker version 25.
- Cloudflare Access → Google STS → IAM service-account impersonation completed
  successfully with a real, short-lived service assertion. Temporary test route
  removed after verification; secret values and access tokens were not logged.
- `SHARIKA_PLAY_BILLING_ENABLED=false`; all 25 Worker bindings preserved.
- Read-only isolated Play D1 inspection: `sharika_users`,
  `sharika_google_play_purchases`, and `sharika_wallet_ledger` exist.
  Google Play receipts = 0; `google_play_recharge` entries = 0.
- Focused Node tests 11/11 pass and SQLite once-only-credit tests pass.

## Blockers before an actual purchase can be started

1. In the **correct Play Console app** (`com.soverixnet.sharika`), verify
   these *one-time consumable* product IDs exist, are active, and available to
   the tester's country. The UI must display Google Play's returned prices,
   never hardcoded prices:

   | Product ID | Coins |
   | --- | ---: |
   | `sharika_coins_500k` | 500,000 |
   | `sharika_coins_2500k` | 2,500,000 |
   | `sharika_coins_5000k` | 5,000,000 |

2. Add one dedicated account as a **License Tester** in Google Play Console.
   The tester must use the same account on the Android device. A testing track
   opt-in alone does **not** guarantee a test instrument or prevent real charges.
3. Install a package-matching, properly signed Play-capable build. The regular
   Android debug flavor sets `SHARIKA_PLAY_BUILD=false` and cannot exercise
   this UI. The release-format candidate sets it to `true`; verify its API
   origin is the isolated Play-virtual Worker and that the signing certificate
   is accepted by Firebase. The native `playBillingPurchase` bridge currently
   requires a Firebase user with `isEmailVerified() == true`.
4. Keep the isolated backend's global purchase flag **off** until a narrowly
   scoped tester-only purchase gate and the exact tester identity are reviewed.
   Turning the global flag on is **not** a safe substitute for License Testing;
   other enrolled users might otherwise reach a real payment flow.
5. Verify the Google Play service account has package-specific permissions to
   read and consume purchase tokens. A successful Google STS exchange alone
   does not establish Android Publisher purchase permissions.

## Manual device test matrix — all still pending

Use Google Play's **Test instrument, always approves** or **always declines**
payment method (not a personal credit/debit card). For a test purchase, confirm
Google Play labels the dialog as a test. Do not accept a dialog showing an
ordinary payment method or a real charge.

| Case | Action | Required result |
| --- | --- | --- |
| Happy path | Buy one 500k package with the approving test instrument | Google confirms `PURCHASED`; Worker verifies receipt and Firebase obfuscated account ID; exactly +500,000 coins and one immutable ledger row; token consumed. |
| Replay | Send the same token again from the same account | Response identifies duplicate; **zero additional coins** and no second ledger row. |
| Cross-account replay | Replay the token as a different Firebase user | 409/denied; no grant. |
| Declined payment | Select the declining test instrument | No coin or ledger change. |
| Cancelled payment | Cancel the Google Play purchase dialog | No coin or ledger change. |
| Pending payment | Use a pending test purchase state | No grant until the state becomes `PURCHASED`; recover on store reopen. |
| Consume failure | Simulate a temporary failure to consume after the verified credit | Exactly one credit; retry consumption without granting again. |
| Blocked account | Attempt a verified receipt for a blocked profile | No credit; transaction rolled back. |
| Balance limit | Attempt a credit that would exceed the Worker maximum | No negative balance and no partial purchase/ledger write. |
| Other SKUs | Repeat with 2.5M and 5M test products | Exact per-product coin grant, no duplicate. |

## Evidence and guardrails

- Before and after each case, record the tester's **non-sensitive** public ID,
  coin balance, event time, product ID, HTTP result, purchase-table row count,
  and wallet-ledger row count. Do not put raw purchase tokens, JWTs, OAuth
  credentials, passwords, or full order IDs into public logs or PR comments.
- A raw purchase token is never proof of payment. Only the Worker may use the
  Android Publisher API and write coins after verifying purchase state,
  product, quantity, consumption state, account binding and a valid order.
- Use the isolated Play D1 only. Do not modify staging/production finance or
  existing user balances to fabricate an end-to-end test.
- If any test fails, keep `SHARIKA_PLAY_BILLING_ENABLED=false`, preserve the
  immutable ledger for diagnosis and do not merge/publish billing changes.
- Google documents that **license test purchases** use special test payment
  instruments and can be refunded after a few minutes if unacknowledged; test
  consumables must be consumed/acknowledged promptly.

## Official references

- [Test Google Play Billing integration](https://developer.android.com/google/play/billing/test)
- [Integrate the Google Play Billing Library](https://developer.android.com/google/play/billing/integrate)
- [Android Publisher ProductPurchase fields](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products)

