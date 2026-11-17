# Approved Sharika game-card icons (staging)

These assets are bundled locally into the Android WebView through `android-staging/app/build.gradle`; no remote image URL is required at runtime.

| Game catalog ID | Display name | Packaged asset |
| --- | --- | --- |
| `food-deluxe` | Food Wheel Deluxe | `fruit-machine.webp` |
| `greedy-classic` | Greedy Game | `greedy-game.webp` |
| `cleopatra` | Cleopatra's Gold Deluxe | `cleopatra.webp` |

The English game titles, HTML games, API IDs, wallets, and round logic are unchanged. The images are approved 512×512 WebP derivatives of the three supplied high-resolution icons. Files live in `android-staging/game-icons/` and are copied into the Android asset root by the existing `prepareSharikaUiAssets` task. No production or Play Store deployment is part of this change.
