// Private Sharika Game Center staging worker. Separate from existing public
// game website until the authenticated Android launch flow is tested.
import oldGameSite from './index.mjs';
import {handlePrivateCenter,centerPublished} from '../../cloudflare/src/private-center.mjs';
import {readGiftRankings} from '../../cloudflare/src/admin.mjs';
import {handleEventApp} from '../../cloudflare/src/events.mjs';
const hdr={
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY'
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{...hdr,'content-type':'application/json; charset=utf-8'}
});
const enc=new TextEncoder();
const randomToken=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),
 c=>c.toString(16).padStart(2,'0')).join('');
const cookieToken=req=>{
 const raw=req.headers.get('cookie')||'';
 return raw.match(/(?:^|;\s*)__Host-sh_center=([a-zA-Z0-9_-]{43})(?:;|$)/)?.[1]||'';
};
async function session(db,req){
 const token=cookieToken(req);if(!token)return null;
 const digest=await sha(token);
 const row=await db.prepare('SELECT s.auth_uid,s.expires_at_ms FROM sharika_center_browser_sessions s '+
  'JOIN sharika_users u ON u.auth_uid=s.auth_uid AND u.status=\'active\' '+
  'WHERE s.session_sha256=? AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?')
  .bind(digest,Date.now()).first();
 return row?.auth_uid||null;
}
function gameForPath(path){
 // Directory aliases and all nested game assets must honor the same gate.
 for(const [prefix,id] of [['/games/royal-slots','royal-slots'],
   ['/games/greedy-wheel','greedy-wheel'],
   ['/games/fruit-royale','fruit-royale']]){
   if(path===prefix||path.startsWith(prefix+'/'))return id;
 }
 // A direct link to a hidden game's entry HTML must never launch.
 const known={
  '/games/royal-slots/index.html':'royal-slots',
  '/games/original-games/royal-ace-deluxe.html':'royal-ace',
  '/games/original-games/cleopatra-slot.html':'cleopatra',
  '/games/original-games/greedy-classic.html':'greedy-classic',
  '/games/original-games/food-wheel-deluxe.html':'food-deluxe',
  '/games/original-games/sovera-gaddy-game.html':'sovera-gaddy',
  '/games/original-games/sovera-food-wheel.html':'sovera-food',
  '/games/original-games/night-food-wheel.html':'night-food',
  '/games/greedy-wheel/index.html':'greedy-wheel',
  '/games/fruit-royale/index.html':'fruit-royale',
  '/games/original-games/jackpot-fruit.html':'jackpot-fruit'
 };
 return Object.prototype.hasOwnProperty.call(known,path)?known[path]:null;
}
function sameOriginWrite(req,url){
 return req.headers.get('origin')===url.origin &&
  req.headers.get('x-sharika-center')==='1';
}
async function catalog(db){
 const source=await db.prepare('SELECT p.id,p.published,c.enabled FROM sharika_center_publishing p '+
  'JOIN sharika_game_catalog c ON p.id=c.id WHERE p.kind=\'game\'').all();
 return new Set((source.results||[]).filter(x=>x.published===1&&x.enabled===1).map(x=>x.id));
}
export default {async fetch(req,env){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/health')return json({ok:true,private_center:true,public_game_access:false});
 if(!env.DB)return json({error:'center_not_configured'},503);
 if(path==='/session'&&req.method==='GET'){
  const ticket=url.searchParams.get('ticket')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))return json({error:'ticket_required'},401);
  const hash=await sha(ticket),now=Date.now();
  // One-time claim: only one request can redeem a given ticket.
  const redeemed=await env.DB.prepare('UPDATE sharika_center_launch_tickets '+
   'SET redeemed_at_ms=? WHERE token_sha256=? AND redeemed_at_ms IS NULL '+
   'AND expires_at_ms>? RETURNING auth_uid').bind(now,hash,now).first();
  if(!redeemed?.auth_uid)return json({error:'ticket_invalid_or_expired'},401);
  const token=randomToken(),digest=await sha(token);
  await env.DB.prepare('INSERT INTO sharika_center_browser_sessions('+
   'session_sha256,auth_uid,created_at_ms,expires_at_ms) VALUES(?,?,?,?)')
   .bind(digest,redeemed.auth_uid,now,now+1800000).run();
  // Room bottom sheet keeps voice in the existing Activity. Do not allow
  // arbitrary redirect targets or external URLs from a launch ticket.
  const view=url.searchParams.get('view')==='room'?'&view=room':'';
  return new Response(null,{status:303,headers:{
   ...hdr,'location':url.origin+'/?surface=app'+view,
   'set-cookie':'__Host-sh_center='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800'
  }});
 }
 const uid=await session(env.DB,req);
 if(!uid)return json({error:'private_center_login_required'},401);
 if(path==='/logout'&&req.method==='POST'){
  if(!sameOriginWrite(req,url))return json({error:'origin_forbidden'},403);
  await env.DB.prepare('UPDATE sharika_center_browser_sessions SET revoked_at_ms=? '+
   'WHERE session_sha256=?').bind(Date.now(),await sha(cookieToken(req))).run();
  return new Response(null,{status:204,headers:{
    ...hdr,'set-cookie':'__Host-sh_center=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});
 }
 const eventEndpoint=/^\/api\/center\/events\/([1-9][0-9]{0,10})\/(ranking|banner)$/.exec(path);
 if(path.startsWith('/api/center/')&&!eventEndpoint&&
    !['/api/center/rankings','/api/center/wallet','/api/center/gifts'].includes(path)){
  if(req.method!=='GET'&&!sameOriginWrite(req,url))
    return json({error:'origin_forbidden'},403);
  const sub='/api/v1/center/'+path.slice('/api/center/'.length);
  // The dedicated Sharika Admin Panel owns all admin routes.
  // The member website exposes ONLY its read-only manifest.
  const allowed=sub==='/api/v1/center/manifest';
  if(!allowed)return json({error:'route_not_allowed'},404);
  // The authenticated user comes exclusively from a server-created session.
  return handlePrivateCenter({request:req,path:sub,db:env.DB,uid,
    reply:(data,status,cors)=>new Response(JSON.stringify(data),{status,
      headers:{...hdr,...cors,'content-type':'application/json; charset=utf-8'}}),
    fail:(error,status,cors)=>new Response(JSON.stringify({error}),{status,
      headers:{...hdr,...cors,'content-type':'application/json; charset=utf-8'}}),cors:{}});
 }

 if(eventEndpoint){
  if(req.method!=='GET'&&req.method!=='HEAD')return json({error:'method_not_allowed'},405);
  const eid=Number(eventEndpoint[1]);
  if(!Number.isSafeInteger(eid)||!await centerPublished(env.DB,'module','events')||
    !await centerPublished(env.DB,'event','event:'+eid))
    return json({error:'event_hidden'},404);
  // Event-level status and time bounds are always independently enforced.
  const row=await env.DB.prepare("SELECT id,starts_at,ends_at,banner_id,status FROM sharika_events WHERE id=?")
    .bind(eid).first();
  const now=new Date().toISOString();
  if(!row||row.status!=='published'||row.ends_at<=now)return json({error:'event_unavailable'},404);
  if(eventEndpoint[2]==='ranking'){
   if(req.method==='HEAD')return new Response(null,{status:405,headers:hdr});
   return handleEventApp({request:req,env,uid,path:'/api/v1/events/'+eid+'/ranking',cors:{},
    reply:(data,status=200)=>json(data,status),fail:(error,status=400)=>json({error},status)});
  }
  if(!Number.isSafeInteger(Number(row.banner_id))||Number(row.banner_id)<1)
    return json({error:'event_banner_unavailable'},404);
  const banner=await env.DB.prepare("SELECT image_base64,mime,image_bytes FROM sharika_banner_images "+
   "WHERE banner_id=? AND image_bytes>0").bind(Number(row.banner_id)).first();
  if(!banner||banner.mime!=='image/jpeg'||banner.image_bytes>360000)
    return json({error:'event_banner_unavailable'},404);
  if(req.method==='HEAD')return new Response(null,{status:200,headers:{
   ...hdr,'content-type':'image/jpeg'}});
  const decoded=atob(banner.image_base64);
  if(decoded.length!==Number(banner.image_bytes))
    return json({error:'event_banner_corrupt'},503);
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  return new Response(bytes,{status:200,headers:{
   ...hdr,'content-type':'image/jpeg','content-security-policy':"default-src 'none'",
   'x-robots-tag':'noindex, nofollow, noarchive'
  }});
 }
 if(path==='/api/center/rankings'&&req.method==='GET'){
  const kind=url.searchParams.get('kind')||'rich';
  const period=url.searchParams.get('period')||'weekly';
  if(!await centerPublished(env.DB,'ranking',kind))
    return json({error:'ranking_hidden'},403);
  const supported=['rich','charm','room','games','recharge','noble','lucky'];
  if(!supported.includes(kind))return json({error:'ranking_source_not_available',leaders:[]},404);
  const output=await readGiftRankings(env.DB,period,kind,0);
  return output?json(output):json({error:'invalid_ranking_period'},400);
 }
 if(path==='/api/center/wallet'&&req.method==='GET'){
  if(!await centerPublished(env.DB,'module','wallet'))return json({error:'wallet_hidden'},403);
  const account=await env.DB.prepare("SELECT public_no,name,coins FROM sharika_users WHERE auth_uid=? AND status='active'")
    .bind(uid).first();
  if(!account)return json({error:'account_unavailable'},404);
  const statement=await env.DB.prepare('SELECT currency,delta,balance_after,reason,created_at '+
    'FROM sharika_wallet_ledger WHERE auth_uid=? ORDER BY id DESC LIMIT 15')
    .bind(uid).all();
  return json({wallet:'main',virtual_only:true,coins:Number(account.coins)||0,
    ledger:statement.results||[]});
 }
 if(path==='/api/center/gifts'&&req.method==='GET'){
  if(!await centerPublished(env.DB,'module','gifts'))return json({error:'gifts_hidden'},403);
  const cp=await env.DB.prepare('SELECT type,name,emoji,price_coins FROM sharika_bond_gifts '+
   'WHERE active=1 ORDER BY type,sort_order,id LIMIT 60').all();
  return json({gifts:cp.results||[],source:'verified_sharika_bond_catalog',read_only:true});
 }
 if(path==='/practice.js')return json({error:'practice_disabled_in_private_center'},404);
 if(path==='/api/catalog'){
  if(req.method!=='GET')return json({error:'method_not_allowed'},405);
  const originResult=await oldGameSite.fetch(req,env);
  if(!originResult.ok)return json({error:'catalog_unavailable'},503);
  const raw=await originResult.json(),shown=await catalog(env.DB);
  return json({games:(raw.games||[]).filter(x=>shown.has(x.id)),
   virtual_only:true,browser_demo:false,requires_sharika_app:true});
 }
 if(path.startsWith('/games/')){
  const entry=gameForPath(path);
  if(!entry&&/\.html$/i.test(path))return json({error:'unknown_game_entry'},404);
  if(entry){
   const active=await centerPublished(env.DB,'game',entry);
   const enabled=await env.DB.prepare('SELECT enabled FROM sharika_game_catalog WHERE id=?')
     .bind(entry).first();
   if(!active||enabled?.enabled!==1)return json({error:'game_hidden'},403);
  }
 }
 if(!['GET','HEAD'].includes(req.method))return json({error:'method_not_allowed'},405);
 const result=await oldGameSite.fetch(req,env);
 const h=new Headers(result.headers);
 Object.entries(hdr).forEach(([k,v])=>h.set(k,v));
 // The original public site's CSP was designed for demo only. Keep a strict
 // no-external-fetch policy on this private hosted frontend.
 h.set('cache-control','private,no-store');
 // An opaque-origin sandboxed iframe cannot use CSP 'self'. The original
 // static host's CSP names the OLD public game origin; replace it with this
 // private, authenticated origin or game scripts/styles will silently fail.
 const originalOrigin='https://sharika-games-web-staging.soverixnet.workers.dev';
 const policy=h.get('content-security-policy')||'';
 if(policy.includes(originalOrigin))
  h.set('content-security-policy',policy.replaceAll(originalOrigin,url.origin));
 return new Response(req.method==='HEAD'?null:result.body,{status:result.status,headers:h});
}};
