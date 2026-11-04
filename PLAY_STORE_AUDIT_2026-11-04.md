# Sharika — Play Store pre-launch audit (2026-11-04)

> **RELEASE GATE: BLOCKED.** This is a read-only audit of live **staging** plus targeted source/test changes. It does **not** authorize production deployment, enabling cash-related features, or publishing a staging APK/AAB to Google Play.

## Verified source and packaging

- Android application ID: `com.soverixnet.sharika`; `compileSdk 36` and `targetSdk 36`; `versionCode 4`.
- Current Android build references the **staging** API and signs with the **staging** key (or a debug key). This must **not** be the Play production upload key.
- A signed AAB review workflow exists (`sharika-settings-play-review-aab.yml`), but its trigger targets a different feature branch and it explicitly labels the output review-only.
- The latest Cloudflare D1 test workflow passed after adding Family commission explanation and room moderator peer-protection regressions. Android packaging/emulator QA is performed separately; CI cannot prove that live two-party voice, Google OAuth, or coin settlement works on physical phones.
- Android manifest has no cleartext traffic, disables backups, and exports only the launcher Activity; these facts alone do not constitute a security certification.

## Live staging snapshot (read-only queries, 2026-11-04 UTC)

| Area | Observation | Release implication |
| --- | --- | --- |
| Worker configuration | Both `sharika-api-staging` and `sharika-admin-staging` have recent deployments; D1, VOICE_ROOMS, SFU, TURN, Firebase, and rate-limit bindings are configured. | Confirms bindings/deployment only, not two-device audio or authorization. |
| Cloudflare observability | Issue summary reports zero active issues. | Coverage/telemetry may be incomplete; zero is not evidence of no bugs. |
| Room admin | 1 room-admin grant. Verified Worker checks forbid a Room Admin from moderating the Owner or another Admin. | Added regression coverage for kick, block, mute, unmute and remove from seat. |
| Family | 1 active Family with 1 member. Policy active; owner_bps=1000 (10%), bd_bps=500 (5%); conversion_enabled=1. | Verify intended rates, conversion, and Play-policy treatment before public launch. |
| Family rewards | 7 ordinary gifts after joining, 0 eligible non-owner gifts, 0 Crystal-commission records. | Owner's own gifts advance the Family diamond target, but do not earn Owner commission. Updated Dashboard messaging to explain. Do not create retroactive wallet entries. |
| Events | 1 `gift_race` event remains Draft; scheduled Nov 1–2 and already expired; prizes of 10k, 5k, 2.5k coins. | Must reschedule/review before publication; do not auto-enable expired prizes. |
| Game catalog | Enabled: food-wheel, greedy-wheel, night-food, sovera-food. Disabled: fruit-royale, jackpot-fruit. | User-visible games correctly follow server flags; no automatic enabling of disabled betting games. |
| Admin Panel | `https://admin.sharika.app/admin/` loads a Firebase/email/Google sign-in page publicly. | Privileged post-login operations cannot be certified without an assigned admin account and controlled QA. |

## Main Google Play policy blockers

1. **Monetization:** determine whether digital coin recharge, seller wallets and purchased virtual items require Google Play Billing (or an applicable approved alternative program). Do not redirect Play users to an unapproved seller payment method.
2. **Chance-based bets and cash-equivalent rewards:** a Play/legal review is required for paid-coin betting, randomized prizes, Crystal-to-seller conversion and any USD withdrawal. Do not assume that renaming money as coins makes it exempt. Restrict by applicable jurisdiction and age if lawful.
3. **Privacy and account deletion:** create an approved public Privacy Policy, an in-app account deletion flow, a public deletion-request URL, identity verification, retention/deletion processing and accurate Play Console Data Safety declarations.
4. **UGC safety:** prove report and block for users/content, staff review/escalation, moderation against abusive room/chat content, and privacy/age handling. A support ticket alone is not equivalent to an immediate user block.
5. **Production backend/signing:** provision and test audited production Workers/D1 and dedicated Play upload signing, enroll in Play App Signing, check release versionCode and Google/Firebase OAuth SHA fingerprints. Never reuse staging services/data as a production environment.
6. **Device acceptance:** run two physical Android devices and different networks; verify 2-way SFU speech, mic permissions, mute/seat/admin/kick, profile avatars/frames, room chats, Google/email login, Family membership/commission, admin workflows, every advertised game's true bet-settle-refund ledger, and no crash/ANR.
7. **Play Console:** AAB, metadata, screenshots, feature graphics, content rating, app access test account, privacy, ads, permissions, audience and compliance forms; satisfy closed test prerequisites if they apply to this developer account.

## QA matrix / evidence needed

| Test | Expected result | Current verification |
| --- | --- | --- |
| Google Login, email Login, account recovery | Two independent accounts authenticate and recover | Real-device QA pending |
| Room audio | Phone A hears B and B hears A on mobile data and Wi-Fi | Real-device QA pending |
| Room Admin moderation | Admin cannot kick/block/mute/unmute/remove another Admin or Owner | Source + unit tests verified; two-phone UI QA pending |
| Member chat and safety | Room messages arrive once, reports/blocks are enforced | Unit tests; live QA pending |
| Game bets | Single debit, valid open-round acceptance, idempotent refund/settlement | Unit tests; real-money-like flow withheld until policy QA |
| Family commission | Eligible other-member gift generates correct 10% Owner/5% BD Crystal ledger | SQL/source verified; no eligible live sample in staging |
| Admin Panel | Owner login can inspect, publish and revoke with role limits | Login UI loads; authenticated QA pending |
| Events | Valid future schedule and approved awards only | Current lone draft expired; not published |
| Play release | Release AAB with production origin/key, clean Play review | Blocked |

## Verified primary policy sources

- Google Play target API level: https://support.google.com/googleplay/android-developer/answer/11926878
- App Bundle format: https://support.google.com/googleplay/android-developer/answer/9844279
- Google Play payments: https://support.google.com/googleplay/android-developer/answer/9858738
- Real-money gambling, games and contests: https://support.google.com/googleplay/android-developer/answer/9877032
- User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- App testing: https://support.google.com/googleplay/android-developer/answer/14151465

**Do not mark Play-ready solely because CI is green.** Maintain separation between staging, internal QA and any public release.
