# Sharika Royal Invite — Design QA (staging)

Reference: owner-provided purple/gold Invite Friends and Newbie Bonus mobile screenshots, 1 November 2026.

Implementation: `android-staging/staging-connection.js` (verified live invite view),
`app/main-profile-bg.jpg` (owner royal brand art), and
`app/invite-royal-chest.webp` (new isolated gold-and-purple chest artwork).

## Visual evidence and comparison

- Opened the exact staged Invite renderer in a temporary local browser preview at a **393 px content viewport** with sample verified account data. The reference screenshot and rendered screenshot were reviewed for mobile hierarchy, contrast, art direction, buttons, and overflow.
- The royal purple background, gold framed content, gold buttons, and prominent chest illustration follow the reference's visual hierarchy. Art is original to Sharika rather than copying another app's poster text or currency totals.
- The dynamic reward tiles and verified invite code remain readable in three columns at 393 px. The panel's `scrollWidth` and `clientWidth` both measured **348 px**, so the rendered content did not horizontally overflow.
- The chest image decoded successfully (`naturalWidth > 0`). This preview uses the same styling and DOM-building functions as the native staging adapter, but is **not** a device-level or server-integrated test.

## Interaction QA

| Check | Result |
| --- | --- |
| Bank form on initial load | Hidden |
| Available USD $52.50 | Withdraw enabled |
| Click Withdraw | Shows bank transfer form with four labeled fields |
| Withdraw $50 | Enabled with this test balance |
| Withdraw $100 | Disabled with this test balance |
| Click Cancel | Form hidden again, trigger collapsed |
| JavaScript application errors | None observed; browser extension logged unrelated metadata errors |

## Remaining device checks

- Real Android APK install and tap testing, including game screen dimensions, profile photo downloads, offline/reconnect behavior, and keyboard interactions, require a fresh staging build and a physical device or Android emulator.
- Full finance payout and authentic referral rewards must be verified with staging accounts and finance review; the isolated visual preview intentionally uses dummy values and never submits money.

Design findings: no open P0, P1, or P2 issues in the responsive Invite preview. The reference's larger poster-scale chest is intentionally compacted into a scrollable app screen; this is a P3 stylistic difference.

**final result: passed** (Invite visual prototype only; Android end-to-end verification is separate).
