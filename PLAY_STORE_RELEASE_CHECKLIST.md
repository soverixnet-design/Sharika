# Sharika — Play Store release gates (31 Oct 2026)

**Release status: BLOCKED.** All work in this branch is an isolated staging candidate. Do not merge to `main`, deploy to production, or submit a Play Store release based solely on passing unit tests.

## Completed in the candidate branch
- [x] Android staging config moved to `compileSdk 36` / `targetSdk 36`; Gradle and AGP moved to compatible versions.
- [x] Staging Android build job checks target API 36 in the generated APK.
- [x] Server-side automated checks for room/seat, seller stock, ordinary gifts, game settlement, banners, profile assets and authentication exist.
- [x] Original Sharika visual design kept; original three game HTML assets packaged in staging.
- [x] Staging-only billing/gaming flags remain disabled where required. The debug APK is **not** a Play release AAB.

## Owner acceptance: block public release until tested
- [ ] Two real Android phones, two independent signed-in accounts: join/leave other users' rooms; verify owner never changes on join.
- [ ] Voice: grant microphone permission; speak/hear in both directions; mute/unmute, seat switches, lock/unlock, minimized room and background recovery.
- [ ] Room chat: both accounts send/receive, no demo or bot messages; report/block enforcement.
- [ ] Profile: gallery avatar upload, edit/save/reopen; public profile and seat profile reflect updates.
- [ ] Room: upload cover photo and verify outside room card, name/flag/online count and permissions.
- [ ] Regular gift: sender balance decreases once; recipient diamonds and exactly 10% room-only reward are recorded once with the correct room ID, including retries.
- [ ] Lucky Gift remains disabled until explicit owner approval and Play payments/gaming compliance review; its reward formula differs from regular gifts.
- [ ] Seller: assign one seller role; credit seller stock from an approved admin, see seller ID in list, transfer to a second verified user ID, validate balances and immutable transfer history (including retries and failures).
- [ ] Diamond exchange: verify 100 diamonds -> 70 coins atomically; no double exchange; wallet and ledger reconcile before/after.
- [ ] Food Wheel, Night Food Wheel, Jackpot Fruit: valid low-balance bets accepted in the open phase; closed-round retries safe; server settlement reconciles balance; ranking only shows actual winners (0 to 3 unique users).
- [ ] Admin: sign in as real admin and test banner create/edit, room moderation, gift catalog, seller stock, coin ledger, rankings and permissions.
- [ ] No unauthenticated or demo user access in the production package.
- [ ] Check app performance/crashes and Firebase Google sign-in on real devices.

## Play policy/compliance gates
- [ ] Decide legal and Play-policy handling for virtual coins sold by operator/sellers. Evaluate Google Play Billing or an eligible exception/payment program before distribution.
- [ ] Review all paid-coin chance-based games, Lucky Gift and jackpot mechanics by target market; disabling them in public releases is safer until policy and local-law review is complete.
- [ ] Add/verify in-app account deletion AND an external request URL; implement the actual deletion workflow for user data.
- [ ] Publish accurate Privacy Policy and Terms; in-app links; clear consent for microphone/media and user-generated content rules.
- [ ] In-app report user/content and block user tools, moderation workflow; appropriate age screening and content-rating disclosures.
- [ ] Play Console Data Safety, App Access instructions, Permissions declaration, content rating, target audiences, pricing/monetization and government/regulatory declarations as applicable.
- [ ] Release signing/upload key held in secret storage; build production **release AAB** pointing only at audited production API, not `sharika-api-staging`.
- [ ] Run release build QA: install from Play internal track, Firebase login with Play signing SHA fingerprints, 64-bit/device support, app startup, payments, permissions and deep links.
- [ ] If Play Console uses a new personal developer account subject to the requirement: run closed testing with 12 continuously opted-in testers for at least 14 days, then request production access.

## Links
- Candidate PR: https://github.com/soverixnet-design/Sharika/pull/4
- Android target API requirement: https://support.google.com/googleplay/android-developer/answer/11926878
- Google Play Billing: https://support.google.com/googleplay/android-developer/answer/9858738
- Gambling and gaming: https://support.google.com/googleplay/android-developer/answer/9877032
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- UGC moderation: https://support.google.com/googleplay/android-developer/answer/9876937

**Never publish a debug or staging build as the final app.** Passing CI verifies source invariants and buildability, not actual multi-device or policy compliance.
