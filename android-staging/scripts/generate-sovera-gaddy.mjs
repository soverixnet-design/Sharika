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
    '👑 Sovera Gaddy Game · রাউন্ড: <span id="rn">')
  .replace('💎 <span id="bal">','🪙 <span id="bal">')
  .replace('💎 <span id="rev">','🪙 <span id="rev">')
  .replace('</head>',`<style>
  #room{display:none!important}#game{min-height:100%;background:linear-gradient(145deg,#09a6a4,#035d66)}
  #mode,#auto{display:none!important}
  .slot:disabled{opacity:.65;filter:grayscale(.4)}
  #wheel .slot{cursor:pointer}#toast{z-index:99}
  html.sharika-room-mini #app{max-width:none}
  html.sharika-room-mini #wheel{width:min(88%,41vh)}
  html.sharika-room-mini .top{padding:3px 8px}
  html.sharika-room-mini .bottom{flex-shrink:0}
  @media(max-height:600px){#wheel{width:min(74vw,40vh)}.slot .e{font-size:23px}}
  </style></head>`)
  .replace('</body>',`<script src="./sovera-gaddy-live.js"></script></body>`);
if(/Math\.random\(|localStorage\.|cdn\.jsdelivr|socket\.io-client|pick\(\)/.test(html))
  throw new Error('Unsafe demo/runtime code survived the Gaddy build');
writeFileSync(target,html);
console.log('Generated Sovera Gaddy HTML: demo scripts removed, bundled graphics retained.');
