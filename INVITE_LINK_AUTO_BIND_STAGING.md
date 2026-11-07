# Sharika automatic invitation links — staging QA (2026-11-04)

A sender's invitation link is `https://sharika-api-staging.soverixnet.workers.dev/invite/10000001` (replace ID with the sender's actual eight-digit public ID). The Invite page now offers Copy Link and Share.

## Expected sequence

1. Friend opens the HTTPS invitation; public Cloudflare landing has **Open Sharika App** and **Install with Google Play**.
2. If installed, opening Sharika captures the eight-digit ID in native Android shared preferences. The signup UI pre-populates it.
3. If installed from **Google Play**, the Play URL supplies `referrer=sharika_invite%3D<ID>`, and the Android Install Referrer library captures it on first startup **before** a new profile is registered.
4. A successful new /me registration atomically stores the referral and verified 100,000/100,000 wallet bonuses in D1 under the existing anti-fraud rules.
5. If a test APK was **sideloaded**, browser-to-APK install attribution is not available through Google Play. The friend must open the same invite link again before signing up; the native Open App button captures it without manually entering a code.
6. Existing new profiles within the configured claim window can reopen the link; the app attempts server-verified redemption silently.

## Safety

The landing GET is public and read-only and cannot grant rewards. Existing server rules still reject duplicate/self/inactive/expired/device-ineligible referrals. A Play signing `assetlinks.json` file must be published on the eventual production invite domain; the staging Worker hostname is **not** yet a verified Android App Link. Google Play package listing isn't yet live. The Play button will not install until publication.

## QA acceptance

- Open shared link on Android with app installed, tap Open Sharika App, create new email or Google account, verify referral in Invite history and both ledgers.
- Open link before Google Play installation, install through Play, create account; verify Install Referrer automatically applied.
- For sideloaded APK, tap same link again after installation then create account; no manual input.
- Duplicate, self, expired and multi-account same-device attempts must never grant a second reward.
- Switching from one link to another before signup uses the most recent explicitly tapped link.
- Ensure all regular login and voice operations remain unaffected. This is **staging** only.
