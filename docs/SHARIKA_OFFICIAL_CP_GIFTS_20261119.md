# Sharika Official Role Frames + CP Gift Import — staging (2026-11-19)

## Verified sources
- Sura Chat repository: `soverixnet-design/sura-chat-`, branch `feature/sura-oracle-live-integration-20261117`, file `android/app/src/main/assets/sura-chat.html`.
- Sura Chat D1 `sura-chat-staging`: `gifts` table exists but returned **zero rows** as inspected 2026-11-19. Gift sending is disabled; its Gift Catalog is read-only. Therefore there were **no source CP gift media objects** to migrate.
- The actual purple/gold generic gift-button PNG from Sura Chat's `REF_ICONS.gift` was imported losslessly as `sharika-premium/sura-gift-icon.png`. Do NOT represent it as a Sura CP gift asset.
- Sharika staging `sharika_bond_gifts` already had Rose Promise (5200), Royal Wedding (18800), Blue Promise (1200), Forever Friends (5200). These were preserved.

## New original Sharika CP items, staged
- Royal Rose: 10,000 virtual coins; `cp-royal-rose.svg`
- Diamond Heart: 50,000 virtual coins; `cp-diamond-heart.svg`
- Eternal Promise: 100,000 virtual coins; `cp-eternal-promise.svg`

All three were inserted idempotently into **sharika-staging only** with active=1; `sharika-production` has not been modified. The verified `GET /bonds/catalog` and the existing atomic coin/consent/idempotency gift actions stay unchanged. The UI uses each new SVG and falls back to the original Sura generic gift icon. All user identity and wallets remain untouched.

## New staged official-role frame assets
- `official-manager-royal-gold-v1.svg`
- `bd-admin-blue-diamond-v1.svg`
- `official-host-rose-gold-v1.svg`

All three are SVG animated, transparent-center, light-client variants. They are **not the photorealistic animated WebP master** reviewed in ChatGPT. That separate 24-frame, 640×640 WebP remains in the conversation output `Sharika_Official_Manager_Animated_Frame_Pack.zip` and is **not uploaded to GitHub or Cloudflare R2**. Do not claim the WebP master is deployed.

The three frame SKUs were inserted into the **staging** `sharika_cosmetics_catalog` with `active=0`. Local UI marks them official-only and does not offer purchase; backend admin grant and role verification must be completed before activation.

## QA/Release gate
- Run `node --check android-staging/staging-connection.js` and `node scripts/verify-manager-cp-assets.mjs`.
- Parse all SVGs as XML; check real-device Android WebView SVG SMIL loop, transparent center, text clipping, CP Gift Sheet asset loading, two-phone room audio, seat animation performance and reduced-motion behavior.
- The new SVGs use vector gradients and SMIL animations, while the accepted original WebP uses raster transparency. Validate the original WebP separately before replacing the fallback.
- No GitHub merge, APK build, Play Store release, Cloudflare Worker deploy, R2 upload, or production D1 mutation has been performed by this change.
- Do not apply a bulk staging migration on production or promote these catalog prices without production review.
