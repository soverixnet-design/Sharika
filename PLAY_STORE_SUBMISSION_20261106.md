# Sharika Google Play submission pack — 6 November 2026

## Status: PRODUCTION SUBMISSION BLOCKED

The repository's current AAB is an **isolated staging QA build**, signed with
the staging certificate and connected to `sharika-api-staging`. Do not upload it
as a production release. CI passing is not two-device voice acceptance.

## Store details (ready to copy after acceptance)

- App type: **App** (the core product is group voice chat, not a game).
- Category: **Social**.
- Name: **Sharika – Voice Rooms** (within Google's 30-character cap).
- Default language: **English**; add a Bengali translation if desired.
- Pricing: **Free download**. No unapproved external digital coin sales.
- Ads: **Declare accurately from the actual release**; do not guess.
- Tags: Choose relevant available tags in Play Console; prioritize social
  networking, voice chat and communication rather than wagering keywords.
- Package: `com.soverixnet.sharika` (must match the existing Play app if any).

### Short description (English, under 80 characters)

Join live voice rooms, meet friends, chat and share virtual gifts.

### Full description (English, under 4,000 characters)

Sharika is a social voice community where you can join live group rooms,
meet people and stay connected through conversation.

Explore rooms, talk with other members using your microphone and send chat
messages while spending time with friends. Create your own room and invite
others to join the conversation.

Customize your profile with a photo, decorative frames and badges. Enjoy
virtual gifts and discover community activities inside the app. Room owners
can manage their room settings, and members can report inappropriate behavior.

Sharika uses an account to keep your profile and activity connected across
sessions. Some optional virtual items and activities may require in-app coins.
Availability depends on your account and the app's current settings.

Please use Sharika respectfully. Do not share private information or harass
other members. You can use the in-app support and reporting options if you
have a concern.

### বাংলা সংক্ষিপ্ত বিবরণ (ঐচ্ছিক লোকালাইজেশন)

লাইভ ভয়েস রুমে বন্ধুদের সঙ্গে কথা বলুন, চ্যাট করুন ও ভার্চুয়াল গিফট পাঠান।

### বাংলা পূর্ণ বিবরণ (ঐচ্ছিক লোকালাইজেশন)

Sharika একটি সামাজিক ভয়েস কমিউনিটি। এখানে আপনি লাইভ গ্রুপ ভয়েস রুমে
যোগ দিতে, নতুন বন্ধুদের সঙ্গে পরিচিত হতে এবং কথোপকথনে অংশ নিতে পারেন।

বিভিন্ন রুম ঘুরে দেখুন, মাইক্রোফোন দিয়ে কথা বলুন এবং চ্যাটে মেসেজ পাঠান।
নিজের রুম তৈরি করে বন্ধুদের আমন্ত্রণ জানান। প্রোফাইল ছবি, ফ্রেম ও ব্যাজ দিয়ে
নিজের পরিচয় সাজাতে পারবেন। অ্যাপে ভার্চুয়াল গিফট ও কমিউনিটি কার্যক্রমও আছে।

রুমের নিয়ম মেনে চলুন। কোনো সমস্যা হলে অ্যাপের রিপোর্ট ও সাপোর্ট ব্যবহার করুন।
কিছু ঐচ্ছিক ভার্চুয়াল আইটেম বা কার্যক্রমের জন্য অ্যাপের কয়েন প্রয়োজন হতে পারে।

## Play Console owner checklist

1. **Production services and signing**: separately provision and test a
   production Worker/D1, voice SFU secrets, Firebase auth and upload key;
   preserve staging data and historical ledgers. Enroll in Play App Signing.
   Confirm unique, increased `versionCode` against any existing uploads.
2. **Financial / games policy**: resolve digital-coin billing under Play's
   Payments policy. Review virtual-stake games, seller/host commission and
   withdrawals against gambling/contest policy per release country. Do not
   expose real-world cashable wagers or payment bypasses in an unapproved app.
   Currently Play Billing fulfillment is not enabled in this staging build.
3. **Safety**: fully implement and verify app-wide reports, moderation, user
   blocking, account deletion request fulfillment, and accessible community rules.
4. **Privacy**: publish a reviewed HTTPS privacy policy and a working public
   account deletion request URL. Confirm actual SDK data flows and retention
   before filling Data safety; microphone, account IDs, avatar, messages,
   country, notification token and virtual wallet history need review.
5. **Metadata**: provide a 512×512 app icon, 1024×500 feature graphic,
   real in-app screenshots, support email, developer identity, content-rating
   questionnaire, target audience and app-access instructions for Google reviewers.
6. **Real-device acceptance**: test Google/Gmail login, 2-way voice on two
   separate devices and networks, mic permission/mute and speaker routing,
   leave/rejoin, slow-network loading, rooms/gifts/games/wallet and the Admin
   Panel. Resolve crashes/ANRs and financial inaccuracies before approval.
7. **Play testing**: if this is a personal developer account created after
   13 November 2023, complete closed testing with at least 12 opted-in
   testers continuously for 14 days, then request production access.
8. **Submission**: create/select app in Play Console, complete Store listing,
   App content and Store settings, upload the **production** AAB to Internal
   testing, inspect pre-launch reports, advance to Closed and then Production
   only when the gates above have passed.

## Official references (verify again at release)

- Store listing limits: https://support.google.com/googleplay/android-developer/answer/9859152
- Category/tags: https://support.google.com/googleplay/android-developer/answer/9859673
- Graphics: https://support.google.com/googleplay/android-developer/answer/9866151
- Target API: https://support.google.com/googleplay/android-developer/answer/11926878
- Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- Gambling/contests: https://support.google.com/googleplay/android-developer/answer/9877032
- UGC moderation: https://support.google.com/googleplay/android-developer/answer/9876937
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Closed testing: https://support.google.com/googleplay/android-developer/answer/14151465
