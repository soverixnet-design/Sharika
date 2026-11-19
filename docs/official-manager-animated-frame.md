# Sharika Official Manager animated frame (staging candidate)

This branch adds a standalone, fail-closed WebView renderer for Official Manager, with separate photo, transparent animated-art and dynamic name layers. It is **not active in the app** until the real animated assets and authenticated profile integration are installed.

## Artifacts
The complete independently verified frame pack was generated on 2026-11-19 and is available as a conversation attachment: `Sharika_Official_Manager_Animated_Frame_Pack.zip`.
The assets are not yet committed to this repository:
- `official-manager-animated.webp`: 640×640, 24 frames, endless transparent animation (~3.8 MB).
- `official-manager-static.webp`: 640×640 transparent fallback.
- `official-manager-master.png`: editable transparent source.
- `official-manager-preview.gif`: preview only, contains sample avatar backdrop.

## Integration
1. Upload animated and static WebPs to Cloudflare R2 or copy into `android-staging/app/src/main/assets/sharika-premium/official-manager/` and ensure build tooling packages them.
2. Load `app/official-manager-frame.css` and `app/official-manager-frame.js` into the actual WebView build.
3. On authenticated backend profile load, map the **server-validated** role to `serverVerifiedRole`. Never use locally selected user text or the existing `A.frameImg` store to grant official badges.
4. Call `SharikaOfficialManagerFrame.render(el,{serverVerifiedRole:'official_manager',photoUrl:account.photo,displayName:account.name,mode:'profile',assetBase:assetUrlBase})`. Voice seats use mode `seat`; previews use mode `shop`.
5. Refresh on role/account change and remove badge when role is revoked.
6. Verify Android WebView animation, transparency, AVIF/WEBP support, mixed room load and microphone audio performance on real device.

## Legacy issue
In `app/index.html`, `myFrameFile` downsizes uploads to a maximum 320px canvas and writes a static PNG data URL. It flattens animation and reduces frame quality. The official animated frame must bypass that path. The existing `.fxr.fxi` CSS background renderer is also not appropriate for high-fidelity independent wing animation.

## QA gate
Do not deploy or publish until the assets, server-authorized role routing, room-seat positioning, reduced-motion fallback, app build and real-device checks are complete.
