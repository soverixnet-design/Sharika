# Sharika visual design QA — 2026-11-08

final result: blocked

## Source and scope

- User-provided room screenshot: `/workspace/scratch/b004fe98cc10/upload/01-18623.png` (1080 × 2352).
- User-provided Royal Rewards screenshot: `/workspace/scratch/b004fe98cc10/upload/02-18622.png` (1080 × 2352).
- Implementation: `app/royal-room-ui.js`, `app/reference-room.css`, `app/room-chat-message.svg`, and `app/royal-ranking-v2.css`.
- Mobile preview source: `/workspace/scratch/b004fe98cc10/sharika-qa-preview/ranking-layout.html` (local, untracked QA copy; not production application code).

## Code-level checks

- Room header reorders the actual room profile control immediately after Exit; existing click handler is preserved.
- Room profile image grows from 49 px to 61 px; the card receives the remaining header width.
- Room chat scrolling surface and wrapper are transparent over the owner's wallpaper.
- Room Chat keeps its existing chat-composer click handler and uses a distinct conversation-bubble asset; Private DM retains its own original inbox control and envelope asset.
- Royal Rewards podium assigns rank 1 to the center grid column, rank 2 to the left, and rank 3 to the right. Winner names, IDs and totals have separate compact labels with overflow clipping.
- `cloudflare/test/room-chat-ranking-layout.test.mjs` checks stable source structure and bundling of the new icon.

## Visual verification blocker

The cloud browser could not connect to the local preview (`upstream connect error`).
Local headless Chromium also terminated before screenshot capture (`socket() failed: Operation not permitted`).
Therefore **no successful post-change device/browser screenshot exists**. Rendering on the Android WebView, small screens, long names and right-to-left locales still needs a real-device comparison before release.

## Remaining visual checks

1. On a 360–440 CSS px Android screen, verify enlarged left-aligned room header does not collide with Exit, collapse, or Settings.
2. Send a room message and open a private DM to verify their icons and behaviors differ and the wallpaper remains visible behind the message history.
3. Open Royal Rewards with 1, 2, and 3 weekly winners; inspect positions of photo frame, name, ID and coin total relative to each podium step.
