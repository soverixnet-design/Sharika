# Sharika Play Store readiness — 2026-11-03

This branch is an **isolated staging candidate**. It is **not production-ready** and must not be published to the Play Store as-is.

## Implemented in this candidate

- Full-screen Main Profile Settings Center with Safety, Privacy & Policies, Account & Support, and Voice & Notifications.
- Report a User sends a verified support message. This is a support request; it is **not** an instant global user block.
- Account deletion request sends an authenticated message to Customer Service. This is **not** an automated deletion and does not establish a public web deletion-request pathway.
- Privacy Policy and Terms reuse existing in-app policy content. The content has **not** been approved by the legal publisher.
- Manual country picker remains accessible; GPS is never requested.
- Voice checks are user-initiated, use Android microphone permission and stop all media tracks. Existing voice SFU/mic pipeline is unchanged.
- Native Android Back respects the Settings subpage stack.
- Android targetSdk 36, compileSdk 36, versionCode 4, and a signed **review-format** .aab workflow using the stable encrypted staging certificate.

## Store blockers — do not represent as completed

1. **Digital coin recharge and seller flows:** assess and implement Google Play Billing or a valid country/program exception before taking digital-coin payments in a Play-distributed app.
2. **Games and redemption:** Food Wheel, Night Food Wheel, Jackpot Fruit and Greedy Wheel have coin betting features. The app also describes commissions and withdrawals. Product/legal owner must assess Google's real-money gambling policy and applicable licensing for every distribution country, including whether coins are redeemable/cash-equivalent. It is unsafe to infer that virtual labels alone exempt the app.
3. **Account deletion:** publish a working, branded web URL for requesting deletion of the app account and associated data; define actual verification, deletion, permitted retention and processing workflow. Add this URL in Play Console.
4. **Privacy and Data Safety:** confirm developer's legal name, contact details, actual SDK/analytics/payment data flows, retention/deletion policy and age/child content scope. Host the approved Privacy Policy publicly and in-app.
5. **UGC moderation:** verify all public room/content and profile reports; ensure app-wide user/content blocking and staff moderation meet policy, beyond room-level kick/block and support tickets.
6. **Release infrastructure:** switch the Android app from `sharika-api-staging.soverixnet.workers.dev` to an appropriately secured production Worker/database; use a dedicated secure Play upload key (not this staging key), confirm Play App Signing and the correct package, increment versionCode above any already released build.
7. **Device QA:** two-way voice across Android devices/networks, call/audio routing, mute/leave/background, account creation and Google sign-in, frame/profile settings, moderator safety, payments and ledger, crashing/ANR, and all games. Three of the four games are still known by the owner to have problems and were **deliberately not modified** in this candidate.
8. **Play Console:** app title/description/icon/feature graphic/screenshots, content rating, age and sensitive-content declarations, data safety, ads, access instructions/test credentials, Play Integrity if needed and review. New personal developer accounts created after Nov 13 2023 may need 12 continuously opted-in testers for 14 days before production.

## Signing warning

The generated review .aab uses the **staging signing keystore** already stored as encrypted GitHub Secrets, solely to prove Gradle's release AAB pipeline. It is not a dedicated production Play upload key. The app still calls staging services. **Do not upload this artifact as a production release**.

## Relevant official Google documentation

- Target API level: https://support.google.com/googleplay/android-developer/answer/11926878
- App Bundle / signing: https://developer.android.com/studio/publish/upload-bundle and https://developer.android.com/studio/publish/app-signing
- Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Real-money gambling/gaming policy: https://support.google.com/googleplay/android-developer/answer/9877032
- User-generated content policy: https://support.google.com/googleplay/android-developer/answer/9876937
- Account deletion policy: https://support.google.com/googleplay/android-developer/answer/13327111
- App privacy / user data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Closed testing: https://support.google.com/googleplay/android-developer/answer/14151465
