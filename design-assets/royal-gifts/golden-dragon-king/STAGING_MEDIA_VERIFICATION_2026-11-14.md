# Golden Dragon King — staging media and inactive catalog verification

Date: 2026-11-14  
Environment: **Sharika staging only**, Cloudflare account `d81cf7c48fb9b36d468cb0a08720cd74`

## Successfully staged

- GitHub media action: [run 43597818868](https://github.com/soverixnet-design/Sharika/actions/runs/43597818868), status **success**. Source verification, ffprobe VP9 + alpha_mode=1 + Opus audio, FFmpeg decode, R2 put and byte-for-byte readback all passed.
- GitHub staging branch: `feature/sharika-golden-dragon-media-staging-20261114`.
- R2 bucket: `sharika-staging-media`, not production.
- **Transparent original video:** `studio/942e51e4-81cd-4131-87f8-7e4593171667.webm` (6,806,185 bytes; video/webm; 720×1280; VP9 alpha mode; Opus embedded audio).
- **Poster:** `studio/c049203b-e273-47da-9ef7-4458b20163d5.png` (1,156,285 bytes; image/png).
- R2 objects were verified through Cloudflare inventory after successful GitHub Actions byte-for-byte readback.

## Inactive catalog record in staging D1

- D1: `sharika-staging`, ID `b2c62252-12a5-4740-90c7-01a536d9a39a`.
- New `sharika_gifts` **id = 28**.
- `name = Golden Dragon King`
- `emoji = 🐉`
- `tab = 1` (Luxury)
- `price_coins = 10000000`
- `active = 0` (not available for purchase/send)
- `animation_url = https://sharika-api-staging.soverixnet.workers.dev/api/v1/media/942e51e4-81cd-4131-87f8-7e4593171667.webm`
- `image_url = https://sharika-api-staging.soverixnet.workers.dev/api/v1/media/c049203b-e273-47da-9ef7-4458b20163d5.png`
- `audio_url = ''` because the original WebM contains an embedded Opus track.

R2 objects were uploaded with Wrangler and the inactive D1 record was inserted through an authorized Cloudflare API connection. This did **not** go through the application's Super Admin Media Studio, so do **not** claim its upload audit log was created. The first attempted multi-query including a synthetic audit actor failed an audit-table foreign-key constraint; the transaction was rejected and had no partial effects. The successful second operation inserted only the inactive gift record. Never attribute the automation action to a human admin.

### Financial invariants

Before/after catalog insert:
- `sharika_wallet_ledger = 2749` (unchanged).
- `sharika_gift_transactions = 64` (unchanged).
- `sharika_gifts = 27 → 28`.
- `sharika_admin_audit = 81` (unchanged; no impersonated audit actor).

D1 Time Travel recovery bookmark captured before catalog insert:
`0000105b-00000000-00005123-a86a1f6880fa883f18d5d44850d2939e`.

## Remaining release blockers (not done)

1. Test real Android devices: playback of 720×1280 VP9-alpha WebM over active rooms without black fill, Opus audio, sound permission fallback, and seat/voice-room continuity.
2. Test loading/Range GET/HEAD through the public Worker from mobile networks. Head requests issued in the Cloudflare tool's external-fetch sandbox returned 403 for both GitHub raw and public Worker URLs; that response is **not sufficient evidence** that the public Worker itself denies media.
3. Verify one fullscreen video player at a time, recipient/sender rendering, and repeated gift events without duplicate playback, and that voice chat stays audible.
4. Only then get owner/release approval to set `active = 1` in staging. Production/Play publication requires separate QA and release approval.

No production R2, database, Worker, or Google Play release was changed. No coin balances changed.
