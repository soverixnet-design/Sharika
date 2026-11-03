# Sharika Royal Family & BD — staging rollout

Status: isolated staging Worker and test APK have been deployed; this branch
is still a draft PR and is NOT a production release. Existing balances and gift
history are unchanged. The new member-management migration 0049 is additive.
Pre-upgrade staging D1 bookmark:
000003b4-00000000-00005118-7f4c038a5ce33dc63fd1447b4d571b1c.

## Screens

- Android Main Profile → Royal Family: membership, Join Request, Crystal Wallet,
  history, leader controls (Co-leader/Elder roles, remove, transfer ownership).
  Rejected and previously accepted requests can be reopened after cooldown.
- Android Main Profile → BD System: visible only after active BD permission; Family Grant, My Families, commission statement and transfer request.
- Admin Panel → Family & BD System: assign/revoke BD permission, suspend/reactivate
  individual Families, edit future percentages, choose daily or monthly reports,
  approve/reject seller transfers, view immutable records, download CSV evidence.
- Existing Sheet: https://docs.google.com/spreadsheets/d/1u-6FRnn3noeK2-fQRT_FK_arengxQycZKXnJqjDEaxg/edit

## Financial rules

| Rule | Staging default |
|---|---|
| Family owner | 10% Crystal on non-Lucky gifts by other Family members |
| BD | 5% Crystal on non-Lucky gifts by members of BD-granted Families |
| Integer precision | 10000 crystal_units = one Crystal |
| Commission updates | Super Admin changes future rates only |
| Display cadence | Monthly, configurable to daily |
| Seller conversion | Disabled by default; requires Admin approval per transfer |
| Conversion when enabled | One whole Crystal = one seller-stock coin (editable) |
| Existing room reward | Unchanged, separate 10% room coin reward |
| Existing gift recipient reward | Unchanged; no additional ambiguous 50% payout |

Gift and Family commission inserts are in one atomic D1 batch. Existing gift
idempotency prevents duplicate commissions. Transfer approval atomically
credits seller stock and records one immutable audit event. The ledger denies
overdraft. Family joins have a 24-hour cooldown after a leave and enforce the
member cap. Owner ownership transfer UI is not yet implemented.

## Tests run

- Syntax parser: Family Worker, Sheet Worker, Admin Panel, Android staging UI.
- In-memory SQLite: exact 100-coin gift => 5 BD Crystals, 10 owner Crystals;
  ownership transfer, role changes, request reopening, leave cooldown and
  immutable activity guards.
- Approved seller transfer credits stock once, and a second approval/overdraft
  cannot inflate stock.
- SQL test added to npm run check. Real Android and staging end-to-end tests
  are still required.

## Safe rollout

1. Reconcile this branch with current staging deployments. There are many
   other Android, Admin and Worker branches; replacing the deployed Worker
   with an older branch could regress voice or Google login.
2. Run npm run check in cloudflare. Make a D1 Time Travel bookmark first.
3. Verify current sharika-staging Family tables and apply ONLY the additive
   cloudflare/migrations/0049_family_membership_management.sql using the
   isolated staging Worker workflow. Do not apply the entire migration backlog.
4. Deploy the reviewed API and Admin staging Workers, then build an updated staging APK.
5. Test verified BD permission, Family Grant, member join, 5% and 10% gift
   credits, Seller transfer and all audit reports on test IDs.
6. Publish only after Android/device smoke tests and review.

## Google Sheets — connection still pending

The existing Sheet ID is stored as a non-secret staging variable. Live
synchronization requires a dedicated Google Cloud service account with Sheets
API enabled. Share this exact Sheet with the service account email as Editor,
and add the following private secrets to the staging Worker:

- GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL
- GOOGLE_SHEETS_PRIVATE_KEY

Never paste the private key into Google Sheet cells, GitHub files or Android.
The Worker signs a short-lived OAuth JWT and writes verified D1 data as RAW
cell values, preventing formula execution from user names.

With credentials and deployment, the existing Worker cron will attempt one
successful sync per UTC day. Super Admin can also use the manual Sync button.
A hard 999 data-row limit per tab blocks silent data loss; extend pagination
before this limit is reached. Until then, reports from the Admin Panel can be
downloaded as CSV after verifying the 1000-row cap.

No verified Family/BD data has been synced yet, and no coin-like payouts have
been executed from the new Crystal system.
