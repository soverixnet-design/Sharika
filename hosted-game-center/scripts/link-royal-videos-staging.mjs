// Publish already-uploaded staging R2 video URLs to their exact Event IDs.
// Refuses wrong repo branch or database and NEVER touches balances or grants.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const manifest=JSON.parse(readFileSync(resolve(process.argv[2]||'/tmp/sharika-royal-events-video/manifest.json'),'utf8'));
const ACCOUNT='d81cf7c48fb9b36d468cb0a08720cd74';
const DB='b2c62252-12a5-4740-90c7-01a536d9a39a';
const branch='refs/heads/feature/sharika-event-videos-r2-room-20261120';
if(process.env.GITHUB_REF!==branch||
   process.env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT||
   !process.env.CLOUDFLARE_API_TOKEN||manifest.length!==11||
   new Set(manifest.map(x=>x.id)).size!==11||
   manifest.some((e,i)=>e.id!==i+3||
     !/^studio\/[a-f0-9-]{36}\.mp4$/.test(e.key)||
     e.url!=='https://sharika-api-staging.soverixnet.workers.dev/api/v1/media/'+e.uuid+'.mp4'))
 throw new Error('STAGING branch, account, or per-Event video manifest invalid');
const base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/d1/database/'+DB+'/query';
async function query(sql,params=[]){
 const res=await fetch(base,{method:'POST',headers:{
  authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
  'content-type':'application/json'},body:JSON.stringify({sql,params}),
  signal:AbortSignal.timeout(20000)});
 const json=await res.json();
 if(!res.ok||!json.success||json.errors?.length)
  throw new Error('Staging D1 query failed: '+JSON.stringify(json.errors||res.status));
 return json.result?.[0]||{results:[],meta:{}};
}
const auditor=(await query(
 "SELECT r.auth_uid FROM sharika_admin_roles r JOIN sharika_users u "+
 "ON u.auth_uid=r.auth_uid WHERE r.role='super' ORDER BY r.auth_uid LIMIT 1"
)).results?.[0]?.auth_uid;
if(!auditor)throw new Error('No authorized Super Admin exists to audit staging media linking');
const sql='SELECT id,title,status,video_url FROM sharika_events WHERE id BETWEEN 3 AND 13 ORDER BY id';
const existing=(await query(sql)).results;
if(existing.length!==11||existing.some((x,i)=>x.id!==manifest[i].id||
   x.status!=='published'))
 throw new Error('Not exactly 11 expected, published Staging Events');
for(const entry of manifest){
 const response=await fetch(entry.url,{method:'HEAD',signal:AbortSignal.timeout(16000)});
 const bytes=Number(response.headers.get('content-length')||0);
 const mime=response.headers.get('content-type')||'';
 if(response.status!==200||!mime.includes('video/mp4')||bytes<10000||bytes>25*1024*1024)
  throw new Error('Event '+entry.id+' clip has not been verified in staging R2: '+response.status+', '+mime+', '+bytes);
 console.log('Verified Event '+entry.id+' MP4 available ('+bytes+' bytes)');
}
let linked=0,already=0;
for(const entry of manifest){
 const current=existing.find(x=>x.id===entry.id);
 if(current.video_url){already++;continue;}
 const saved=await query(
  "UPDATE sharika_events SET video_url=?,updated_at=datetime('now') "+
  "WHERE id=? AND status='published' AND video_url=''",
  [entry.url,entry.id]);
 if(Number(saved.meta?.changes)!==1)
  throw new Error('Event '+entry.id+' concurrent change; event left unchanged');
 await query('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)',
  [auditor,'event_video_link',JSON.stringify({
    event_id:entry.id,source:'original-royal-svg-cinematic-export',
    media_key:entry.key,coins_added:0,items_granted:0,environment:'staging'})]);
 linked++;
}
const verified=(await query(sql)).results;
if(verified.length!==11||verified.some(row=>!row.video_url))
 throw new Error('Missing Event video URLs after link updates');
console.log('STAGING R2 MP4 LINK SUCCESS: '+linked+' newly linked, '+already+' previously configured');
