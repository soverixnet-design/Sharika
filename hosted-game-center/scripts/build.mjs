import {cpSync,mkdirSync,rmSync,copyFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=resolve(root,'../android-staging/app/src/main/assets');
const dist=join(root,'dist');rmSync(dist,{recursive:true,force:true});mkdirSync(join(dist,'games'),{recursive:true});
for(const part of ['original-games','greedy-wheel','fruit-royale']){
 const src=join(source,part);
 if(!statSync(src).isDirectory())throw Error('missing_game_assets:'+part);
 cpSync(src,join(dist,'games',part),{recursive:true});
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
  'greedy-wheel.webp':'greedy-wheel/img/emerald-garden.webp'
})){
  copyFileSync(join(source,src),join(dist,'cards',dest));
}
for(const name of ['index.html','app.js','practice.js','style.css'])
  copyFileSync(join(root,'web',name),join(dist,name));
console.log('Sharika Game Center assets ready; original game files preserved');
