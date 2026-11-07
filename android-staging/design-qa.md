# Sharika Royal BD / Agency / Host Center Design QA

**final result: blocked**

Source visual: user-supplied BD screenshot `18327.png` (1080 × 2340), showing the purple BD header, member card, two service tiles and My Income. Agency and Host screens follow the user's stated role, salary and 5M target policy; separate source screenshots for those two pages were not supplied.

Implemented candidate: `agency-centers.js` and `agency-centers.css`, packaged through `app/build.gradle` into the isolated Android staging shell.

## Blockers

- P1 · Visual verification: The cloud browser could not load `http://terminal.local:4173/` (upstream connection termination), despite starting the required preview service. Local headless Chromium also could not create its sandbox socket. No rendered implementation image was captured, so the required screenshot-to-render comparison cannot be completed.
- P1 · Server integration: No dedicated BD → Agency → Host salary/commission and role-management endpoints exist in the current staging Worker. The UI therefore shows an explicitly unverified balance (dash) and disables salary exchange. There is no permission to claim production income, payout or role assignment is working.
- P2 · Fidelity: The new screens reuse existing Sharika Royal gold/purple artwork rather than the screenshot's exact neon-blue swirling background. This deliberate theme alignment must be visually reviewed with the owner.

## Evidence and non-visual checks

- Screenshot inspected: `/workspace/scratch/dc90149eb031/upload/02-18327.png`.
- All five staging UI assertions pass with `node --test android-staging/tests/agency-centers.test.cjs`.
- JavaScript parses with `node --check`; `git diff --check` passes.
- Back-stack navigation is integrated with `back-navigation.js`.
- No financial mutation is performed in the new UI.

## Required fidelity surfaces (awaiting rendered capture)

1. Fonts/typography: compare member name, `BD` badge, Income heading and captions after a same-size capture.
2. Spacing/layout: compare top bar, profile tile, service grid, card heights and income row at the mobile viewport.
3. Colors/tokens: compare purple card surfaces, gold accents, borders and selected period control.
4. Image quality: inspect existing 3D icon atlas and winged background cropping on an Android device.
5. Copy/content: screenshot shows BD Services, Invite Agent, Team member and My income; new screens add role-specific Salary Wallet, Host targets and assistants as requested.

## Next verification steps

- Build and open a staging APK on an Android device or resolve browser preview access.
- Capture BD, Agency, Host, Salary Wallet and nested team pages at the same screen density as the reference.
- Compare crops, correct material mismatches and re-run the design gate.
- Wire server-authoritative workforce ledger/permissions before enabling exchange and invitations.
