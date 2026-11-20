// Restore unrelated modules from the running staging sourcemap before bundling.
import {readFileSync,writeFileSync} from 'node:fs';
const config=JSON.parse(readFileSync('cloudflare/wrangler.jsonc'));
if(config.name!=='sharika-api-staging'||config.d1_databases[0].database_id!=='b2c62252-12a5-4740-90c7-01a536d9a39a')throw Error('Wrong staging target');
const url='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/workers/scripts/'+config.name;
const response=await fetch(url,{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN}});
if(!response.ok)throw Error('Staging source unavailable: '+response.status);
const form=await response.formData();
const map=JSON.parse(await form.get('voice-worker.js.map').text());
const changed=new Set(['greedy-classic','greedy-wheel','fruit-royale','sovera-gaddy','original-games','food-wheel-deluxe','cleopatra','royal-ace','royal-slots','security-rate-limit','round-tap-batch']);
let restored=0;
for(const [i,path] of map.sources.entries()){
  if(!/^src\/[a-z0-9-]+\.mjs$/.test(path))continue;
  if(changed.has(path.slice(4,-4)))continue;
  if(typeof map.sourcesContent[i]!=='string')throw Error('Missing active source '+path);
  writeFileSync('cloudflare/'+path,map.sourcesContent[i]);restored++;
}
if(restored<35)throw Error('Incomplete staging source map');
console.log('Preserved',restored,'active staging modules.');
