# Sharika security remediation — ৩ নভেম্বর ২০২৬ (staging)

এই নথি ৩ নভেম্বরের [প্রথম নিরাপত্তা অডিট](./SECURITY_AUDIT_2026-11-03.md)-এর ফলো-আপ। কোনো ব্যবহারকারীর প্রকৃত কয়েন, ডায়মন্ড, Firebase credential, D1 data বা production Android release পরিবর্তন করা হয়নি।

## এই ধাপে সংশোধন

1. **External LiveKit script সরানো:** `android-staging/staging-connection.js` থেকে CDN-এর runtime `livekit-client` loader ও পুরোনো fallback সরানো হয়েছে। বর্তমানে Worker-এ `cloudflare_sfu` provider চালু আছে। এই পরিবর্তনে সক্রিয় Cloudflare WebRTC/SFU path অপরিবর্তিত; provider বদলালে অ্যাপ এখন explicit error দেখাবে, অচেনা remote JavaScript চালাবে না।
2. **Admin Panel Content-Security-Policy:** `cloudflare/src/admin-frontend-worker.mjs` এখন মূল Admin HTML-এর inline script-এর SHA-256 hash নির্ধারণ করে শুধু ওই script, একই-origin connector এবং নির্দিষ্ট Google/Firebase script host অনুমোদন করে। `base-uri 'none'`, `object-src 'none'`, `frame-ancestors 'none'`, `Permissions-Policy`, HSTS যোগ। Inline Admin UI ডিজাইন বদলানো হয়নি।
3. **Cloudflare Worker native rate limiting:** `SHARIKA_ACTION_RATE_LIMIT` (১২০ mutation/minute) এবং `SHARIKA_FINANCE_RATE_LIMIT` (২০ financial mutation/minute) binding যোগ। Firebase-verified `uid` দিয়ে প্রতি user শ্রেণিভিত্তিক key; real-time voice signaling ও GET requests বাদ। [Cloudflare documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) অনুযায়ী এগুলো per-location approximate counter, জোর করে সম্পূর্ণ distributed wallet limit নয়। Ledger/idempotency এবং server-side role validation অপরিবর্তিত। Production configuration-এ binding অনুপস্থিত থাকলে sensitive mutation fail-closed; পুরোনো staging fixture-এর জন্য binding অনুপস্থিত থাকলে fallback বহাল।
4. **Demo login fail-closed:** staging Android build-এর generated `index.html`-এ verified adapter লোডের আগেই `API.login/signup` fallback বন্ধ করা হয়েছে। Native adapter সফল হলে আগের মতো Firebase-এর verified auth চালু হয়। মূল `app/index.html` ও পুরোনো test data অপরিবর্তিত।
5. **Regression tests:** নতুন `cloudflare/test/security-hardening.test.mjs`-এ voice exemption, finance cap, absent-binding behaviour, CSP এবং CDN removal-এর source checks রয়েছে।

## সীমাবদ্ধতা / release blockers

- **Real-device verification:** Android microphone origin guard (পূর্ব ধাপ), নতুন APK-এ দুই দিকের voice, Google email/login, Admin Google popup, room seats এবং games-এর end-to-end phone test দরকার। Build ও emulator launch-কে voice test ধরা যাবে না।
- **Seller unlimited approval:** Stock unlimited business policy আগের মতোই রয়েছে; Super Admin permission + ledger আছে। ২য় অনুমোদন / MFA / সর্বোচ্চ recharge নীতি নির্ধারণ না করে চলমান wallet-এর limit পরিবর্তন করা নিরাপদ নয়। অ্যাডমিনের সিদ্ধান্ত প্রয়োজন।
- **Cloudflare custom-domain WAF:** Native Worker counter যোগ হলেও account-level/zone-level bot mitigation, unauthenticated endpoint protection এবং Workers.dev DDoS behaviour আলাদা করে পরীক্ষা করতে হবে।
- **Admin token lifetime:** Firebase token ও refresh token বর্তমানে sessionStorage-এ থাকে। Hash-based CSP XSS impact কমাতে সহায়তা করে; independent XSS review এবং Firebase MFA/session hardening বাকি।
- **Play Billing এবং আইনগত নীতি:** Merchant/Play Console-এর payment configuration, gambling/virtual-coin policy, user data deletion এবং account verification বাইরে থেকে চূড়ান্ত করা সম্ভব নয়।
- **D1 concurrency:** rate limiter financial ledger-এর বিকল্প নয়। Concurrent seller recharge, invite reward, gift/room reward ও bet settlement-এর transaction-level stress tests চলমান release gate।

## যাচাইয়ের মানদণ্ড

- [ ] Worker npm test ও static/syntax tests পাস।
- [ ] Android staging APK ও Play-review staging AAB compile পাস।
- [ ] Admin Worker dry-run/deploy পাস; Admin sign-in এবং Google popup browser-এ কাজ করছে।
- [ ] Cloudflare Worker deploy-এ দুই rate-limit binding দৃশ্যমান।
- [ ] দুটো Android ফোনে uninterrupted mic/speaker ও Back/mini-room পরীক্ষা পাস।
- [ ] Replayed/concurrent wallet gift/bet/recharge একবারই ledger-এ বসে।
- [ ] Production deployment-এর জন্য আলাদা অনুমোদন, Play Billing এবং policy checklist পূর্ণ।

**দ্রষ্টব্য:** ১০০% হ্যাকমুক্ত গ্যারান্টি দেওয়া যায় না; এই কাজ আক্রমণের পৃষ্ঠ কমিয়েছে, কিন্তু স্বাধীন penetration test-এর বিকল্প নয়।
