# Sharika Admin Media Studio — staging rollout

Status: **code and local tests ready, remote upload blocked** (2026-11-05).

## What changed

- Super Admin can select image, video or audio files from the phone in the Gifts and Frames/Entry/Medals/Tags panels, preview locally and upload from the browser.
- Uploads are limited to **25 MiB** with MIME and file-header checks. Bytes go to the private R2 binding `MEDIA_BUCKET`; only opaque public media URLs are exposed.
- Gift and cosmetic catalog rows retain HTTPS image, animation/video and optional sound URLs. New gifts are created inactive for review. Catalog edits are audited and existing wallet/entitlement tables are untouched.
- Room gift receipts send media URLs from the verified gift catalog; room clients display uploaded gift videos and offer a sound button if autoplay is blocked. Equipped custom entry videos and image/audio assets are resolved from the catalog.
- Public GET/HEAD supports single-byte ranges so mobile video playback can seek.

## Blocker: Cloudflare R2 has not been enabled

The connected account `d81cf7c48fb9b36d468cb0a08720cd74` returned Cloudflare error `10042`: **Please enable R2 through the Cloudflare Dashboard** when listing buckets. Do not deploy this binding until R2 is enabled and a dedicated staging bucket has been created.

## Safe rollout checklist

1. Account owner enables **R2 Object Storage** in the Cloudflare Dashboard and confirms any billing prompts.
2. Create the dedicated **`sharika-staging-media`** R2 bucket in the same account. Do not turn on the public `r2.dev` domain; the authenticated API Worker is the upload and public read gateway.
3. Confirm `MEDIA_BUCKET` binding matches the bucket and that the `sharika-api-staging` Worker has access.
4. Back up staging D1, then apply the **additive** `0062_admin_media_assets.sql` migration to `sharika-staging`. It adds only media URL columns, no data deletions or wallet changes.
5. Deploy API Worker to staging only. Deploy admin frontend Worker with the updated `admin/connection.js`. Package the updated `android-staging/staging-connection.js` in a new staging Android build.
6. Sign in as verified Super Admin. Upload a small valid WebP and MP4 with embedded sound, plus optional MP3. Check the returned URL, `GET`, `HEAD` and `Range` requests.
7. Create a **disabled** test Luxury gift; use a non-financial internal test environment for any wallet-affecting sends. Equip an uploaded entry/frame on a test profile. Verify video, fallback audio button, restore/refresh, and that other room members see the effect.
8. Verify security with support/finance accounts (403 for upload), invalid MIME (415), bogus file signature (400), oversized upload (413). Verify media objects cannot expose Super Admin identity.
9. Only activate gifts and promote a release after the mobile playback and gift-ledger regression tests are verified on real devices.

## Autoplay limitation

Android WebView and browsers may prevent *unmuted* audio from playing without a gesture. Entry/gift presentation tries playback first; if audio is blocked, a visible sound button allows the viewer to start it. Uploaded videos must contain sound if the admin does not supply a separate audio file.

## Local verification

Run `node --test test/admin-media.test.mjs` and `npm run check` from `cloudflare/`. The unit tests exercise authorization, upload validation, opaque URLs, audit and HTTP range responses with a fake R2 binding. They do **not** prove the actual R2 bucket or Android device playback works.
