# Sharika Home — Option 2 visual QA

**Final result: passed (local design and interaction QA).**

Target: the owner's selected second champagne-gold / espresso home mockup in this conversation.
Viewport inspected: a narrow 440px Android-style app panel in the cloud browser at `http://terminal.local:4173/?qa=home`.
The query argument enables a **local-only QA fixture**; it is never packaged in the APK and does not bypass real account authentication.

## Verified

- Warm espresso-brown and flowing champagne-gold generated background is visible, with the existing Sharika logo and bottom navigation preserved.
- Header keeps the coin balance; Recharge is a compact top-right button and opens the existing Recharge panel.
- Three home shortcut cards contain generated 3D gift, gamepad and handshake artwork. Neither Sharika Shop nor My Backpack is injected into Home; their other entry points remain intact.
- Four functional tabs exist: Popular, New, My room and History.
- Room cards display the owner's country flag. In the test fixture the two Bangladesh rooms appear before the higher-popularity US room.
- History displays only the previously entered room from the local test fixture.
- Search field and room cards remain present, the cards fit the mobile two-column grid, and bottom navigation is unobstructed.
- No app-origin JavaScript console errors remained after guarding the legacy empty weekly-ranking data. Extension-origin browser metadata warnings are unrelated.
- Country sort/history unit tests: 4/4 passed. Existing Worker tests, including country join response: 45/45 passed.

## Deployment and non-visual checks

- Owner country data is now selected by the Worker from the room owner's persisted account country. This API change must be deployed to the relevant staging Worker before real cards can show all flags.
- History persists on the same device **per authenticated account** (last 40 unique visited rooms), only after a successful join; it is not yet synchronized across devices.
- The local QA fixture demonstrates layout and sorting, not a live authenticated account, voice session, or production room response.
- Android APK bundling is verified by the staging workflow's explicit asset checks after the source update is built.

## Remaining polish (P3)

- The golden background is more textured than the selected mockup in the lower corners; typography and hit targets remain legible.
- History's clock artwork was generated in the same icon atlas and can be used in a future expanded header; the current tab keeps a compact clock glyph to fit four tabs on narrow phones.

---

# Sharika Royal Room — uploaded phoenix theme and icon QA

**Final result: passed (local visual and interaction QA). Live voice/backend QA: blocked without authenticated staging devices.**

Target: the owner's uploaded purple/gold phoenix wallpaper and matching eight-icon sprite. The current room was inspected in the browser at `http://terminal.local:4173/?qa=room`. This local-only route extracts the real room HTML and loads the Android-packaged CSS/JS without signing in; it is not packaged into the APK.

## Verified locally

- The owner's exact supplied phoenix background fills the room, and provided 3D gold/purple art displays for top Settings and Games, composer Emoji, DM, Lucky Box, Gift, Menu and floating Mic.
- There are nine rendered seats: one owner throne, four seats on row 2 and four on row 3, with smaller guest avatars and visible labels.
- Games no longer has the previous blue demo-button background; it floats separately at the upper-right.
- The public chat is above the composer, with an Emoji button **inside** the input. A test message, `Hello Sharika 👋`, appeared in the chat after sending.
- Menu expands to Music, Audio, Effects, Theme, Seats, Settings, Owner tools, and Photo. Device music is correctly disclosed as local-only; it is not mislabeled as a room broadcast.
- Lucky Box opens the existing Lucky gift category, distinct from the regular Gift button and its standard category.
- Existing DOM IDs for DM, Mic, Gift and Games are retained so the real D1/LiveKit room bridge can wire its existing actions.
- Room owner seat-move rendering has been corrected at the data adapter: if the owner's verified public ID appears on a guest mic seat, seat 0 becomes a crown-only placeholder, never a second user identity.
- Ordinary joined-member events now get a 3.8-second name banner when no premium entrance animation is equipped.
- `node --check` passed for the modified room JS, Android staging bridge and local QA preview server; `git diff --check` passed before handoff.

## Integration still requiring a real staging run

- Live multi-device seat moves and same-ID deduplication, direct messages, LiveKit microphone, verified gift purchase and signed room-entry events require authenticated staging accounts and a running Worker; they cannot be proven by the isolated visual fixture.
- Music file selection plays locally only, and voice filters have explanatory status until an actual room audio broadcasting/processing service is enabled.
- No production deployment or Android device-build result is implied by this visual QA.

---

# Sharika pre-publication voice, seat-lock and mini-games integration (2026-11-03)

**Status: integration unit tests passed; real two-phone voice and complete Play Store release review still pending.**

- Started from the latest voice-reliability candidate (`2bf5681`) so TURN/ICE fallback, SFU publish-ready, RTP monitoring, microphone restart and mobile audio recovery are retained; merged the separate Royal Phoenix room assets and compact game overlay (`ddd1caf`). No live D1 data was changed.
- Fixed a real seat-lock UI bug: the old empty/locked-seat sheet invoked fake local actions. The verified room owner now gets live Lock/Unlock and Invite buttons; a guest can take an unlocked mic seat but cannot unlock a locked one. The backend still rejects locking a seat while occupied; owner should remove a guest from mic first.
- Preserved the single verified owner identity if the owner moves to another mic seat; the original owner throne becomes a decorative placeholder.
- Moved the in-room game sheet to the bottom of the viewport, with gesture-safe inset and a compact 74dvh / 620px maximum target. The active room remains underneath the game overlay.
- Targeted voice/SFU/ICE/seat/game tests: 49 passed. All Worker tests: 386 passed. JavaScript syntax and both staged/unstaged diff whitespace checks passed.
- Read-only Cloudflare check showed staging Worker binding names for `REALTIME_SFU_APP_ID`, `REALTIME_SFU_APP_SECRET`, `REALTIME_TURN_KEY_ID`, and `REALTIME_TURN_API_TOKEN`, and a recent Worker deployment. This **does not prove** TURN credential generation works, ICE completes, or audio moves between real devices.
- Final acceptance requires two signed-in Android devices on different networks, bidirectional voice with owner and guest switching seats, owner lock/unlock propagation, and all original games actually placing a bet and receiving a settled result. Do **not** publish to Play Store before these live-device checks pass.
