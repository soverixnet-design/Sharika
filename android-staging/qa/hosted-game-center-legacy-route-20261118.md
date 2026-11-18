# Sharika hosted Games route QA — 18 November 2026

- Base: PR #146, merged staging commit `338775fb4bbd5aa97f09cd98f0c0057b3f359f79`.
- Android debug/staging Games taps open `openHostedGameCenter` immediately.
- In-room: native `SharikaRoomGameDialog` keeps the voice room alive and loads the Cloudflare game website.
- Outside room: native `SharikaGameCenterActivity` loads the same hosted website.
- Old two-column local games catalog is Play-only and requires verified `clientMode` and explicit Android hosted-route rejection.
- Keep original game art, verified profile, game balances and virtual-coins server unchanged.
- Run all staging build checks and verify signer before distributing an APK.
