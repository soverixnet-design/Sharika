import {cpSync,mkdirSync,rmSync,copyFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=resolve(root,'../android-staging/app/src/main/assets');
const dist=join(root,'dist');rmSync(dist,{recursive:true,force:true});mkdirSync(join(dist,'games'),{recursive:true});
for(const part of ['original-games','greedy-wheel','fruit-royale']){
 const src=join(source,part);
 if(!statSync(src).isDirectory())throw Error('missing_game_assets:'+part);
 cpSync(src,join(dist,'games',part),{recursive:true});
}
for(const name of ['index.html','app.js','style.css'])copyFileSync(join(root,'web',name),join(dist,name));
console.log('Sharika Game Center assets ready; original game files preserved');
