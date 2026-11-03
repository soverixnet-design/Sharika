# Sharika Fruit Royale — Frontend source package

এটি নতুন standalone game frontend; পুরোনো Sharika code থেকে কপি বা audit করা হয়নি।
শুধু UI, animation, local practice adapter এবং live integration contract দেওয়া হয়েছে।
কোনো Wallet, Worker, D1 database, Android project বা Production পরিবর্তন করা হয়নি।

## চালানো
ফাইলগুলো extract করে index.html ব্রাউজারে খুলুন। Chromium/WebView-এ চালিয়ে পরীক্ষা করুন।
বিকল্প: এই ফোল্ডারে `python -m http.server 8080` চালিয়ে localhost:8080 খুলুন।
সব styling ও animation local; external CDN/font/image download নেই। ফলের icon device emoji,
তাই Android version অনুযায়ী চেহারা বদলাতে পারে। 3D look CSS depth/shadow; WebGL model নয়।
সোর্সে HTML, CSS ও JS আলাদা রাখা হয়েছে। Build step বা npm dependency নেই।

## কী আছে
- Golden/purple mobile UI, 8 fruit wheel, travelling highlight এবং result reveal।
- Chip: 1K / 10K / 100K / 1M / 10M, custom whole-number chip।
- ফল ট্যাপ করলে সঙ্গে সঙ্গে সেই chip-এর এক বেট submit হয়; আলাদা confirm নেই।
- Countdown server closesAt থেকে; betting close মানেই result বানানো নয়।
- +1 / +2-তে 2 / 3 result fruit highlight; ×2 / ×3 badge; পৃথক Jackpot award display।
- Personal history, ranking period/metric controls, real-profile compatible rows।
- Winner/settled banner, compact layout, reduced-motion support।
- Fruit +3 নেই। কোনো approved live probability/payout policy তৈরি করা হয়নি।
- কোনো fake leaderboard বা অন্য ব্যক্তির fake win নেই।

## Demo-র সীমা
50,000,000 practice credits দিয়ে নতুন page session শুরু হয়। এগুলো real wallet নয়।
Data শুধু memory-তে থাকে; reload করলে practice balance/history reset হয়।
20-second betting, তারপর result, পাঁচ সেকেন্ড পর নতুন round।
Demo bonus weights: none 85%, Fruit +1 5%, Fruit +2 3%, ×2 4%, ×3 2%, Jackpot 1%।
Fruit প্রতি draw সমান 1/8 সম্ভাবনা; draw স্বাধীন, repeat হতে পারে।
Fruit multipliers: Lemon/Strawberry/Kiwi 5; Cherry/Plum 40; Melon 20; Mango/Apple 10।
সব draw-তে একই fruit-এ দেওয়া বেট সংশ্লিষ্ট multiplier পায়; যোগফলে ×2/×3 প্রযোজ্য।
Demo Jackpot বেট থাকলে 10,000 practice credits; pool কাটে না বা বাড়ে না।
Payout wallet-এ credit হয়; stake আলাদা ফেরত নয়। Profit = payout - total bet।
এই demo উদার/অর্থনৈতিকভাবে ভারসাম্যহীন, production probability বা jackpot schedule নয়।
ব্যবহারকারীর পূর্বের 10/30/50/70% Jackpot নিয়ম এই frontend চালু করেনি।

## Live integration
1. config.js-এ mode: 'live' দিন।
2. adapter.js-এর বদলে adapter.live.example.js যুক্ত করুন এবং তার methods বাস্তবায়ন করুন।
3. API_CONTRACT.md অনুসরণ করুন।
4. আপনার server থেকে authenticated state/result/history/ranking দিন।
5. UI-এর demo code production bundle থেকে বাদ দিন। mode বদলালেও real adapter ছাড়া betting হবে না।
6. Backend-এর official rules/probabilities আলাদাভাবে প্রকাশ করুন; help dialog-এর demo wording production অনুযায়ী বদলান।

Live mode-এ browser local outcome বানায় না, local balance debit/credit করে না।
Frontend amount/time checks শুধু UX; server-কে সব কিছু পুনরায় যাচাই করতে হবে।
Client code পরিবর্তনযোগ্য; balance ও ফলের সত্যতা backend-এর দায়িত্ব।

## Android host
এই package-এ Java Activity বা APK নেই; আপনার অনুরোধ অনুযায়ী এটি frontend-only।
একই WebView panel-এ `.compact` layout অথবা SharikaGame.setCompact(true) ব্যবহার করুন।
Game source-এ microphone, audio capture, voice SDK join/leave call নেই।
সুতরাং host Activity/Fragment যেন game dismiss-এ voice service বন্ধ না করে তা আপনাকে যুক্ত ও পরীক্ষা করতে হবে।
Voice চলার নিশ্চয়তা frontend standalone পরীক্ষা দিয়ে দেওয়া যায় না।
কোনো unrestricted native coin setter বা JS-এ API secret যোগ করবেন না।

## গুরুত্বপূর্ণ production দায়িত্ব
- Server token verification, balance checks, atomic ledger, idempotency ও settlement recovery।
- Request ID একই রেখে uncertain bet retry করুন। server round close হলেও আগের accepted request ফেরত দেবে।
- এই UI pending request শুধু memory-তে রাখে; reload/app death recovery host/backend-এ সংযুক্ত করুন।
- Event reconnect-এ missed result/history ও wallet পুনরায় sync করতে হবে।
- Poll/reconnect transport adapter-এ লিখুন; UI কোনো endpoint অনুমান করে না।
- Ranking sort, timezone, period boundaries এবং metric calculations server-এর দায়িত্ব।
- Admin, payout approval, authentication, multi-device settlement এই ZIP-এ backend হিসেবে নেই।
- API numbers JS safe-integer সীমার ভিতরে দিন; বড় integer চাইলে contract পরিবর্তন করুন।

## পরীক্ষা
TEST_REPORT.md-তে কোন checks চালানো হয়েছে এবং কোনগুলো হয়নি আলাদা দেওয়া আছে।
দুই ফোনের UI/voice/WebView ও live backend tests চালানো হয়নি।
