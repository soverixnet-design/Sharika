# Sharika Invite Friend + USD withdrawals — staging rollout

This change is **source-only** until reviewed and manually deployed. It does not
modify the existing production app, Sovera, Akira, or payment accounts.

## Included
- Verified eight-digit referral codes. The invite landing page is `GET /i/{code}`;
  existing installed apps open with `sharika://invite/{code}`.
- Play Store install referrer extraction for deferred attribution, once the
  matching `com.soverixnet.sharika` Android package is published on Play.
  Direct sideload APK installs do **not** preserve a referral automatically.
- New Android signups can submit the invite code automatically from the link.
  Existing new accounts can claim an inviter on `POST /api/v1/invites/claim`
  within the admin-set period (48 hours by default).
- A device hash is bound to one eligible referral account. Two accounts on the
  same Android device may register but cannot both claim invite rewards.
  The raw Android ID is sent only by native code in a fixed-origin HTTP request,
  is never shown to WebView JavaScript or stored in D1, and is hashed on the
  server. This is **best-effort fraud control**; a modified APK/emulator can
  spoof the identifier. Before real-money production payouts, integrate and
  verify Play Integrity server-side and add abuse/chargeback review.
- Server-atomic, one-time inviter/invitee coin credit, adjustable for future
  referrals via Super Admin. Recharge commissions use the configured percent.
- Separate non-convertible referral USD promotional credit ledger, in **cents**.
  No claims of exchangeability between coins and dollars.
- Withdrawal requests reserve USD funds once, encrypt full bank details using
  AES-256-GCM, and appear in the authorized admin inbox. Super Admin marks a
  manually settled payment paid with a bank reference or rejects it and restores
  the reserved USD; immutable cash ledger and admin audit record actions.
  No automatic bank, WhatsApp, or external message is sent.
- Only adult profiles are eligible for promotional USD credits/withdrawals.
- Default USD rewards and withdrawals are **OFF**, with $0 invite bonuses.
  No new cash liability is created until Super Admin explicitly configures
  and enables the campaign.

## API
| Method | Path | Role |
|---|---|---|
| GET | /api/v1/invites | Signed-in member: code, link, stats, claim eligibility, USD balance, cashout history |
| POST | /api/v1/invites/claim | Signed-in member: 8-digit inviter code, time/device checks |
| POST | /api/v1/invites/withdrawals | Signed-in adult: amount_cents, bank_name, account_name, account_number, payout_country, UUID request_id |
| GET | /api/v1/admin/invites | Finance/Super: referral report and rule settings |
| PATCH | /api/v1/admin/invites | Super only: all rule keys as integers |
| GET | /api/v1/admin/invites/withdrawals | Finance/Super: bank payout inbox |
| POST | /api/v1/admin/invites/withdrawals/{UUID}/decision | Super only: paid/rejected, transfer reference, note |

## Migration and secrets (REVIEW BEFORE ANY RUN)
1. Take a **recoverable backup** of the isolated `sharika-staging` D1 database.
2. **Reconcile the existing migration-journal drift** first. The prior repository
   documents that `d1_migrations` may list only 0001 even when newer tables
   already exist. Do not blindly run all old migrations or rebuild tables.
3. Verify requirements 0001–0032 are present, then manually apply only the
   additive `cloudflare/migrations/0033_invite_cashout.sql` migration in staging.
   Review table names and trigger behavior on a cloned database first.
4. Set Worker secret `REFERRAL_PAYOUT_KEY` to a securely generated **32-byte
   random AES key, standard base64 encoded**. Keep a recoverable backup of the
   secret separate from source control: losing or rotating it without migrating
   records makes prior pending bank details unreadable.
5. Strongly recommend `REFERRAL_DEVICE_HMAC_KEY` as an independent random
   secret before any real-money reward. Changing this key later breaks
   existing device attribution unless hashes are migrated.
6. Publish only the isolated Sharika staging Worker, staged admin frontend,
   and staged Android APK through separately reviewed manual workflows.
   Do not change a production route or signing key inadvertently.
7. Test with two real Android devices and verified Firebase accounts:
   initial invite, 47-hour late claim, after-48-hour rejection, duplicate
   claims, same-device second-account denial, dollar settings, cashout hold,
   duplicate request ID, rejection refund, manual bank settlement, and
   old APK/unauthenticated denial. Verify Android Play install referral after
   an actual Play Store publication; it cannot be proven via a sideload.

## Important
This feature requires privacy disclosure of anti-abuse device identifiers and
financial information; a production release needs payment, data-retention,
age-eligibility and anti-fraud compliance review. The admin inbox is an internal
message queue, not a bank transfer or external notification gateway.
