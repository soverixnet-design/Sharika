// Server-owned game visibility. Only bundled, verified game engines may be enabled.
// Turning a game off rejects NEW bets but never interrupts historical settlement.
export const GAME_DEFINITIONS=Object.freeze([
  {id:'sovera-food',name:'Sovera Food Wheel',engine:'original'},
  {id:'night-food',name:'Night Food Wheel',engine:'original'},
  {id:'jackpot-fruit',name:'Jackpot Fruit',engine:'original/legacy'},
  {id:'fruit-royale',name:'Fruit Royale V2',engine:'fruit-royale'},
  {id:'greedy-wheel',name:'Greedy Wheel',engine:'greedy'},
  {id:'food-wheel',name:'Food Wheel (legacy)',engine:'legacy'}
]);
const GAME_IDS=new Set(GAME_DEFINITIONS.map(game=>game.id));

export async function readGameCatalog(db){
  const result=await db.prepare(
    'SELECT id,enabled FROM sharika_game_catalog ORDER BY id'
  ).all();
  const state=new Map((result?.results||[]).map(row=>[row.id,Number(row.enabled)===1]));
  return GAME_DEFINITIONS.map(game=>({...game,enabled:state.get(game.id)!==false}));
}

export async function gameAcceptsBets(db,id){
  if(!GAME_IDS.has(id))return false;
  const state=await db.prepare(
    'SELECT enabled FROM sharika_game_catalog WHERE id=?'
  ).bind(id).first();
  return !state||state.enabled===undefined||Number(state.enabled)===1;
}

export async function handleGameCatalogAdmin({request,db,uid,role,reply,fail,cors}){
  if(!['super','finance'].includes(role))return fail('admin_permission_denied',403,cors);
  if(request.method==='GET')
    return reply({games:await readGameCatalog(db),read_only:role!=='super'},200,cors);
  if(request.method!=='PATCH')return fail('game_catalog_method_not_allowed',405,cors);
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>512)return fail('game_catalog_body_too_large',413,cors);
    body=JSON.parse(raw||'{}');
  }catch{return fail('invalid_game_catalog_json',400,cors);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
      !GAME_IDS.has(body.id)||typeof body.enabled!=='boolean')
    return fail('invalid_game_catalog_update',400,cors);
  const changed=await db.batch([
    db.prepare("UPDATE sharika_game_catalog SET enabled=?,updated_at=datetime('now') WHERE id=?")
      .bind(body.enabled?1:0,body.id),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'game_catalog_toggle',JSON.stringify({game_id:body.id,enabled:body.enabled}))
  ]);
  return reply({updated:true,id:body.id,enabled:body.enabled,
    audited:true,changes:changed?.[0]?.meta?.changes??null},200,cors);
}
