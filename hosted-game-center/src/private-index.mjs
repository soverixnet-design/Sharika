// Private Sharika Game Center staging worker. Separate from existing public
// game website until the authenticated Android launch flow is tested.
import oldGameSite from './index.mjs';
import {handlePrivateCenter,centerPublished} from '../../cloudflare/src/private-center.mjs';
import {readGiftRankings} from '../../cloudflare/src/admin.mjs';
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
  return new Response(null,{status:303,headers:{
   ...hdr,'location':url.origin+'/?surface=app',
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
 if(path.startsWith('/api/center/')&&
    !['/api/center/rankings','/api/center/wallet','/api/center/gifts'].includes(path)){
  if(req.method!=='GET'&&!sameOriginWrite(req,url))
    return json({error:'origin_forbidden'},403);
  const sub='/api/v1/center/'+path.slice('/api/center/'.length);
  const allowed=sub==='/api/v1/center/manifest'||sub==='/api/v1/center/admin/state'||
   sub==='/api/v1/center/admin/visibility'||sub==='/api/v1/center/admin/odds-draft';
  if(!allowed)return json({error:'route_not_allowed'},404);
  // The authenticated user comes exclusively from a server-created session.
  return handlePrivateCenter({request:req,path:sub,db:env.DB,uid,
    reply:(data,status,cors)=>new Response(JSON.stringify(data),{status,
      headers:{...hdr,...cors,'content-type':'application/json; charset=utf-8'}}),
    fail:(error,status,cors)=>new Response(JSON.stringify({error}),{status,
      headers:{...hdr,...cors,'content-type':'application/json; charset=utf-8'}}),cors:{}});
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
 return new Response(req.method==='HEAD'?null:result.body,{status:result.status,headers:h});
}};
