# Seller Wallet and Admin Coin Controls — staging implementation contract (2026-11-09)

Status: specification only; NOT deployed, NOT enabled. Do not infer Google Play policy approval.

## Authorized features
- Super Admin can assign/revoke approved seller status by user ID; record actor, timestamp, reason and prior state.
- Super Admin can credit/debit a user Main Wallet or approved seller Seller Wallet with explicit wallet selection, positive integer units, reason, idempotency key and immutable audit ledger. Never allow negative balances.
- Seller Wallet displays balance, transaction history and Google Play recharge availability; seller recharge permission is independently configurable per seller, default OFF.
- Seller recharge tiers: USD 100 => 10%, 500 => 15%, 1000 => 20%, 3000 => 30%, 5000 => 40%. Base mapping USD 1 = 500000 coins; bonuses are mutually exclusive with ordinary recharge bonuses. Treat tier prices as proposed, subject to Play Console product price limits and availability.
- Only server-verified, non-refunded Play Billing purchases may credit seller wallet. Bind purchase token uniquely to account, product, amount and grant, with idempotent acknowledgement, refund/chargeback reversal and auditable reconciliation.
- Recharge Level increases only for eligible paid Play purchases; admin credits, salary exchanges, seller transfers and promotional coins do not count.
- Seller-to-user transfers require available balance, approval, explicit server-side authorization, atomic debit/credit and immutable ledger. No off-platform payment facilitation or cash redemption; seller resale for cash is release-blocked pending policy/legal review.
- Salary Wallet transfer and exchange remain unchanged pending separate safety and policy QA. Preserve existing double-spend guards.

## Required QA before enablement
1. Unauthorized role denied; revoked seller denied; recharge toggle OFF denied by API even if UI is manipulated.
2. Concurrent debit/transfer requests cannot overspend; duplicate idempotency key grants exactly once.
3. Play token replay, wrong account/product, failed purchase, refund, and pending purchase do not mint spendable coins.
4. Admin coin credit/debit creates exactly one balanced ledger record and no Recharge Level increase.
5. Seller recharge tier boundaries and bonus calculations validated using integer arithmetic.
6. No real-money payout, external seller cash-sale links, or circumvention of Google Play billing.
7. Verify Play Console product price caps and Payments policy before publishing.

No migration, API route, billing product, live balance, or production setting is changed by this document.
