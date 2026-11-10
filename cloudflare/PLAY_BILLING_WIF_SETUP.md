# Sharika Google Play billing: keyless Google WIF (staging)

**Status:** Code implemented and unit-tested. **Not configured or deployed.**
`SHARIKA_PLAY_BILLING_ENABLED` stays `false`, and user purchases must remain
disabled until a real, end-to-end Google Play test passes.

## Why this design

Google Cloud organisation `yfastvpn-org` enforces
`iam.disableServiceAccountKeyCreation`. Keep that protection enabled. Instead:

1. The public Sharika billing Worker contacts a *separate*, Access-protected
   identity Worker with a dedicated Cloudflare Access service token.
2. Cloudflare Access signs a short-lived application JWT. The identity Worker
   checks Cloudflare's RS256 signature, application audience and the exact
   service-token ID, then returns the assertion to the calling Worker.
3. Google Security Token Service validates the token against a WIF pool/provider.
4. IAM Service Account Credentials impersonates the existing Play service account
   to obtain a short-lived `androidpublisher` access token. No Google private key
   is exported or stored by Cloudflare.

The Cloudflare Access service-token ID and secret **are still credentials**.
Store both as Cloudflare Worker secrets, keep a narrow Service Auth policy and
rotate them. Do not make the identity Worker public or reuse the existing
`qa-api.sharika.app` Access app, whose access rules are unrelated.

## External setup required before deployment

1. In Google Cloud project `project-dcd1acf2-621e-4aea-94b`, confirm billing
   is enabled (the account previously displayed a free-trial prepayment banner).
   Determine the numeric **project number**; it differs from the project ID
   and the service account's numeric ID. Enable IAM, Resource Manager,
   Service Account Credentials and Security Token Service APIs as required.
2. Create a dedicated Cloudflare Access **self-hosted** application protecting
   `billing-identity.sharika.app`. Its policy must be `Service Auth`, accepting
   *only one dedicated service token* for Sharika Play billing. Record its
   app AUD and that service token's Client ID. Set a short app token lifetime.
3. Create Google WIF pool `sharika-billing` and OIDC provider
   `cloudflare-access`. Issuer: `https://broken-dew-401f.cloudflareaccess.com`.
   Allowed audience: the dedicated **Access application's AUD**, not the Google
   WIF resource name. Cloudflare Access service JWTs may have empty `sub`;
   map `google.subject=assertion.common_name` (the service-token Client ID).
   Restrict provider's attribute condition to `assertion.type == 'app'`, the
   exact Client ID and an audience containing the exact app AUD. The SDK-free
   Worker will send the canonical provider resource name to Google's STS.
4. Cloudflare Access publishes its **public** signing JWKs at
   `https://broken-dew-401f.cloudflareaccess.com/cdn-cgi/access/certs`.
   If the Access issuer cannot be used for standard OIDC discovery, configure
   the Google WIF provider with the *public* uploaded JWKS. Key rotation must
   then also refresh Google's uploaded JWKS; otherwise federation will stop.
   Never upload the service-token secret or any private key as a JWKS file.
5. Grant `roles/iam.workloadIdentityUser` on
   `sharika-play-billing@project-dcd1acf2-621e-4aea-94b.iam.gserviceaccount.com`
   to **only the principal representing the exact Access service token**:
   `principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/sharika-billing/subject/CLIENT_ID`.
   The service account already has app-scoped purchase access in Google Play
   Console; recheck it if the principal is changed.
6. Replace placeholders in `wrangler.play.billing-identity.jsonc`, then
   **only after Access is already enforcing the Service Auth policy**, deploy
   the isolated identity Worker. Confirm `workers_dev: false`, the exact host,
   and that direct or unauthenticated requests return `403`/`404`.
7. Configure the *existing* billing Worker with the following environment
   values. Keep sensitive values in Cloudflare secrets, never source control:

   | Binding | Value |
   | --- | --- |
   | `PLAY_BILLING_AUTH_MODE` | `wif_access` |
   | `PLAY_BILLING_WIF_PROVIDER_AUDIENCE` | `//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/sharika-billing/providers/cloudflare-access` |
   | `PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL` | `sharika-play-billing@project-dcd1acf2-621e-4aea-94b.iam.gserviceaccount.com` |
   | `PLAY_BILLING_WIF_IDENTITY_URL` | `https://billing-identity.sharika.app/internal/google-wif/subject-token` |
   | `PLAY_BILLING_WIF_ACCESS_ISSUER` | `https://broken-dew-401f.cloudflareaccess.com` |
   | `PLAY_BILLING_WIF_ACCESS_AUDIENCE` | Exact new Access app AUD |
   | `PLAY_BILLING_WIF_ACCESS_CLIENT_ID` | Dedicated service-token Client ID (**secret binding**) |
   | `PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET` | Dedicated service-token Client Secret (**secret binding**) |

   No `PLAY_BILLING_SERVICE_ACCOUNT_JSON` is needed in WIF mode. It does not
   silently fall back to the private-key mode if federation fails.

8. Activate purchase options on Google Play's products, and do an official
   sandbox purchase with proper receipt verification, coin credit, consume
   and idempotent retry on the isolated Play database. Only after all checks
   succeed can `SHARIKA_PLAY_BILLING_ENABLED` be changed to `true`.

## Tests and safeguards

Run:

```sh
node --test test/play-billing.test.mjs test/play-billing-identity.test.mjs
```

The identity endpoint verifies Cloudflare's **signature** using its public
JWKS and checks `iss`, app `aud`, token ID and expiration. The billing Worker
performs preflight claim checks, then Google independently validates the JWT.
The identity endpoint responds without CORS and with `Cache-Control: no-store`.
Both endpoints fail closed if configuration, authentication or Google STS
impersonation is unavailable.

## Reference docs

- [Google Cloud: WIF with other identity providers](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers)
- [Google Cloud: WIF best practices](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation)
- [Cloudflare Access: service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Cloudflare Access: application JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare Access: verifying JWT signatures](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
