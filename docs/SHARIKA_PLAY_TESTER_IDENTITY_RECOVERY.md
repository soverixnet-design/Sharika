# Sharika closed testing: account identity and Admin visibility

Verified 2026-11-09 (read-only Cloudflare D1 inspection):

| Database | Users | Admin roles |
| --- | ---: | ---: |
| `sharika-staging` | 9 | 2 |
| `sharika-play-virtual` | 2 | 0 |

The Android Play build is configured for an isolated Worker and D1 database.
Both environments use the same Firebase project, but `sharika_users.public_no`
is assigned separately in each D1. A verified Firebase UID had staging ID
`10000003` and Play ID `10000002`. The Play ID `10000001` collides with a
different Firebase identity in staging. **Never join, merge or grant privileges
on the basis of `public_no` alone.** Old staging records are still present;
the Play accounts are independent, not lost Google accounts.

## Read-only Admin visibility change

The staging Admin frontend now has a separate **Play Closed-Test Users** page.
It requests `GET /api/v1/admin/play-testers`, a local Admin frontend route that:

1. Requires a Firebase bearer token.
2. Calls the existing private staging API service binding `/api/v1/admin/status`
   to revalidate the token and require `role === 'super'`.
3. Reads the *isolated* Play D1 through a separate read-only query.
4. Looks up old staging IDs by exact Firebase UID, never by numeric ID.
5. Returns up to 100 public Play profiles and optional previous IDs; omits
   auth UIDs, emails, wallet balances and all admin edit actions.

`cloudflare/wrangler.admin.jsonc` binds both D1 databases. This frontend has no
write operation for Play users. The restricted Play API Worker stays unchanged.

To publish, review the diff; run `npm --prefix cloudflare run check`; package
the original Admin shell and connection script into
`cloudflare/src/admin-index.html` and `cloudflare/src/admin-connection.txt`
as the existing guarded deploy workflow does; dry-run and deploy only
`cloudflare/wrangler.admin.jsonc` with authorized Cloudflare credentials.
Confirm `/health` and then the new `Play Closed-Test Users` nav as a verified
staging Super Admin. Deployment is **not implied** by editing these files.

## Google sign-in screenshot

The current Android Credential Manager reports
`GetCredentialCancellationException` as `google_sign_in_cancelled`. Google says
this can be an actual user cancellation **or** a technical authorization
problem. Do not automatically retry a consent failure.

Before changing the account system, obtain the app-signing certificate SHA-1
and SHA-256 from Google Play Console for `com.soverixnet.sharika`, compare
against Firebase Project Settings > Android app > SHA fingerprints, and
register any missing Play-signing SHA fingerprints. Download the updated
`google-services.json`, rebuild the signed Play AAB, distribute to testers,
and test an on-device Google account selection. The upload-key certificate
is **not necessarily** the Play-distributed signing certificate.

Do not delete a staging or Play user, remap an existing ID, or transfer cash,
seller inventory, salaries, and historical wallet balances during testing.
Future profile migration must be separately backed up, matched by Firebase UID,
and conflict-reviewed with the account owner.
