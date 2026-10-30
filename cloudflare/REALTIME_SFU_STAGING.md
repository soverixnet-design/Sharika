## Deployment checkpoint — 30 October 2026

- Dedicated SFU application `sharika-staging-audio` created in the selected
  Cloudflare account; App ID `12e774e74598f9095403d08971423d2d`.
- Both `REALTIME_SFU_APP_ID` and `REALTIME_SFU_APP_SECRET` saved as
  **secret_text** bindings on `sharika-api-staging`. No secret value is
  committed, returned to Android, or stored in this document.
- Worker published with `VOICE_ROOMS` SQLite-backed Durable Object and
  the existing isolated D1 database `sharika-staging`.
- Automated Cloudflare syntax/unit checks passed; same-source Android staging
  APK was built and signed successfully. Physical two-device voice has **not**
  yet been confirmed.
- Existing DigitalOcean/other app deployments were not changed.

# Sharika staging — Cloudflare Realtime SFU audio

This changes only the isolated `feature/sharika-android-staging-20261030`
Android test adapter and `sharika-api-staging` Cloudflare Worker.
The original `app/index.html` art/layout is unchanged, and no
DigitalOcean/Ayra/other application's server or data is migrated.

## Voice flow

1. Native Android bridge obtains and refreshes Firebase ID tokens.
2. Worker verifies the Firebase user and checks D1 room membership and
   microphone-seat/owner authorization.
3. The Worker alone holds the Cloudflare SFU App ID and Secret.
4. A browser WebRTC publisher publishes **microphone audio only**;
   one SQLite-backed Durable Object per room advertises active tracks.
5. Each listener creates a separate subscription session, receives the
   SFU offer, answers it, and subscribes only to tracks in their room.
6. The app refreshes discovery/heartbeats every eight seconds; leaving
   closes local media and removes room-discovery entries.

D1 is still the authority for room membership, ownership and seats.
No client-controlled admin permission, gift, wallet or game side effects.

## Safe staging setup

Create a dedicated Realtime SFU application in **this same account**,
named `sharika-staging-audio`. Put its credentials in the *staging
Worker*, never in Android, GitHub, screenshots or a public chat:

```sh
cd cloudflare
npx wrangler secret put REALTIME_SFU_APP_ID --config wrangler.jsonc
npx wrangler secret put REALTIME_SFU_APP_SECRET --config wrangler.jsonc
```

The `VOICE_ROOMS` Durable Object uses the SQLite storage backend and
the binding/migration declared in `wrangler.jsonc`. Deploy only after
`npm run check` passes and the provider's usage/billing has been
reviewed. A push does *not* deploy automatically.

```sh
cd cloudflare
npm run check
npx wrangler deploy --config wrangler.jsonc
```

Cloudflare SFU credentials are required. The client uses an isolated
LiveKit fallback only when the Worker explicitly reports it configured.
Missing voice credentials return a clear `voice_not_configured` error.

## Testing needed before claiming working voice

- Run `npm run check` and build a staging APK signed with the existing
  staging certificate.
- Sign in with two **different, verified Firebase** users on two phones.
- Join the same room; put one user on a free mic seat.
- Grant `RECORD_AUDIO`; verify each voice track arrives, is audible,
  can mute/unmute and stops after the publisher leaves.
- Repeat when room owner leaves and when joining without a seat.
- Verify the audio still plays after screen transitions. Background
  service and reconnection after internet handoff are **not implemented**
  yet. Android WebView audio playback needs on-device checks.
- Check CF dashboard usage and alerts before inviting many real users.

This is a staging integration candidate, **not a claim that a two-phone
voice call or public release has already passed**.
