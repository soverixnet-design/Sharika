# Sharika নিরাপত্তা অডিট — Staging, ৩ নভেম্বর ২০২৬

**প্রকল্প:** `soverixnet-design/Sharika` · Android `com.soverixnet.sharika` · Cloudflare Worker/D1 staging  
**অডিটের ধরন:** সোর্স-কোড ও কনফিগারেশনের প্রতিরক্ষামূলক পর্যালোচনা (read-only live access; কোনো অননুমোদিত penetration test নয়)  
**ভিত্তি:** `05cf1a5ca5239c154786c9baff3e93c01c159402`  
**সিদ্ধান্ত:** নিরাপত্তা উন্নয়ন করা হয়েছে, কিন্তু **Play Store production release এখনো নিরাপত্তা-অনুমোদিত নয়**। বাস্তব Android, authenticated API এবং অর্থনৈতিক লেনদেনের পূর্ণ পরীক্ষা বাকি।

## অগ্রাধিকার অনুযায়ী ফলাফল

| অগ্রাধিকার | পর্যবেক্ষণ ও প্রমাণ | অবস্থা / প্রয়োজনীয় ব্যবস্থা |
|---|---|---|
| **উচ্চ — WebView ব্রিজে অন্য iframe** | `SharikaActivity.java`-এ `addJavascriptInterface(new NativeBridge(), "SharikaNative")` ব্যবহৃত। আগের `shouldOverrideUrlLoading` non-main-frame navigation সরাসরি allow করত। Android-এর ডকুমেন্টেশন অনুযায়ী JS interface সব frame-এ উন্মুক্ত; কলারের origin শনাক্ত করা যায় না। | **Staging-এ প্রতিরক্ষা যোগ**: বাইরের subframe navigation বাধা এবং packaged HTML-এ `frame-src 'self' about:` CSP। এটি সম্পূর্ণ সমাধান নয়; remote JS supply-chain আলাদা ঝুঁকি। |
| **উচ্চ — মাইক্রোফোন origin যাচাই ছিল না** | `onPermissionRequest`-এ কেবল RESOURCE_AUDIO_CAPTURE ও Android permission পরীক্ষা ছিল; কোন web origin থেকে অনুরোধ এসেছে তা নয়। | **Staging-এ প্রতিরক্ষা যোগ**: `getOrigin()` যাচাই এবং packaged `index.html`-এর বাইরে হলে deny। **বাস্তব ডিভাইসে দুই পক্ষের voice regression পরীক্ষা না করা পর্যন্ত release নয়।** |
| **উচ্চ — Remote LiveKit JS** | `android-staging/staging-connection.js`-এ `https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js` runtime-এ লোড হয়। এটি privileged WebView-তে remote script execution ও CDN supply-chain নির্ভরতা। | **এখনো বাকি**: নির্দিষ্ট যাচাইকৃত build/hash-সহ SDK অ্যাপের সঙ্গে bundle করে remote script লোড বন্ধ করা; mic/voice regression ছাড়া তা বদলানো নিরাপদ নয়। |
| **উচ্চ — সীমাহীন seller stock** | `cloudflare/src/sellers.mjs`-এ অনুমোদিত unlimited-stock seller নিজেকেও কয়েন পাঠাতে পারে। Super Admin ছাড়া এই mode দেওয়া যায় না এবং ledger আছে—তবু admin account takeover হলে অত্যন্ত বড় ক্ষতির সম্ভাবনা। | **ব্যবসার অনুমোদিত ফিচার, exploit প্রমাণ নয়।** Production-এ MFA, দ্বিতীয় অনুমোদন, দৈনিক সীমা/alert এবং audit review প্রয়োজন। |
| **মাঝারি — API abuse ও DDoS সীমা** | gift/chat/bet জাতীয় কিছু রুটে app-side rate limit আছে; সকল রুটে কেন্দ্রীয় Cloudflare WAF/API rate-limit কার্যকর কি না Worker কোড থেকে বোঝা যায় না। | **লাইভ কনফিগ যাচাই বাকি**। Auth, signup, admin, seller, game ও public image রুটে traffic/rate policies যাচাই করতে হবে; স্বাভাবিক voice traffic বাধা না দিয়ে। |
| **মাঝারি — Legacy demo login fallback** | `app/index.html`-এ localStorage/SHA-256-ভিত্তিক পুরোনো demo-account কোড রয়ে গেছে; Android build-এ staging adapter `API.login` ও `API.signup` override করে। Adapter না লোড হলে বিভ্রান্তিকর স্থানীয় UI চলতে পারে। | **বাকি**: production-এ demo auth/remove বা adapter-not-ready হলে fail-closed; নিশ্চিত করতে হবে কেবল server-confirmed balance দেখায়। |
| **মাঝারি — Play payment ও games** | Staging-এ কয়েন কেনাবেচা/গেম-স্টেকিং রয়েছে। Play Billing, বয়স ও অঞ্চলভিত্তিক policy, virtual-currency ও gambling classification-এর পূর্ণ compliance review হয়নি। | **বাকি**: আইনি/Play নীতিমালা যাচাই; settlement ও billing integration ছাড়া cash-equivalent production release নয়। |
| **মাঝারি — পেনিট্রেশন ও ডিভাইস টেস্টের ঘাটতি** | Code review থেকে Broken Access Control, token theft, race condition, device compromise সম্পূর্ণ বাদ দেওয়া সম্ভব নয়। | দুইটি test account, owner/admin/seller role, low bandwidth, Android 8–16, resend/replay/race, ban/kick/seat, Voice এবং wallet ledger পরীক্ষা আবশ্যক। |

