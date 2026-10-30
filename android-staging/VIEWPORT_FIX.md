# Sharika Android staging: edge-to-edge viewport fix

Date: 2026-10-30

The original app/index.html has a 440px maximum width for the app shell.
On Android phones with a larger WebView CSS viewport, that creates black
side gutters. Some devices also reserve a black region above the WebView
for the camera cutout while immersive fullscreen is enabled.

The fix is limited to the isolated Android staging candidate:

- staging-connection.js injects `#sharika-android-viewport` CSS to remove the
  440px cap from the app shell in both the main document and voice-room iframe.
- The main document avoids top-level safe-area padding while retaining
  safe-area padding on top controls and the bottom navigation.
- SharikaActivity.java allows content behind the physical display cutout.
- No changes to the original design in `app/index.html`, Cloudflare staging
  API, authentication, RTC microphone/audio behavior, or production releases.

Physical-device regression checklist:

1. Open Home, Rank, Messages, and Profile. App background should reach both
   screen edges, with no black side gutters.
2. Check top buttons are not obscured by a camera punch-hole / notch.
3. Enter and leave a room; seat grid should fill the usable app width.
4. Join a microphone seat and confirm two-way audio still works.
5. Open the keyboard and confirm input fields remain accessible.
6. Rotate only if the device supports landscape; verify no content clipping.

This change requires a newly built and installed staging APK; existing APKs
cannot receive bundled CSS or Android Activity changes remotely.
