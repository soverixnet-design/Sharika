import {cpSync,mkdirSync,rmSync,copyFileSync,statSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=resolve(root,'../android-staging/app/src/main/assets');
const dist=join(root,'dist');rmSync(dist,{recursive:true,force:true});mkdirSync(join(dist,'games'),{recursive:true});
for(const part of ['original-games','greedy-wheel','fruit-royale']){
 const src=join(source,part);
 if(!statSync(src).isDirectory())throw Error('missing_game_assets:'+part);
 cpSync(src,join(dist,'games',part),{recursive:true});
}
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
  'jackpot-fruit.png':'jackpot-fruit-original-card.png',
  'gaddy-royal.svg':'@web/gaddy-royal.svg',
  'sovera-food-royal.svg':'@web/sovera-food-royal.svg',
  'night-food-royal.svg':'@web/night-food-royal.svg',
  'greedy-wheel-royal.svg':'@web/greedy-wheel-royal.svg'
})){
  copyFileSync(src.startsWith('@web/')?join(root,'web',src.slice(5)):join(source,src),join(dist,'cards',dest));
}
for(const name of ['index.html','app.js','practice.js','style.css'])
  copyFileSync(join(root,'web',name),join(dist,name));
console.log('Sharika Game Center assets ready; original game files preserved');
