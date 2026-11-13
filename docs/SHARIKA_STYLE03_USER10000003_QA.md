# Style 03 Royal Premium — User 10000003 staging fit preview

Status: **staging source candidate** only, based on `fix/sharika-room-entry-loading-20261113`.

Test target: public user ID **10000003**, who was verified as active in staging D1. No production user or other account is modified. The existing Golden VIP Entry entitlement is retained.

## What is implemented
- The profile appearance adds a transparent-cutout **draft** gold-ring preview outside the avatar only for signed-in test ID 10000003; no fake coins or rank.
- A test-only button opens a modal illustrating how the frame, entry, gift and medal should fit inside the Sharika mobile WebView. No room seat is falsely attributed by name to an unverified participant.
- CSS isolates the overlay from tappable profile-photo controls. A draft ring image uses transparency and a non-interactive overlay so the seat/avatar photo remains visible.
- R2 video URLs must be explicitly set in `app/royal-style03-test.js`; only same-origin staging media endpoints in canonical `/api/v1/media/<uuid>.mp4|webm` form are accepted.
- The video element includes inline playback, user-initiated controls and native audio handling; GIFs and CSS loops are **not labeled video**.

## Not yet completed
- The four original 5-second **MP4 with AAC sound** clips from the chat have **not been uploaded into Sharika staging R2**; this GitHub connector exposes text writes, not direct transfer of generated chat video binary. Do not leave a broken URL or claim they play inside the app.
- The draft ring SVG is **not** a finished 3D transparent alpha frame and should be replaced by a production-quality PNG/WebP.
- No existing user's equipped cosmetics are reassigned, no gift/catalog rows or wallet records are changed, and no app-store release is made.
- Stage the original MP4s via the existing authenticated Super Admin media uploader (`/api/v1/admin/media`), which validates content type/magic and stores in `sharika-staging-media`. Use the returned canonical `/api/v1/media/<uuid>.mp4` URLs and set them in the `MEDIA` object.
- Once the four media URLs exist, ship to isolated staging APK, sign with the existing stable staging key, and test on real Android device using ID 10000003.

## Acceptance checks for video assets
- VIP frames: static transparent artwork appears **outside** profile picture and mic seat without overlapping the photo; an MP4 with opaque background must never replace a transparent profile frame.
- Entry: 720×1280, ~5s, top-half of room; must not shake seats or swallow voice/mic events; playback only once per join.
- Gifts: 720×720, ~5s with sound, only one player on top of the room at a time; cleanup player on end or leave; original currency/gift API unchanged.
- Medal: thumb-sized transparent poster; video may play only in detailed preview, never perpetually loop on all room seats.
- Keep all other user IDs, production data and Google Play release untouched. No sound autoplay until a gesture is available; voice-room audio must continue when these animations are shown.
