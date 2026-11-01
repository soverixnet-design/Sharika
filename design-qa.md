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