## ইতিমধ্যে যে সুরক্ষা দেখা গেছে

1. `cloudflare/src/auth.mjs`: Firebase JWT-এর signature, issuer, audience ও মেয়াদ সার্ভারে যাচাই; client-এর পাঠানো public ID-কে authentication হিসেবে ব্যবহার করে না।
2. `cloudflare/src/admin.mjs` ও `moderation.mjs`: Admin/Room Admin ক্ষমতা server-side D1 role ও membership দিয়ে যাচাই।
3. `cloudflare/src/sellers.mjs`, `games.mjs`, `original-games.mjs`, `greedy-wheel.mjs`: coin operations-এ transaction ledger, idempotency key ও prepared SQL ব্যবহার; random game-round seed server-side cryptographic entropy দিয়ে শুরু হয়। পরীক্ষায় race-free প্রমাণিত হয়েছে—এমন দাবি করা হচ্ছে না।
4. Android manifest: `allowBackup=false`, `usesCleartextTraffic=false`; browser-native API caller path-এ fixed Worker origin + allowlisted routes।
5. Images যাচাই করে JPEG headers ও size limit; staging Worker-এ request body limit ও কিছু anti-spam checks আছে।

## এই অডিটে যা পরীক্ষা করা হয়নি

- অন্য মানুষের account, private data বা coins-এ destructive পরীক্ষা করা হয়নি।
- লাইভ Cloudflare firewall/rate-limit dashboard, Firebase Console configuration, Google Play Console signing/billing বা user-device rooted environment-এর independent verification হয়নি।
- Real-device microphone origin ও `srcdoc` room behaviour, 2-phone voice call, service worker/bridge XSS, paid purchase/chargeback, 2+ concurrent wallet request এবং game win settlement-এর end-to-end পরীক্ষা হয়নি।
- কোনো APK reverse-engineering, third-party hacking attack বা পূর্ণ OWASP MASVS assessment করা হয়নি।

## Production gate — ছাড়ার আগে আবশ্যক

- [ ] Security patch সহ staging APK compile এবং দুই ফোনে owner/guest দুই দিকের mic ও speaker পরীক্ষা।
- [ ] Google/email sign-in/out, blocked/disabled user, Admin, Room Admin এবং seller role cross-account negative tests।
- [ ] একই gift/recharge/bet request পুনরায়, সমান্তরালে এবং network retry দিয়ে পাঠিয়ে **ঠিক একবার** ledger update নিশ্চিত করা।
- [ ] Family gift target/commission, room reward, invite bonuses ও withdrawal minimum হিসাব আলাদা audit ledger-এ মিলিয়ে দেখা।
- [ ] Verified self-hosted/pinned LiveKit SDK; remote third-party script dependency দূর করা।
- [ ] Cloudflare WAF rate-limit, credential stuffing detection, Firebase security posture, backup/recovery ও security incident process চালু করা।
- [ ] Google Play Billing/financial policy, privacy disclosure, age/child safety, data deletion ও production signing যাচাই।
- [ ] Code scan + dependency vulnerability scan + একটি অনুমোদিত independent penetration test; প্রতিকার শেষে পুনরায় পরীক্ষা।

## পরিবর্তনের সীমা ও সতর্কতা

এই পর্যায়ে শুধু **staging Android WebView hardening** এবং **source-regression test** যোগ করা হচ্ছে। Existing backend, D1 data, কয়েন ব্যালেন্স, real user account, API contract বা voice business logic বদলানো হচ্ছে না। Android-এর network origin policy জটিল হওয়ায় mic change-এর পরে বাস্তব ফোনে voice যাচাই বাধ্যতামূলক। ১০০% “হ্যাক করা অসম্ভব” নিশ্চয়তা দেওয়া বাস্তবসম্মত নয়।

**প্রধান রেফারেন্স (প্রাথমিক উৎস):**
- Android Developers, [WebView JavaScript interfaces](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,java.lang.String))
- Android Developers, [Insecure WebView native bridges](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)
- Android Developers, [PermissionRequest origin](https://developer.android.com/reference/android/webkit/PermissionRequest#getOrigin())
