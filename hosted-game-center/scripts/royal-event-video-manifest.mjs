// Generate stable, public-safe video object names for Sharika staging Events 3–13.
// Cloudflare Worker media path requires a lowercase UUID-shaped MP4 key.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const dest=resolve(process.argv[2]||'/tmp/sharika-royal-events-video');
mkdirSync(dest,{recursive:true});
const ids=Array.from({length:11},(_,i)=>i+3);
const assetRoot=resolve('hosted-game-center/web/event-banners');
const entries=ids.map(id=>{
 const file=resolve(assetRoot,'event-'+id+'.svg');
 const svg=readFileSync(file,'utf8');
 if(!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')||
    !svg.includes('</svg>')||svg.includes('<script'))
   throw new Error('Invalid source Royal banner SVG for Event '+id);
 const b=Buffer.from(createHash('sha256')
   .update('Sharika staging Royal Event '+id+' cinematic-loop v1 2026-11-20')
   .digest().subarray(0,16));
 b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;
 const h=b.toString('hex');
 const uuid=[h.slice(0,8),h.slice(8,12),h.slice(12,16),
   h.slice(16,20),h.slice(20,32)].join('-');
 return {id,source:file,uuid,key:'studio/'+uuid+'.mp4',
  target:resolve(dest,'event-'+id+'.mp4'),
  url:'https://sharika-api-staging.soverixnet.workers.dev/api/v1/media/'+uuid+'.mp4'};
});
if(new Set(entries.map(e=>e.key)).size!==11)throw Error('duplicate R2 object keys');
writeFileSync(resolve(dest,'manifest.json'),JSON.stringify(entries,null,2));
console.log('Prepared 11 unique staging Event video object keys');
