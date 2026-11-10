# Sharika Google Play Billing: keyless WIF

The isolated, non-redeemable Play Worker (`sharika-api-play-virtual`) can verify
one-time coin purchases without storing a Google service-account private key.
Do not enable Billing on the general staging or cash/salary production Worker.

## Existing identity chain

1. The Play Worker calls the separate Cloudflare Access-protected endpoint
   `https://billing-identity.sharika.app/internal/google-wif/subject-token`
   with a **service token**. Do not expose this endpoint publicly.
2. The identity Worker validates the Access-signed application JWT (including
   issuer, audience, service identity, signature and expiry) and returns it.
3. The Play Worker exchanges the JWT at Google's Security Token Service for
   a federated token using the configured Google WIF provider audience.
4. The federated principal impersonates the Google Play service account via
   IAM Credentials `generateAccessToken`, scoped to `androidpublisher`.
5. The Play Worker verifies the receipt with Android Publisher, commits a
   once-only D1 ledger entry and consumes the purchase token.

## Worker bindings

Configure the following **only on the isolated Play Worker** in Cloudflare
Variables and Secrets. These bindings already exist in the dashboard; verify
their values out-of-band. Never copy their secret values into Git, logs or chat.

| Binding | Required value |
| --- | --- |
| `PLAY_BILLING_AUTH_MODE` | `wif` (or supported alias `wif_access`) |
| `PLAY_BILLING_WIF_IDENTITY_URL` | HTTPS URL above, with the exact path |
| `PLAY_BILLING_WIF_ACCESS_ISSUER` | Team `https://...cloudflareaccess.com` issuer |
| `PLAY_BILLING_WIF_ACCESS_AUDIENCE` | Access identity app audience tag |
| `PLAY_BILLING_WIF_ACCESS_CLIENT_ID` | Dedicated Access service token client ID |
| `PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET` | Dedicated Access service token secret |
| `PLAY_BILLING_WIF_PROVIDER_AUDIENCE` | `//iam.googleapis.com/projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL` | Google Play API service-account email |

The Access service token has an expiration date. Monitor and rotate its secret
before expiry; a valid WIF provider alone cannot recover from an expired
Cloudflare Access service token. Do not log token responses or bearer tokens.

The Google WIF provider must accept the Access application's `aud` and issuer,
and the mapped federated principal must be granted service-account
impersonation (typically `roles/iam.workloadIdentityUser`) on that service
account. Enable Google Security Token Service, IAM Credentials and Google Play
Developer APIs in the appropriate Google Cloud project. The service account
must have the **View financial data** and **Manage orders and subscriptions**
app permissions in Play Console.

## Release sequence

1. Keep `SHARIKA_PLAY_BILLING_ENABLED=false`; this is the live default.
2. Run `node --test test/play-billing.test.mjs test/play-virtual-only.test.mjs`
   and the full `npm run check` suite.
3. Deploy/review the WIF-capable Worker with Billing still disabled. Check
   that existing auth, voice, wallet, and room routes remain healthy.
4. Using a licensed test buyer in the closed Play track, verify the complete
   WIF token-exchange chain, purchase, once-only credit, consumption and retry.
   A unit-test mock does not prove Google project/pool IAM configuration.
5. Only then enable the flag for Play, monitor errors, and distribute the
   appropriately signed AAB to the authorized Play test track.

Do not substitute a long-lived Access assertion for a fresh identity response
or turn on Billing merely because the Play product catalog is active.

Official references:

- https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
- https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
