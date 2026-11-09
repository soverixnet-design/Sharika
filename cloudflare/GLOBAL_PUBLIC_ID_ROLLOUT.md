# Sharika permanent public IDs — guarded rollout

Status: **CODE PREPARED; LIVE MIGRATION NOT APPLIED**.

The Google Play closed-test build uses real Firebase Authentication, but its
profile, wallet and room data are currently isolated from staging. Both D1
databases independently assigned `MAX(public_no)+1`, making numeric IDs
ambiguous across environments. The immutable Firebase `auth_uid` is the only
safe cross-environment matching key. Never match two records by public number.

## Read-only snapshot (2026-11-10)

| Environment | Profiles | Current range | Rooms | Wallet ledger rows | Special IDs |
| --- | ---: | --- | ---: | ---: | ---: |
| Staging | 9 | 10000001–10000009 | 5 | 2747 | 2 |
| Play virtual | 4 | 10000001–10000004 | 3 | 10 | 0 |

The UID-matched provisional mapping, to revalidate just before any migration:

| Old Play number | Canonical number | Reason |
| --- | --- | --- |
| 10000001 | 10000010 | New UID; preserve its Play profile |
| 10000002 | 10000003 | Same Firebase UID as staging ID 10000003 |
| 10000003 | 10000008 | Same Firebase UID as staging ID 10000008 |
| 10000004 | 10000011 | New UID; preserve its Play profile |

This is NOT a command to run without fresh identity checks. If new users,
special IDs, or balances have changed, regenerate the mapping. Do not expose
Firebase UIDs to the browser, the admin UI, or user-facing logs.

## Dependencies and order — all mandatory

1. Take and verify restorable D1 backups for **both** databases; retain an
   external backup of the old UID-to-number mapping, room records, and wallet
   ledger totals. Pause both signups for the short cross-D1 transition, or
   use a deployment gate with a no-new-signup invariant.
2. Run migration `0079_global_public_identity_registry.sql` against the
   **staging D1**. Verify its 9 records exactly match all preexisting staging
   `sharika_users` by `auth_uid` and `public_no`. Check that the reserved
   special aliases do not occupy 10000010 or 10000011.
3. UID-compare all Play records to staging through a private authenticated
   operator, assign fresh numbers to Play-only UIDs in creation order,
   preserve numbers for UIDs present in staging, and reserve those numbers in
   the global table. Insert nothing by an ID-only join.
4. In a single Play D1 transaction, update the four Play `sharika_users`
   public keys with a **temporary unused valid 8-digit number** first and
   their canonical numbers second, verifying all four changed as expected.
   Check `PRAGMA foreign_key_check`, user counts, identity matching,
   and all wallet/ledger/gift counts and sums after the transaction.
   Do **not** edit immutable ledger rows, balances, or existing room IDs.
   Rooms retain their original IDs: they are a separate namespace, and room
   history/memberships must remain attached to those IDs.
5. Deploy BOTH Workers with the `SHARIKA_ID_DB` binding pointing to the
   **same staging D1**. Check each Worker can reserve two new UID identities
   in sequence; retrying the same UID must return the original number.
   Confirm an existing staging Firebase UID gets that same ID on Play.
6. Deploy the admin frontend update. Its main **Users** page can now show
   both lists side by side, with Play actions explicitly read-only and
   staging mutations still scoped to staging. Never block a Play user by
   colliding public ID through staging admin actions.
7. Download the regenerated `google-services.json` from Firebase after the
   newly approved Android APK signing SHA-1 is registered. Rebuild and test
   the signed APK and AAB, run all OAuth preflight checks, then complete
   real-device Google/email signup and login testing **before** uploading
   a new Play Store release.

## Invariants

- Every Firebase UID has one permanent public number across environments.
- Two distinct Firebase UIDs never receive the same public number.
- Numbers are monotonic for new identities. Failed registrations may reserve
  an unused number; never reassign it to another UID just to remove gaps.
- Play/test account data is **real and persistent**. Staging coins, gift
  ledgers, host salaries, staff privileges, and roles are **not** merged into
  Play without a separately approved, reconciled finance migration.
- Existing 8-digit room IDs may differ from the owning user's account ID;
  this preserves historical room links, messages and gift transactions.
- If any backup, UID match, count, or invariant fails, stop before changing
  the live ID columns. Do not delete accounts or retry destructive SQL.

## Verification commands (source only)

```bash
cd cloudflare
node --test test/global-public-ids.test.mjs
npm run check
```

All rollout steps that mutate D1 require a fresh live snapshot and verified
backups. This document intentionally contains no executable production
renumbering command and is safe to commit before the migration window.
