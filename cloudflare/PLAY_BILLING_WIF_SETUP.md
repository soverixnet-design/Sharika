# Sharika Google Play billing: keyless Google WIF (staging)

**Status (2026-11-10):** Identity Worker deployed on Cloudflare and protected
by a dedicated Access Service Auth policy. The staging billing Worker has WIF
bindings saved, but its WIF adapter is **not deployed** and Google's WIF
configuration is **not yet complete**. An unauthenticated request to the identity
host returned HTTP 401. `SHARIKA_PLAY_BILLING_ENABLED` remains `false`; user
purchases must remain disabled until an end-to-end Google Play test passes.

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

## Cloudflare resources already created

| Resource | Verified configuration |
| --- | --- |
| Identity hostname | `billing-identity.sharika.app` |
| Identity Worker | `sharika-play-billing-identity` (custom domain attached, `workers.dev` and previews disabled) |
| Access application | `Sharika Play Billing WIF - Identity Endpoint` (self-hosted, service auth only) |
| Access application AUD | `eaf8f3b63b314bf4c22ca54fcad7b05f330ca90d0ec4b33da254e1141302853b` |
| Dedicated Service Token Client ID | `3950c7810ccab2a6c516fcc34a95b893.access` |
| Access token duration | `15m` |
| Identity Worker issuer | `https://broken-dew-401f.cloudflareaccess.com` |
| Billing Worker | `sharika-api-play-virtual`; WIF settings and service token saved as Worker secrets |

The **Client Secret is stored only in Worker Secrets** and must never be copied
into documentation, GitHub, screenshots or Google WIF audience fields. The
existing `Sharika Production QA - Owner Access` application was not modified.

## Remaining Google Cloud setup and verification

1. In Google Cloud project `project-dcd1acf2-621e-4aea-94b`, confirm billing
   is enabled (the account previously displayed a free-trial prepayment banner).
   The verified numeric project number is **`558304223315`**; it differs from
   the project ID and the service account's numeric ID. Enable IAM, Resource Manager,
   Service Account Credentials and Security Token Service APIs as required.
2. **Completed.** The Access application, dedicated service token and
   restrictive reusable policy have been created as listed above.
3. **Partially completed in Google Cloud.** The existing WIF pool is
   `sharika-play-billing` (not `sharika-billing`) with OIDC provider
   `cloudflare-access`, issuer `https://broken-dew-401f.cloudflareaccess.com`.
   **Replace the incorrect current Allowed audience `cloudflare-access` with**
   `eaf8f3b63b314bf4c22ca54fcad7b05f330ca90d0ec4b33da254e1141302853b`.
   This is the dedicated Access application's AUD, not the Google WIF
   resource name. Cloudflare Access service JWTs may have empty `sub`;
   map `google.subject=assertion.common_name` (the service-token Client ID).
   Set the provider attribute condition to:

   ```cel
   assertion.type == 'app' && assertion.common_name == '3950c7810ccab2a6c516fcc34a95b893.access' && 'eaf8f3b63b314bf4c22ca54fcad7b05f330ca90d0ec4b33da254e1141302853b' in assertion.aud
   ```

   The SDK-free
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
   `principal://iam.googleapis.com/projects/558304223315/locations/global/workloadIdentityPools/sharika-play-billing/subject/3950c7810ccab2a6c516fcc34a95b893.access`.
   The service account already has app-scoped purchase access in Google Play
   Console; recheck it if the principal is changed.
6. **Completed.** The isolated identity Worker was deployed only after Access
   was configured. The custom hostname and disabled workers.dev were verified;
   unauthenticated HTTP GET returned `401 Unauthorized` from Access.
7. **Completed in Cloudflare.** The *existing* billing Worker has the following
   values saved as Worker Secrets. Keep sensitive values out of source control:

   | Binding | Value |
   | --- | --- |
   | `PLAY_BILLING_AUTH_MODE` | `wif_access` |
   | `PLAY_BILLING_WIF_PROVIDER_AUDIENCE` | `//iam.googleapis.com/projects/558304223315/locations/global/workloadIdentityPools/sharika-play-billing/providers/cloudflare-access` |
   | `PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL` | `sharika-play-billing@project-dcd1acf2-621e-4aea-94b.iam.gserviceaccount.com` |
   | `PLAY_BILLING_WIF_IDENTITY_URL` | `https://billing-identity.sharika.app/internal/google-wif/subject-token` |
   | `PLAY_BILLING_WIF_ACCESS_ISSUER` | `https://broken-dew-401f.cloudflareaccess.com` |
   | `PLAY_BILLING_WIF_ACCESS_AUDIENCE` | `eaf8f3b63b314bf4c22ca54fcad7b05f330ca90d0ec4b33da254e1141302853b` |
   | `PLAY_BILLING_WIF_ACCESS_CLIENT_ID` | Dedicated service-token Client ID (**secret binding**) |
   | `PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET` | Dedicated service-token Client Secret (**secret binding**) |

   No `PLAY_BILLING_SERVICE_ACCOUNT_JSON` is needed in WIF mode. It does not
   silently fall back to the private-key mode if federation fails.

8. Deploy the reviewed WIF adapter to the **isolated** billing Worker after
   the Google side is configured. First verify a successful service-token
   request, Google STS exchange and service-account impersonation while the
   purchase flag is still off.
9. Activate purchase options on Google Play's products, and do an official
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
