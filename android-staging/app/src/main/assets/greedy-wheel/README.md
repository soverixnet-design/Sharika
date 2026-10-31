# Greedy Wheel — অ্যাপে সংযুক্ত করার গাইড

গেমটি শুধু HTML/CSS/JS দিয়ে তৈরি (`index.html`, `style.css`, `game.js`)। কোনো সার্ভার বা লাইব্রেরি লাগে না। তোমার অ্যাপে WebView (Android / iOS / Flutter / React Native) অথবা ওয়েবসাইটে iframe দিয়ে খুলে দিলেই চলবে।

## ১. ফাইল হোস্ট করো
তিনটি ফাইল তোমার সার্ভারে / CDN-এ রাখো, অথবা অ্যাপের assets ফোল্ডারে রেখে লোকালি খোলো।

## ২. ইউজার ও কয়েন পাঠাও
সহজ উপায় — URL দিয়ে:

```
https://your-domain.com/greedy/index.html?uid=123&name=Rasel&balance=20000&lang=bn&avatar=https://.../photo.jpg
```

| প্যারামিটার | কাজ |
|---|---|
| `uid` | ইউজারের আইডি |
| `name` | নাম |
| `balance` | কয়েনের পরিমাণ |
| `avatar` | প্রোফাইল ছবির লিংক |
| `lang` | `bn` বা `en` |
| `sound` | `0` দিলে সাউন্ড বন্ধ |
| `sheet` | `1` দিলে ভয়েস রুমের নিচ থেকে ওঠা প্যানেলের মতো দেখাবে (উপরের কোণা গোল, পেছন স্বচ্ছ) |
| `round` | শুরুর রাউন্ড নম্বর |

অথবা JavaScript দিয়ে (WebView-এর `evaluateJavascript` থেকে):

```js
GreedyGame.init({ user:{id:'123', name:'Rasel', avatar:'...'}, balance: 20000, lang:'bn' });
GreedyGame.setBalance(15000);   // ব্যালান্স আপডেট
GreedyGame.addCoins(500);       // কয়েন যোগ (রিচার্জের পরে)
GreedyGame.getState();          // বর্তমান অবস্থা
GreedyGame.setHistory([{round:579,itemId:'tomato'}, ...]); // সার্ভারের আসল ফলাফল হিস্ট্রি (নতুনটা আগে)
GreedyGame.setOnline(120);      // রুমে কতজন খেলছে
```

অথবা postMessage দিয়ে: `{ target:'greedy-game', cmd:'setBalance', value:15000 }`

## ৩. গেম থেকে ইভেন্ট নাও
প্রতিটি ঘটনায় গেম এই মেসেজ পাঠায়: `{ source:'greedy-game', type, payload, userId, ts }`

| type | কখন | payload |
|---|---|---|
| `ready` | গেম লোড হলে | version |
| `round_start` | নতুন রাউন্ড শুরু | round, balance |
| `bet` | ইউজার বেট করলে | round, itemId, amount, balance |
| `betting_closed` | সময় শেষ | round, bets, totalBet |
| `round_result` | ফলাফল | resultId, multiplier, totalBet, win, net, balance |
| `insufficient_balance` | কয়েন কম | need, balance — এখানে রিচার্জ পেজ খুলতে পারো |
| `topup` | ব্যালান্সের পাশে + চাপলে | balance — রিচার্জ পেজ খোলো |
| `close` | × বাটন চাপলে | balance — এখানে গেম প্যানেল বন্ধ করো |

যেখানে মেসেজ যায়:
- **Android (Java/Kotlin):** `webView.addJavascriptInterface(obj, "GreedyBridge")` — `obj`-এ `@JavascriptInterface fun onEvent(json: String)`
- **iOS (WKWebView):** message handler নাম `greedy`
- **Flutter:** `webview_flutter`-এ JavaScriptChannel নাম `GreedyFlutter`, অথবা `flutter_inappwebview`-এ handler নাম `greedy`
- **React Native:** `onMessage` (`window.ReactNativeWebView`)
- **ওয়েব iframe:** `window.addEventListener('message', ...)`

## ৪. আসল সার্ভারের সাথে যুক্ত করা (অনলাইন মোড)
আসল অ্যাপে ফলাফল আর কয়েন ঠিক করবে `greedy-server` (আলাদা zip)। ফোনের গেম শুধু দেখায়, কিছু ঠিক করে না। লিংকে সার্ভার আর টোকেন দাও:

