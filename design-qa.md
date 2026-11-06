# SHARIKA Royal Premium Clean — design QA

- Source visual truth: `/workspace/scratch/fd0771fcf57d/Sharika-Royal-Clean-1.png` (first displayed generated design, selected by user)
- Implementation: `app/index.html`, `app/royal-clean.css`, `app/royal-clean-icons.png`, `app/royal-room-ui.css`
- Implementation screenshot: **unavailable** — cloud browser could not reach `http://terminal.local:4173/?qa=home` (upstream connection reset before headers)
- Target: mobile WebView, 390 × 844 CSS pixels; board contains four adjacent screens
- Source board pixels: 1717 × 916; individual conceptual panels are approximately one quarter of its width
- Implementation pixels/density: unavailable; no normalization or direct comparison possible
- State required: Home (Popular), Voice Room (9 seats), My Profile, Menu; verified signed-in state not available in the visual preview
- Full-view comparison: **blocked**, source opened but implementation was not captured
- Focused comparisons (typography, spacing, colors, images, copy): **blocked** by the same screenshot failure
- Console errors: not checked; the browser page displayed a preview-proxy connection error before loading app content
- Primary interactions: source routing verified statically; not click-tested in a browser or on Android

## Evidence and findings

- [P0 / verification blocker] The local preview service reported running, but the cloud browser displayed an upstream connection reset. Cannot establish layout fidelity, menu navigation, room spacing or accessibility.
- [P1 / pending] Recheck the Android packaged stylesheet order against late staging scripts and the final branded CSS. The local source checks only verify inclusion, not final cascade behavior.
- [P1 / pending] Verify Shop, Backpack, Games, BD Agency and Host Center links with a real signed-in staging user. Routes reuse existing functions, but session/role states were not live-tested.
- [P2 / intentional] Existing bottom navigation and user-generated room themes remain untouched to preserve functionality. The four-screen concept includes a different nav arrangement and dark room wallpaper; an exact visual match is not yet claimed.
- [P2 / intentional] Banners remain admin-managed, so the static illustration from the concept is not hard-coded over a user's live banner.

## Static checks completed

- `git diff --check`: passed
- `node --test android-staging/banner-display.test.cjs`: 3/3 passed
- JavaScript inline compilation via `vm.Script`: passed
- Room and staging bridge syntax checks: passed
- New CSS and icon asset present in Android Gradle packaging list: passed
- Android APK build: unavailable (Gradle wrapper/CLI not installed in this environment)

## Follow-up checklist

1. Restore accessible browser preview and capture 390 × 844 Home, Room, Profile and Menu.
2. Compare source board and actual screenshots in the same view; fix all P0–P2 design differences.
3. Tap-test menu actions; check slow and small-screen Android devices, including keyboard/IME and accessibility focus.
4. Build signed staging APK in CI; run two-account voice, game, recharge, ID, and agency regression tests before release.

**final result: blocked**
