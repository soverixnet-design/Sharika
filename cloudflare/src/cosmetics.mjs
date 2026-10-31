// Server-owned paid cosmetics. Never trust client-side "owned" style flags.
const KINDS=new Set(['frame_style','entry_style','medal_style','name_tag_style']);
const KEYS={
 frame_style:new Set(['phoenix-fire','ice-wings','royal-dragon','vip7','royal-gold','violet-love','ice-admin','golden-dragon','ice-dragon','violet-phoenix','castle-flag','lion-queen','phoenix-queen','tiger-queen']),
 entry_style:new Set(['phoenix','dragon-queen','ice-king','castle-flag','lion-queen','phoenix-queen','tiger-queen']),
 medal_style:new Set(['bronze','silver','gold','top-host']),
 name_tag_style:new Set(['legend'])
};
const ID=/^[a-z0-9][a-z0-9-]{2,39}$/;
const TX=/^[a-zA-Z0-9:_-]{12,80}$/;
const PUBLIC=/^[0-9]{8}$/;
const safeAmount=x=>Number.isSafeInteger(x)&&x>=1&&x<=1000000;
const values=x=>x?.results||[];
const invalid=(fail,cors)=>fail('invalid_cosmetic_request',400,cors);
export async function readEquipped(db,uid){
 let rows;
 try{rows=values(await db.prepare('SELECT kind,item_id FROM sharika_cosmetic_equipped WHERE auth_uid=?')
  .bind(uid).all());}
 catch(error){if(/no such table:\s*sharika_cosmetic_equipped/i.test(String(error?.message||error)))
  return {};throw error;}
 return Object.fromEntries(rows.filter(row=>KINDS.has(row.kind))
   .map(row=>[row.kind,row.item_id?row.item_id.split(':').slice(1).join(':'):'']));
}
export async function readRoomEquipped(db,roomId){
 let rows;
 try{rows=values(await db.prepare(
  'SELECT e.auth_uid,e.kind,e.item_id FROM sharika_cosmetic_equipped e '+
  'JOIN sharika_room_members m ON m.user_id=e.auth_uid WHERE m.room_id=?'
 ).bind(roomId).all());}
 catch(error){if(/no such table:\s*sharika_cosmetic_equipped/i.test(String(error?.message||error)))
  return new Map();throw error;}
 const map=new Map();
 for(const row of rows){
  if(!KINDS.has(row.kind))continue;
  if(!map.has(row.auth_uid))map.set(row.auth_uid,{});
  map.get(row.auth_uid)[row.kind]=row.item_id?row.item_id.split(':').slice(1).join(':'):'';
 }
 return map;
}
async function stock(db,uid,all=false){
 const list=values(await db.prepare(
  'SELECT c.id,c.kind,c.name,c.art_key,c.price_coins,c.active,'+
  'CASE WHEN i.item_id IS NULL THEN 0 ELSE 1 END AS owned,'+
  'CASE WHEN e.item_id=c.id THEN 1 ELSE 0 END AS equipped '+
  'FROM sharika_cosmetics_catalog c '+
  'LEFT JOIN sharika_cosmetic_inventory i ON i.item_id=c.id AND i.auth_uid=? '+
  'LEFT JOIN sharika_cosmetic_equipped e ON e.auth_uid=? AND e.kind=c.kind '+
  (all?'':'WHERE c.active=1 OR i.item_id IS NOT NULL ')+
  'ORDER BY c.kind,c.name'
 ).bind(uid,uid).all());
 return list.map(x=>({...x,owned:!!x.owned,equipped:!!x.equipped,active:!!x.active}));
}
export async function handleCosmeticApp({request,db,uid,path,readBody,reply,fail,cors}){
 if(path==='/api/v1/cosmetics'&&request.method==='GET')
  return reply({items:await stock(db,uid,true)},200,cors);
 if(path==='/api/v1/cosmetics/purchase'&&request.method==='POST'){
  const body=await readBody(request);
  const itemId=body.item_id,requestId=body.request_id;
  if(typeof itemId!=='string'||itemId.length>70||
     typeof requestId!=='string'||!TX.test(requestId))return invalid(fail,cors);
  const prior=await db.prepare(
   'SELECT item_id,request_id FROM sharika_cosmetic_inventory WHERE auth_uid=? AND (item_id=? OR request_id=?)'
  ).bind(uid,itemId,'purchase:'+requestId).first();
  if(prior)return prior.item_id===itemId?
   reply({owned:true,duplicate:true,item_id:itemId},200,cors):
   fail('idempotency_conflict',409,cors);
  const item=await db.prepare('SELECT id,price_coins,active FROM sharika_cosmetics_catalog WHERE id=?')
   .bind(itemId).first();
  if(!item||!item.active)return fail('cosmetic_unavailable',404,cors);
  const user=await db.prepare('SELECT coins,status FROM sharika_users WHERE auth_uid=?').bind(uid).first();
  if(!user||user.status!=='active')return fail('profile_unavailable',403,cors);
  if(user.coins<item.price_coins)return fail('insufficient_coins',409,cors);
  const debit=Number(item.price_coins);
  try{
   await db.batch([
    db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins>=? THEN coins-? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
     .bind(debit,debit,uid),
    db.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id) VALUES(?,?,'purchase',?)")
     .bind(uid,itemId,'purchase:'+requestId),
    db.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'cosmetic_purchase',?)")
     .bind(uid,-debit,uid,'cosmetic:'+requestId)
   ]);
  }catch(error){
   if(/CONSTRAINT|constraint/i.test(String(error?.message||error)))
    return fail('cosmetic_purchase_conflict_or_balance_changed',409,cors);
   throw error;
  }
  const wallet=await db.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').bind(uid).first();
  return reply({owned:true,duplicate:false,item_id:itemId,spent_coins:debit,coins:wallet.coins},201,cors);
 }
 if(path==='/api/v1/cosmetics/equip'&&request.method==='POST'){
  const body=await readBody(request);
  const kind=body.kind,itemId=body.item_id;
  if(!KINDS.has(kind)||typeof itemId!=='string'||itemId.length>70)
   return invalid(fail,cors);
  if(itemId){
   const owns=await db.prepare(
    'SELECT c.id FROM sharika_cosmetics_catalog c '+
    'JOIN sharika_cosmetic_inventory i ON i.item_id=c.id '+
    'WHERE c.id=? AND c.kind=? AND i.auth_uid=?'
   ).bind(itemId,kind,uid).first();
   if(!owns)return fail('cosmetic_not_owned',403,cors);
  }
  await db.prepare(
   'INSERT INTO sharika_cosmetic_equipped(auth_uid,kind,item_id) VALUES(?,?,?) '+
   "ON CONFLICT(auth_uid,kind) DO UPDATE SET item_id=excluded.item_id,equipped_at=datetime('now')"
  ).bind(uid,kind,itemId||null).run();
  return reply({equipped:await readEquipped(db,uid),item_id:itemId},200,cors);
 }
 return null;
}
export async function handleCosmeticAdmin({request,db,uid,role,path,readBody,reply,fail,cors}){
 if(path!=='/api/v1/admin/cosmetics'&&path!=='/api/v1/admin/cosmetics/grant')return null;
 if(role!=='super')return fail('admin_permission_denied',403,cors);
 if(path.endsWith('/grant')&&request.method==='POST'){
  const body=await readBody(request);
  if(typeof body.public_id!=='string'||!PUBLIC.test(body.public_id)||
     typeof body.item_id!=='string'||body.item_id.length>70)return invalid(fail,cors);
  const target=await db.prepare(
   "SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'"
  ).bind(Number(body.public_id)).first();
  if(!target)return fail('target_user_not_found',404,cors);
  const item=await db.prepare('SELECT id FROM sharika_cosmetics_catalog WHERE id=?')
   .bind(body.item_id).first();
  if(!item)return fail('cosmetic_unavailable',404,cors);
  const existing=await db.prepare(
   'SELECT 1 AS found FROM sharika_cosmetic_inventory WHERE auth_uid=? AND item_id=?'
  ).bind(target.auth_uid,item.id).first();
  if(existing)return reply({granted:true,duplicate:true,public_id:body.public_id,item_id:item.id},200,cors);
  await db.batch([
   db.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id) VALUES(?,?,'admin_grant',?)")
    .bind(target.auth_uid,item.id,'grant:'+item.id),
   db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
    .bind(uid,'cosmetic_grant',JSON.stringify({public_id:body.public_id,item_id:item.id}))
  ]);
  return reply({granted:true,duplicate:false,public_id:body.public_id,item_id:item.id},201,cors);
 }
 if(path.endsWith('/grant'))return fail('admin_method_not_allowed',405,cors);
 if(request.method==='GET')return reply({items:await stock(db,uid,true)},200,cors);
 if(!['POST','PATCH'].includes(request.method))return fail('admin_method_not_allowed',405,cors);
 const body=await readBody(request);
 const kind=body.kind,art=body.art_key,name=body.name,price=body.price_coins;
 if(!KINDS.has(kind)||!KEYS[kind].has(art)||typeof name!=='string'||
    !name.trim()||name.trim().length>80||!safeAmount(price))
  return invalid(fail,cors);
 if(request.method==='POST'){
  if(typeof body.slug!=='string'||!ID.test(body.slug))return invalid(fail,cors);
  const itemId=kind+':'+body.slug;
  try{
   await db.batch([
    db.prepare("INSERT INTO sharika_cosmetics_catalog(id,kind,name,art_key,price_coins,active) VALUES(?,?,?,?,?,1)")
     .bind(itemId,kind,name.trim(),art,price),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
     .bind(uid,'cosmetic_catalog_add',JSON.stringify({item_id:itemId,price_coins:price,art_key:art}))
   ]);
  }catch(error){if(/CONSTRAINT|constraint/i.test(String(error?.message||error)))
    return fail('cosmetic_id_exists',409,cors);throw error;}
  return reply({item_id:itemId,created:true},201,cors);
 }
 if(typeof body.item_id!=='string'||body.item_id.length>70||typeof body.active!=='boolean')
  return invalid(fail,cors);
 const old=await db.prepare('SELECT * FROM sharika_cosmetics_catalog WHERE id=? AND kind=?')
  .bind(body.item_id,kind).first();
 if(!old)return fail('cosmetic_unavailable',404,cors);
 await db.batch([
  db.prepare("UPDATE sharika_cosmetics_catalog SET name=?,art_key=?,price_coins=?,active=?,updated_at=datetime('now') WHERE id=?")
   .bind(name.trim(),art,price,body.active?1:0,old.id),
  db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
   .bind(uid,'cosmetic_catalog_update',JSON.stringify({
    item_id:old.id,old_price:old.price_coins,new_price:price,active:body.active,art_key:art
   }))
 ]);
 return reply({item_id:old.id,updated:true},200,cors);
}
