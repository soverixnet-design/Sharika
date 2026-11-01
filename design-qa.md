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
---

# Sharika golden Home and royal My Profile — design QA

## Reference and scope

- The previously supplied golden palace image remains the Home-only background (`app/golden-home-background.jpg`).
- The user's supplied purple-and-gold winged-crown image is the **exact** background of My Profile (`app/royal-profile-background.jpg`), not a lookalike or a new generation.
- Profile hierarchy follows the approved screenshot: dark header; winged avatar with crown and membership label; nickname and copyable ID; sent/received levels; gold Edit Profile button; three stats; gold-bordered wallet with actual account balances; four ornate collection cards; six full-width account/features rows; fixed bottom navigation.
- A separate unwanted **"Recharge my ID · Seller stock"** button was removed from the main profile. Coin Seller access inside the genuine wallet/recharge flow is preserved.
- The four collection icons, six menu icons, and avatar crown are optimized WebP assets. No demo follower, coin, diamond, or visitor balances were inserted.

## Mobile browser validation

- **Pass:** The profile wallpaper and crown render, and section layout and buttons visually align with the reference at 440 CSS pixels.
- **Pass:** Optimized WebP assets render correctly after a reload; collection and account icons occupy the intended positions.
- **Pass:** The accessibility tree contains the expected profile controls and does **not** contain the seller-stock promo button.
- **Pass:** Profile Wallet opens the existing recharge wallet sheet; Settings opens the existing settings sheet.
- **Pass:** The lower account-and-features rows are reachable by scrolling; bottom navigation remains visible.
- **Pass:** Switching to Home restores the golden wallpaper without retaining royal-profile styling.
- **Pass:** The original app data drives wallet balances, IDs, ranks, stats, and verified premium state. Verified seller functionality is retained outside the profile.
- **Pass:** Android staging's asset-copy task includes both CSS files, both supplied backgrounds, and all three optimized profile WebPs.

## Limitations / follow-up

- Production authentication gates remain. Visual inspection used a temporary local same-origin harness for the underlying application page; it was removed before delivery. No authentication bypass is shipped.
- Live account balances, premium entitlement, device back button, and backend-connected CP details need a signed-in test account on the built APK. The preview showed native guest values rather than invented balances.
- Device smoke testing and distribution are separate from browser design QA.

final result: passed