```
https://game.your-app.com/index.html?server=https://game.your-app.com&token=<তোমার অ্যাপের দেওয়া JWT>&sheet=1
```
অথবা JS দিয়ে:
```js
GreedyGame.connect({ server: 'https://game.your-app.com', token: '<JWT>' });
```
- সব ইউজার একই রাউন্ড, একই সময় আর একই ফলাফল দেখে; সবার মোট বেট লাইভ আপডেট হয়।
- বেটের কয়েন সার্ভার তোমার অ্যাপের ওয়ালেট থেকে কাটে, জিতলে সার্ভারই যোগ করে। গেমের ব্যালান্স সার্ভার থেকে আসে।
- টোকেন ভুল হলে গেম `auth_failed` ইভেন্ট পাঠায়; তখন নতুন টোকেন দিয়ে আবার `connect()` করো।
- `?server=` না দিলে গেম ডেমো মোডে চলে (ফোনেই র‍্যান্ডম, শুধু পরীক্ষার জন্য)।

বিস্তারিত (JWT বানানো, ওয়ালেট API, ডিপ্লয়) `greedy-server/README.md`-এ আছে।

## সালাদ ও পিৎজা
- **সালাদ:** চাকার উপরের ব্যাজ। এটা উঠলে চারটা সবজির (বাঁধাকপি, গাজর, ভুট্টা, টমেটো) সব বেট একসাথে ×5 করে জেতে।
- **পিৎজা:** চাকার নিচের ব্যাজ। এটা উঠলে চারটা মাংসের সব বেট একসাথে জেতে: চিংড়ি ×10, মাছ ×15, মুরগি ×25, স্টেক ×45।
- এগুলোতে সরাসরি বেট দেওয়া যায় না; এগুলো বিশেষ ফলাফল। ইতিহাসে রংধনু বলে দেখায়।
- উদাহরণ: চিংড়িতে ১০০ আর মাছে ১০০ দিলে পিৎজা উঠলে পাবে ১,০০০ + ১,৫০০ = ২,৫০০ কয়েন।

## ভয়েস রুমে বসানো
ভয়েস রুম অ্যাপে সাধারণত গেমটা নিচ থেকে ওঠা প্যানেলে খোলে। WebView-এর উচ্চতা স্ক্রিনের ৬৫–৮০% রাখো, পেছন স্বচ্ছ রাখো আর লিংকে `sheet=1` দাও। গেম নিজে থেকে উচ্চতা অনুযায়ী চাকার আকার ঠিক করে নেয় (৫২০px থেকে পুরো স্ক্রিন পর্যন্ত)।

## ৫. সেটিংস বদলানো
`game.js`-এর উপরে `CONFIG`-এ বা `GreedyGame.config({...})` দিয়ে:
- `bettingSeconds` (৩০), `resultSeconds` (৫)
- `chips` — চিপের মান `[10,100,1000,5000,10000]`
- `maxBetPerRound` — এক রাউন্ডে সর্বোচ্চ বেট
- `items` — খাবারের ছবি (`img/` ফোল্ডার), নাম, গুণ আর `weight` (জেতার সম্ভাবনা)। প্রথম ৪টি ডান পাশে (×10, ×15, ×25, ×45), পরের ৪টি বাম পাশে (সবজি ×5)
- `simulateOtherPlayers` — ডেমোতে অন্য খেলোয়াড়দের নকল বেট ও র‍্যাঙ্কিং; আসল অ্যাপে `false` দিয়ে সার্ভারের ডেটা দেখাও

ডিফল্ট সম্ভাবনা (১০০০ রাউন্ডে): প্রতিটি সবজি ≈১৯৪, চিংড়ি ≈৯৭, মাছ ≈৬৪, মুরগি ≈৩৮, স্টেক ≈২০, সালাদ ৪, পিৎজা ২। এতে প্রতিটি খাবারে গড়ে বেটের প্রায় ৯৮.৯% ফেরত আসে। অনলাইন মোডে এই সংখ্যা সার্ভারের `.env`-এ থাকে, ফোনের `CONFIG`-এ নয়।

## নোট
- কয়েন যদি টাকায় কেনা যায় বা টাকায় ফেরত নেওয়া যায়, তাহলে এটা অনেক দেশে জুয়া হিসেবে ধরা হয় (ওমান, বাংলাদেশসহ) এবং Google Play / App Store-এ আলাদা অনুমতি লাগে। শুধু খেলার কয়েন রাখলে ঝুঁকি কম।
