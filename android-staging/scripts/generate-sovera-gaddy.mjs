// Reproduce the developer's single-file graphics while stripping every demo
// script (fake bots, local balances, random payouts and public Socket.io token).
// Game assets are generated at build time for the Android WebView.
import {readFileSync,writeFileSync} from 'node:fs';
const source=new URL('../reference-games/sovera-gaddy-source.html',import.meta.url);
const target=new URL('../app/src/main/assets/original-games/sovera-gaddy-game.html',import.meta.url);
const raw=readFileSync(source,'utf8');
const scripts=[...raw.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
if(scripts.length!==4)throw new Error('Sovera Gaddy source scripts changed unexpectedly');
const html=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('<title>Sovera Voice Chat – ফুড হুইল</title>',
    '<title>Sovera Gaddy Game • Sharika</title>')
  .replace('আজকের রাউন্ড: <span id="rn">',
    '👑 Sovera Gaddy Game · Round: <span id="rn">')
  .replace('<html lang="bn">','<html lang="en">')
  .replace('title="ফিরে যান"','title="Back to all games"')
  .replace('title="রুমের ভিতর/বাইরে"','title="Room mode"')
  .replace('title="র‍্যাঙ্কিং"','title="Daily bet ranking"')
  .replace('title="আমার হিস্ট্রি"','title="My bet history"')
  .replace('<span id="ht">সময় বাছাই করুন</span>','<span id="ht">Place your bets</span>')
  .replace('<span class="l">ফলাফল:</span>','<span class="l">Server result:</span>')
  .replace('<small id="fnm">খেলোয়াড়</small>','<small id="fnm">Player</small>')
  .replace('<small>আজকের আয়</small>','<small>Today\'s Winnings</small>')
  .replace('>অটো প্লে</button>','>Auto Play</button>')
  .replace('<b>🏆 আজকের র‍্যাঙ্কিং</b>','<b>🏆 Daily Bet Ranking</b>')
  .replace('💎 <span id="bal">','🪙 <span id="bal">')
  .replace('💎 <span id="rev">','🪙 <span id="rev">')
  .replace('</head>',`<style>
  #room{display:none!important}#game{min-height:100%;background:linear-gradient(145deg,#09a6a4,#035d66)}
  #mode,#auto{display:none!important}
  /* Keep all food graphics vivid, including when the betting window closes. */
  #wheel .slot:disabled{opacity:1;filter:none}
  #wheel .slot:enabled{cursor:pointer;touch-action:manipulation}
  #wheel .slot.pending{outline:3px solid #ffde64;outline-offset:3px;box-shadow:0 0 0 4px #ffc84680,0 10px 24px #ffc846aa}
  #toast{z-index:99}
  #gaddy-bet-ranking{position:absolute;top:5px;left:7px;right:7px;z-index:5;
    background:linear-gradient(145deg,#4f2b14ef,#24120def);color:#ffebc3;
    border:1.5px solid #ffcd67;border-radius:12px;padding:6px 10px;
    font-size:11px;box-shadow:0 4px 12px #0005;pointer-events:auto}
  .gaddy-rank-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .gaddy-rank-head strong{font-size:10px;letter-spacing:.4px}
  .gaddy-rank-head button{border:1px solid #fbd174;background:#ffcf70;color:#402108;
    border-radius:8px;font-size:10px;font-weight:800;padding:2px 8px;cursor:pointer}
  #gaddy-rank-top{display:flex;gap:5px;list-style:none;margin:4px 0 2px;padding:0}
  #gaddy-rank-top li{min-width:0;flex:1;display:flex;justify-content:space-between;gap:4px;
    background:#fff1d61c;border-radius:6px;padding:3px 5px}
  #gaddy-rank-top li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #gaddy-rank-top li b{white-space:nowrap;color:#ffe16d}
  #gaddy-rank-my{display:block;color:#ffe4a4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html.sharika-room-mini #app{max-width:none}
  html.sharika-room-mini #wheel{width:min(88%,41vh)}
  html.sharika-room-mini #gaddy-bet-ranking{padding:4px 7px}
  html.sharika-room-mini #gaddy-rank-top li:nth-child(n+2){display:none}
  html.sharika-room-mini .top{padding:3px 8px}
  html.sharika-room-mini .bottom{flex-shrink:0}
  @media(max-height:600px){#wheel{width:min(74vw,40vh)}.slot .e{font-size:23px}
    #gaddy-bet-ranking{padding:3px 7px}#gaddy-rank-top{margin:2px 0}}
  </style></head>`)
  .replace('</body>',`<script src="./sovera-gaddy-live.js"></script></body>`);
if(/Math\.random\(|localStorage\.|cdn\.jsdelivr|socket\.io-client|pick\(\)/.test(html))
  throw new Error('Unsafe demo/runtime code survived the Gaddy build');
writeFileSync(target,html);
console.log('Generated Sovera Gaddy HTML: demo scripts removed, bundled graphics retained.');
