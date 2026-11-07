# Sharika Admin Media Studio — staging rollout

Status (2026-11-05): **staging API and Admin frontend deployed**; real Super Admin upload and Android playback validation remain pending.

## What changed

- Super Admin can select image, video or audio files from the phone in the Gifts and Frames/Entry/Medals/Tags panels, preview locally and upload from the browser.
- Uploads are limited to **25 MiB** with MIME and file-header checks. Bytes go to the private R2 binding `MEDIA_BUCKET`; only opaque public media URLs are exposed.
- Gift and cosmetic catalog rows retain HTTPS image, animation/video and optional sound URLs. New gifts are created inactive for review. Catalog edits are audited and existing wallet/entitlement tables are untouched.
- Room gift receipts send media URLs from the verified gift catalog; room clients display uploaded gift videos and offer a sound button if autoplay is blocked. Equipped custom entry videos and image/audio assets are resolved from the catalog.
- Public GET/HEAD supports single-byte ranges so mobile video playback can seek.

## Verified staging rollout

- R2 was enabled and the private APAC `sharika-staging-media` bucket was created. No public R2 domain was enabled.
- Staging D1 migration `0062_admin_media_assets.sql` was applied with additive columns. Post-migration counts: **24 gifts** and **133 cosmetic catalog items**; migration journal shows one application. A D1 Time Travel bookmark was obtained before the update.
- Staging API and separate Admin frontend were deployed via the guarded GitHub Actions workflow, run **#73**, commit `2a5a8ca3748e6a8c42d3b3bfb7af86dfd31658e1`; the run concluded **success**. Worker settings confirmed the `MEDIA_BUCKET` R2 binding and all prior voice/auth secrets remained present.
- API `GET /health` returned `ok: true`, `environment: staging`, and `auth_configured: true`. Local Worker dry-run and all **528** backend tests passed.
- The two previously supplied Luxury gift media files, `18309.mp4` and `18302.mp4`, were recovered. Both contain H.264 video with AAC audio, but **have not been uploaded to R2 or assigned to active catalog gifts**. Do not claim these gifts are live.

Remaining: sign in as verified Super Admin, upload the supplied videos via Media Studio, create two 1,000,000-coin Luxury gift entries (inactive for inspection), then test media playback and ledger behavior on real devices before enabling them and distributing a new APK.

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
