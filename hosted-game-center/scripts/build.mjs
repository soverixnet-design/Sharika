import {cpSync,mkdirSync,rmSync,copyFileSync,statSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=resolve(root,'../android-staging/app/src/main/assets');
const dist=join(root,'dist');rmSync(dist,{recursive:true,force:true});mkdirSync(join(dist,'games'),{recursive:true});
for(const part of ['original-games','greedy-wheel','fruit-royale']){
 const src=join(source,part);
 if(!statSync(src).isDirectory())throw Error('missing_game_assets:'+part);
 cpSync(src,join(dist,'games',part),{recursive:true});
}
// Native Firebase + Cloudflare round-trip may exceed an individual iframe's old
// 9–15 second timer. Keep the original artwork/game engines unchanged; widen
// only the hosted copies' response window beyond the parent bridge (30 seconds).
// Existing request IDs / idempotency and the pending-bet lock remain intact.
const iframeTimeouts=[
 ['original-games/food-wheel-deluxe.html',
  "reject(Error('Server timeout'))},12000);",
  "reject(Error('Server timeout'))},34000);"],
 ['original-games/sovera-food-wheel.html',
  "reject(Error('server_timeout'));\n      },15000);",
  "reject(Error('server_timeout'));\n      },34000);"],
 ['original-games/night-food-wheel.html',
  "reject(Error('server_timeout'));\n      },15000);",
  "reject(Error('server_timeout'));\n      },34000);"]
];
for(const [relative,oldCode,newCode] of iframeTimeouts){
 const file=join(dist,'games',relative);
 const original=readFileSync(file,'utf8');
 if(original.split(oldCode).length!==2)throw Error('timeout_patch_mismatch:'+relative);
 writeFileSync(file,original.replace(oldCode,newCode));
}

 // Keep the original Food Wheel source and all hit-target geometry intact.
 // In the 65%-height room iframe, the old 2352px stage included ~250px of
 // lower decorative floor and forced avoidable navy side gutters. Crop ONLY
 // that noninteractive floor in the hosted copy and paint matching gutters.
 // In the outside full-screen game, keep the exact original 2352px stage.
 const foodFile=join(dist,'games/original-games/food-wheel-deluxe.html');
 const foodOriginal=readFileSync(foodFile,'utf8');
 const oldFit="function fit(){const s=Math.min(innerWidth/1080,innerHeight/2352),st=$('stage');st.style.transform=`scale(${s})`;st.style.left=(innerWidth-1080*s)/2+'px';st.style.top=(innerHeight-2352*s)/2+'px'}";
 // A newly opened WebView/iframe may report a zero-sized viewport during
 // its first layout pass. Never store scale(0), which can hide all bet targets
 // until the iframe is forcibly reloaded. Refit on restored visibility.
 const roomFit=[
  'let fitRetry=0;',
  'function fit(){',
  "const room=new URLSearchParams(location.search).get('mode')==='room';",
  'const designHeight=room?2100:2352;',
  'const w=Math.max(innerWidth||0,document.documentElement.clientWidth||0);',
  'const h=Math.max(innerHeight||0,document.documentElement.clientHeight||0);',
  'if(w<10||h<10){if(fitRetry++<50)setTimeout(fit,80);return;}',
  'fitRetry=0;',
  'const s=Math.min(w/1080,h/designHeight);',
  'if(!Number.isFinite(s)||s<=0)return;',
  "const st=$('stage');",
  "st.style.height=designHeight+'px';",
  "st.style.transform='scale('+s+')';",
  "st.style.left=(w-1080*s)/2+'px';",
  "st.style.top=(h-designHeight*s)/2+'px';",
  "document.body.style.background=room?",
  "'linear-gradient(180deg,#1d56cf,#3b8ae6 29%,#9fd0f7 56%,#f08545 57%,#f9b878)':'#0b2a6b';",
  '}',
  "addEventListener('pageshow',()=>setTimeout(fit,0));",
  "document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(fit,0);});",
  "if(window.ResizeObserver)new ResizeObserver(()=>fit()).observe(document.documentElement);"
 ].join('');
 if(foodOriginal.split(oldFit).length!==2)throw Error('food_room_fit_source_changed');
 writeFileSync(foodFile,foodOriginal.replace(oldFit,roomFit));

// Royal Slots uses its own original inline assets (including premium MP3).
mkdirSync(join(dist,'games','royal-slots'),{recursive:true});
let slotHtml=readFileSync(join(root,'web','royal-slots.html'),'utf8');
const celebrationSignature='function celebrate(win, bet, jp) {';
if(!slotHtml.includes(celebrationSignature)||!slotHtml.includes('</head>'))
  throw Error('missing_royal_slots_visual_hook');
slotHtml=slotHtml.replace(celebrationSignature,celebrationSignature+
  "\n  if (window.SharikaWinCelebration?.show) return window.SharikaWinCelebration.show({win,bet,jackpot:!!jp,audioEnabled:S.snd,compact:$('app').classList.contains('compact')});\n");
slotHtml=slotHtml.replace('</head>','<link rel="stylesheet" href="win-celebration.css?v=2"></head>');
if(!slotHtml.includes('</body>'))throw Error('invalid_royal_slots_html');
writeFileSync(join(dist,'games','royal-slots','index.html'),slotHtml.replace('</body>','<script src="bridge.js"></script><script src="royal-slots-voice.js"></script><script src="win-celebration.js?v=2"></script></body>'));
copyFileSync(join(root,'web','royal-slots-bridge.js'),join(dist,'games','royal-slots','bridge.js'));
copyFileSync(join(root,'web','royal-slots-voice.js'),join(dist,'games','royal-slots','royal-slots-voice.js'));
for(const name of ['win-celebration.js','win-celebration.css'])
  copyFileSync(join(root,'web',name),join(dist,'games','royal-slots',name));
for(const name of ['welcome-female.mp3','voice-big-female.mp3'])
  copyFileSync(join(root,'web',name),join(dist,'games','royal-slots',name));
// Use the owner's original game-card artwork from the Android app.
mkdirSync(join(dist,'cards'),{recursive:true});
for(const [dest,src] of Object.entries({
  'superace.svg':'royal-ace-card.svg',
  'royal-slots.svg':'@web/royal-slots-card.svg',
  'royal-slots.webp':'@web/royal-slots-card.webp',
  'cleopatra.jpg':'game-cards/cleopatra-gold.jpg',
  'fruit-machine.jpg':'game-cards/fruit-machine.jpg',
  'greedy.jpg':'game-cards/hot-food.jpg',
  'food-wheel.png':'food-wheel-original-card.png',
  'fruit-machine-user.webp':'@web/fruit-machine-user.webp',
  'jackpot-fruit.png':'jackpot-fruit-original-card.png',
  'gaddy-royal.svg':'@web/gaddy-royal.svg',
  'sovera-food-royal.svg':'@web/sovera-food-royal.svg',
  'night-food-royal.svg':'@web/night-food-royal.svg',
  'greedy-wheel-royal.svg':'@web/greedy-wheel-royal.svg'
})){
  copyFileSync(src.startsWith('@web/')?join(root,'web',src.slice(5)):join(source,src),join(dist,'cards',dest));
}
// Each Royal Event has independent first-party SVG art. Do not share images
// or require remote asset CDNs. Future Admin JPEGs override these originals.
mkdirSync(join(dist,'event-banners'),{recursive:true});
for(let id=3;id<=13;id++){
 const name='event-'+id+'.svg';
 const svg=readFileSync(join(root,'web','event-banners',name),'utf8');
 if(!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')||
    svg.includes('<script')||svg.includes('foreignObject')||
    !svg.includes('</svg>'))throw Error('Unsafe or missing event artwork: '+id);
 writeFileSync(join(dist,'event-banners',name),svg);
}
for(const name of ['index.html','app.js','practice.js','style.css','center.html','center.css','center.js'])
  copyFileSync(join(root,'web',name),join(dist,name));
console.log('Sharika Game Center assets ready; original game files preserved');
