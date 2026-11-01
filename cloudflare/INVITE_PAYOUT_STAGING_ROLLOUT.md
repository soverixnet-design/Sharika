# Invite coins, USD requests and owner-controlled rates — staging rollout

**Not deployed. No automated USD payout.** The feature depends on new staging
D1 migrations and secrets. Do not enable financial requests in production until
the responsible owner has reviewed anti-abuse, identity, payments, privacy,
local regulations and the authenticated Android release.

## Reward rules, initially

| Admin-controlled setting | Initial value |
| --- | ---: |
| Inviter virtual coins | 100,000 |
| Newly invited virtual coins (total signup award) | 100,000 |
| Inviter pending USD cash earnings | $0.10 per eligible referral |
| Coins shown per US dollar | 500,000 |
| First independently verified recharge bonus | 40% once |
| Eligible invitee recharge commission | 5% coins to inviter |
| Allowed requested USD withdrawals | $50 or $100 |
| Late referral-code window | 48 hours |

Super Admin edits these nine values in **Daily → Invitation, recharge & payout
settings**, saving a versioned, audited rate card. Finance can view but cannot
edit. Changes apply to newly granted rewards, not prior ledger entries or USD
earnings. The rate card has safety ranges; the conversion is capped at 1,000,000
coins per dollar by the existing 1,000,000-coin manual credit limit. A higher
conversion would require a separate reviewed recharge-limit change.

## Security, staging operations and secrets

1. **Do not run old migrations blindly.** The existing isolated staging D1
   journal has known drift (see `README.md`). Back up and reconcile exact
   physical schema and applied migrations first. `0032` and `0033` are additive
   candidates, **not yet applied**. `0032` must precede `0033`.
2. Configure **server-only** Worker secrets before accepting invited signups
   or bank payouts:
   - `INVITE_DEVICE_PEPPER`: a random, nonpublic string of 32+ characters.
     Changing it after registrations breaks old device matches, so retain it
     securely and plan explicit re-enrollment before rotation.
   - `INVITE_BANK_ENCRYPTION_KEY_B64`: base64 encoding of 32 cryptographically
     random bytes for AES-256-GCM. Keep an encrypted backup; losing it makes
     pending bank instructions unreadable. Never put it in JS, logs, Git or chat.
3. Confirm staging-only Worker and D1 environment IDs, then apply vetted
   migrations/secrets and deploy separately. Test two real devices, one device
   with two accounts, first recharge, settings changes, bank decrypt access,
   withdrawals and rejected/paid receipts. Do not assume automated CI tests
   prove device integrity or a real financial transfer.
4. The official Android shell sends a locally hashed app-scoped `ANDROID_ID`
   signal. The Worker HMACs that digest before storing it. Duplicate eligible
   devices are prevented by a D1 partial unique index. This signal can be
   reset/spoofed; it is **not strong identity verification**. Before actual
   external payouts, add Google Play Integrity-backed attestation, manual
   account screening and suitable payment/compliance controls. Without a
   working signal and Worker secret, a new account can register normally but
   cannot receive a referred-signup bonus.
5. Bank form requires bank name, account-holder name, account number and
   branch. Only AES-GCM ciphertext plus masked last four digits is stored in
   the withdrawal row. The admin finance inbox stores a reference/amount only,
   and the full bank form is shown only on an authenticated Super/Finance
   details request. Avoid screenshots, browser caching, external analytics and
   copying account details to support messages.

## Payment workflow (manual only)

- Invited users generate **pending** USD earnings only on verified eligible
  referrals; a different finance/super reviewer confirms account legitimacy
  and device eligibility before approving them.
- Once approved earnings cover a configured option ($50 / $100 by default),
  an adult member fills the bank form and requests withdrawal. The server
  reserves the balance in a single database transaction and posts a masked
  item to the owner/finance admin inbox.
- Owner/finance opens the request, reviews identity, copies bank instructions
  directly to the external bank, and transfers **outside Sharika**. Only after
  confirming the bank transfer, the finance reviewer records a unique payment
  transaction reference and marks Paid. Rejection releases the reservation.
- No transfer API, refund API, bank integration or auto-payment process is
  provided. Do not present these virtual coins as redeemable for cash.
