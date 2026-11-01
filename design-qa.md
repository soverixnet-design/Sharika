# Sharika golden homepage — design QA

## Reference and scope

- Supplied golden palace illustration is used unchanged (`app/golden-home-background.jpg`); local SHA-256 matched the original upload.
- Existing Sharika homepage layout is preserved: branded header, balance, search, promotion, quick actions, room tabs/cards, and bottom navigation.
- New visual treatment is limited to the Home view; Rank, Messages, and Profile keep their earlier background.

## Preview validation

- **Pass:** Local mobile-width browser preview loaded `golden-home.css` and the JPEG asset successfully.
- **Pass:** Golden illustration remained visible around transparent, readable dark-glass controls, with promotional cards and navigation layered above it.
- **Pass:** On navigating to Rank, the `golden-home` class was removed and the previous background restored.
- **Pass:** Existing quick-action and bottom-navigation elements are present in the accessibility tree.
- **Pass:** `git diff --check` reported no whitespace issues.

## Environment limitations

- Production login prevents unauthenticated access to the normal home screen. Visual inspection used a temporary, local-only test harness to display the existing home markup; this harness is not part of the deliverable.
- Room cards depend on authenticated backend data, so the preview showed the genuine empty-room state; no fake room data was added.
- Android staging copy task includes both new image and CSS. Full APK build and authenticated end-to-end flows still require CI/device verification.
