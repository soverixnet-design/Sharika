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
// Use the owner's original game-card artwork from the Android app.
mkdirSync(join(dist,'cards'),{recursive:true});
for(const [dest,src] of Object.entries({
  'superace.svg':'royal-ace-card.svg',
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
