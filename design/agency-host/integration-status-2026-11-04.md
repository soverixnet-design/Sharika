# Sharika Agency / BD / Host staging implementation

Date: 2026-11-04. Scope: source changes only; **not deployed**.

## Reference screens

- BD Center: gold/black Team Gift Performance, assigned Agencies, BD estimates, Agency Reports.
- Royal Agency: active/total Hosts, weekly gifts, searchable Host roster, active/review filters, Host assignment.
- Host Earnings: verified user profile image and ID, Today/7 Days/Month, pending salary estimate, individual gift activity, coin wallet transactions.
- 3D golden WebP icons are packaged in the native Android assets; image rows use real profile photos where available.

## Policy (all basis points editable by Super Admin)

| Item | Default | Accounting |
| --- | ---: | --- |
| Ordinary gift recipient | 100 coins → 100 diamonds | Existing verified `gift_received` wallet ledger |
| Diamond exchange | 100 diamonds → 40 coins | Existing revisioned, wallet-backed exchange |
| Host salary | 40% | New **pending**, non-wallet Agency ledger |
| Agency share | 10% | New **pending**, non-wallet Agency ledger |
| BD share | 5% | New **pending**, non-wallet Agency ledger, only active BDs |

`0059_agency_host_earnings.sql` adds the Agency policy, explicit Host assignments, immutable fixed-point earnings ledger and audit. It changes only an untouched `100:70, revision=1` exchange configuration to `100:40, revision=2`; custom admin rates remain unchanged. The Worker fallback on old schemas is also 100:40, so **apply the migration before deploying Worker code**.

Hosts must be verified adult members of an active Family; approved Families appear as Agencies, preserving existing relationships. An Agency owner or Super Admin can explicitly enable/disable the Host role. A BD can inspect their assigned Agencies, but cannot remove members or alter salary settings. An earnings entry is recorded only for real, regular gifts received after Host assignment, in the same D1 transaction as gift settlement. Lucky Gifts, replayed requests, and self-gifts do not create these entries.

## Verification

- `npm test` in `cloudflare`: **489/489 passed** after incorporating the latest staging Agency/Gaddy branch.
- `npm run check` in `cloudflare`: passed.
- `python3 test/agency-host-sql.test.py`: passed fixed-point 40/10/5 SQL, immutable entries, duplicate protection and conditional exchange update.
- Browser design preview: BD → Agency → Host → Coin Transactions and Back interactions visually inspected with clearly labelled sample data.
- Android native APK/AAB build and device testing: **not performed** (Gradle/Android SDK unavailable in this environment).

## Release gates and open decisions

1. Back up D1 staging and apply `0059_agency_host_earnings.sql` **before** the new Worker deployment; verify no custom exchange rate was overwritten.
2. Deploy Worker and admin staging, then produce APK and validate 3 screens in Android WebView with genuine profiles and gift events.
3. Confirm whether the new 40/10/5 earnings replace any legacy Family Crystal/BD rewards on overlapping gifts. The existing legacy Family and 10% Room Reward ledgers are intentionally untouched; approval/cash-out of the new estimates is **not implemented** to avoid duplicate payout.
4. Active voice minutes and monthly salary targets currently show honest “not tracked/not configured” states. Their rule sources must be specified before enabling these cards as actual targets.
5. Agency artwork falls back to the gold Agency icon; where present, the Family owner's profile picture is shown. Dedicated uploaded Agency logo management is a follow-up.

No live balance, historical gift event, Family Crystal, or seller-stock table was modified by this source edit.
