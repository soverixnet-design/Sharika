# Sharika public privacy and account-deletion request service

The public policy service is isolated from `sharika-api-staging`, so publishing
these pages does not change live rooms, voice, login or coin balances.

- Privacy Policy: https://sharika-play-policy.soverixnet.workers.dev/privacy-policy
- Account deletion request: https://sharika-play-policy.soverixnet.workers.dev/account-deletion
- Worker: `sharika-play-policy` (Cloudflare account `d81cf7c48fb9b36d468cb0a08720cd74`)
- Source/config: `src/play-policy-worker.mjs`, `wrangler-play-policy.jsonc`
- Pending requests: D1 `sharika-staging`, table `sharika_account_deletion_requests`

The `0065_play_account_deletion_requests.sql` migration creates a new table only.
No request automatically changes an account, Firebase identity, gift history or wallet.

## Support procedure

1. Review new rows in the authenticated Admin Support Inbox after the main Worker
   containing PR #108 is safely deployed. Before that, the authorized operator
   can check the new D1 table directly without exposing it to public web users.
2. Contact the requester at their supplied email. Verify ownership against
   Sharika's existing authenticated user profile before acting. A public ID or
   contact email alone does not prove account ownership.
3. Confirm the scope of associated data and required legal/security/transaction
   record retention. Process the approved deletion through a separately audited,
   authenticated workflow. Never use the public POST request itself as authority
   to delete or mutate wallet balances.
4. Record the case outcome (`pending`, `in_review`, `completed` or `rejected`)
   and communicate the outcome to the requester. Preserve an auditable support
   trail without retaining unnecessary personal details.

To inspect counts without reading contact details:

```sql
SELECT status, COUNT(*) AS requests
FROM sharika_account_deletion_requests
GROUP BY status;
```

Run the isolated Worker tests locally with
`node --test test/account-deletion.test.mjs test/privacy-policy.test.mjs test/play-policy-worker.test.mjs`.

The dedicated Cloudflare GitHub build trigger for the deletion feature branch
runs `npm run check` followed by `npx wrangler deploy --dry-run`; it cannot
publish or overwrite the live staging Worker.
