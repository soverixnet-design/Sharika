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
