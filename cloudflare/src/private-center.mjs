// Sharika Private Center: authenticated, server-side publishing boundary.
// Explicitly shipped as STAGING-ONLY until all external game providers honor
// the same visibility policy. Never infer permissions from client flags.
const ALLOWED_KINDS=new Set(['game','ranking','event','module']);
const SAFE_KEY=/^[a-z][a-z0-9:-]{1,79}$/;
const corsNoStore={'cache-control':'private, no-store'};

function rows(value){return value?.results||[];}
function safeItem(row){return {
  id:row.id,kind:row.kind,title:row.title,
  sort_order:Number(row.sort_order)||0,
  ...(row.published===undefined?{}:{published:!!row.published})
};}
async function superAdmin(db,uid){
 const role=await db.prepare("SELECT role FROM sharika_admin_roles WHERE auth_uid=? AND role='super'")
   .bind(uid).first();
 return role?.role==='super';
}
async function bodyJson(request){
 if(Number(request.headers.get('content-length')||0)>4096)throw Error('request_too_large');
 const raw=await request.text();
 if(raw.length>4096)throw Error('request_too_large');
 let result;
 try{result=JSON.parse(raw)}catch(_){throw Error('invalid_json')}
 if(!result||Array.isArray(result)||typeof result!=='object')throw Error('invalid_json');
 return result;
}
export async function centerPublished(db,kind,id){
 if(!ALLOWED_KINDS.has(kind)||!SAFE_KEY.test(id||''))return false;
 const row=await db.prepare('SELECT published FROM sharika_center_publishing WHERE kind=? AND id=?')
  .bind(kind,id).first();
 return row?.published===1;
}
export async function handlePrivateCenter({request,path,db,uid,reply,fail,cors}){
 const send=(data,code=200)=>reply(data,code,{...cors,...corsNoStore});
 const deny=(msg,code=403)=>fail(msg,code,{...cors,...corsNoStore});
 if(!uid)return deny('not_authenticated',401);
 if(path==='/api/v1/center/manifest'&&request.method==='GET'){
  // No sensitive balance/admin data. Everything is an explicit server publication.
  const result=await db.prepare('SELECT p.id,p.kind,p.title,p.sort_order FROM sharika_center_publishing p '+
   'WHERE p.published=1 AND p.kind IN (\'game\',\'ranking\',\'module\') ORDER BY p.kind,p.sort_order,p.id').all();
  const active=rows(result).filter(item=>item.kind!=='game');
  const games=await db.prepare('SELECT p.id,p.kind,p.title,p.sort_order FROM sharika_center_publishing p '+
   'JOIN sharika_game_catalog c ON c.id=p.id AND c.enabled=1 '+
   "WHERE p.kind='game' AND p.published=1 ORDER BY p.sort_order,p.id").all();
  const now=new Date().toISOString();
  // Event-specific publishing is not enough: the global Event module must
  // also be enabled. Scheduled events are shown only if explicitly published.
  const eventsEnabled=active.some(item=>item.kind==='module'&&item.id==='events');
  const events=eventsEnabled?await db.prepare(
   'SELECT e.id,e.title,e.kind,e.description,e.starts_at,e.ends_at,e.banner_id,'+
   'e.prize_1,e.prize_2,e.prize_3,e.reward_labels_json,'+
   'CASE WHEN i.image_bytes>0 THEN i.version ELSE 0 END AS banner_version '+
   'FROM sharika_events e JOIN sharika_center_publishing p ON p.id=(\'event:\'||e.id) '+
   "AND p.kind='event' AND p.published=1 " +
   'LEFT JOIN sharika_banner_images i ON i.banner_id=e.banner_id '+
   "WHERE e.status='published' AND e.ends_at>? ORDER BY e.starts_at DESC LIMIT 30")
   .bind(now).all():{results:[]};
  return send({
   games:rows(games).map(safeItem),
   rankings:active.filter(x=>x.kind==='ranking').map(safeItem),
   modules:active.filter(x=>x.kind==='module').map(safeItem),
   events:rows(events).map(e=>({id:Number(e.id),title:e.title,kind:e.kind,
    description:e.description,starts_at:e.starts_at,ends_at:e.ends_at,
    status:e.starts_at>now?'scheduled':'live',
    banner_url:Number(e.banner_version)>0?'/api/center/events/'+Number(e.id)+'/banner?v='+Number(e.banner_version):null,
    prizes:[Number(e.prize_1)||0,Number(e.prize_2)||0,Number(e.prize_3)||0],
    reward_labels:(()=>{try{const a=JSON.parse(e.reward_labels_json||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string').slice(0,7):[]}catch(_){return []}})()})),
   issued_at:now,virtual_coins_only:true
  });
 }
 if(path==='/api/v1/center/launch-ticket'&&request.method==='POST'){
  // Android must first authenticate through its existing Firebase token.
  // The URL carries ONLY this one-time 90-second random ticket, never an ID token.
  const now=Date.now();
  const recent=await db.prepare('SELECT COUNT(*) AS n FROM sharika_center_launch_tickets '+
    'WHERE auth_uid=? AND created_at_ms>?').bind(uid,now-60000).first();
  if(Number(recent?.n||0)>=8)return deny('launch_ticket_rate_limited',429);
  const random=crypto.getRandomValues(new Uint8Array(32));
  const ticket=btoa(String.fromCharCode(...random))
   .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket));
  const hashed=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  await db.prepare('INSERT INTO sharika_center_launch_tickets('+
    'token_sha256,auth_uid,created_at_ms,expires_at_ms) VALUES(?,?,?,?)')
    .bind(hashed,uid,now,now+90000).run();
  return send({ticket,expires_in_seconds:90},201);
 }
 if(!path.startsWith('/api/v1/center/admin'))return deny('not_found',404);
 if(!await superAdmin(db,uid))return deny('admin_forbidden');
 if(path==='/api/v1/center/admin/state'&&request.method==='GET'){
  const [items,events,rules,engine]=await Promise.all([
   db.prepare('SELECT * FROM sharika_center_publishing ORDER BY kind,sort_order,id').all(),
   db.prepare('SELECT id,title,kind,status,starts_at,ends_at FROM sharika_events ORDER BY id DESC LIMIT 100').all(),
   db.prepare('SELECT game_id,win_rate_basis_points,target_rtp_basis_points,status,notes,changed_at FROM sharika_center_odds_drafts ORDER BY game_id').all(),
   db.prepare('SELECT id,enabled FROM sharika_game_catalog ORDER BY id').all()
  ]);
  return send({
   items:rows(items).map(safeItem),
   events:rows(events),
   odds_drafts:rows(rules),
   engine_games:rows(engine),
   notice:'Odds are drafts only until the game engine implements a verified published rule version.'
  });
 }
 if(path==='/api/v1/center/admin/visibility'&&request.method==='PATCH'){
  let body;try{body=await bodyJson(request)}catch(e){return deny(e.message,400)}
  const id=String(body.id||''),kind=String(body.kind||'');
  if(!ALLOWED_KINDS.has(kind)||!SAFE_KEY.test(id)||typeof body.published!=='boolean')
   return deny('invalid_publication',400);
  if(kind==='event'){
   const eventId=/^event:([1-9][0-9]{0,10})$/.exec(id);
   if(!eventId)return deny('invalid_event',400);
   const event=await db.prepare('SELECT id FROM sharika_events WHERE id=?')
    .bind(Number(eventId[1])).first();
   if(!event)return deny('event_not_found',404);
   await db.prepare("INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published) VALUES(?,'event',?,0)")
    .bind(id,'Event '+eventId[1]).run();
  }
  const existed=await db.prepare('SELECT id,kind,published FROM sharika_center_publishing WHERE id=? AND kind=?')
   .bind(id,kind).first();
  if(!existed)return deny('item_not_found',404);
  // Do not publish rankings without a verified data source. Admin may
  // prepare unsupported categories, but members must never see fake winners.
  if(kind==='ranking'&&body.published&&
      !['rich','charm','room','games','recharge','noble','lucky'].includes(id))
    return deny('ranking_source_not_ready',409);
  if(kind==='game'&&body.published){
   const ready=await db.prepare('SELECT enabled FROM sharika_game_catalog WHERE id=?')
    .bind(id).first();
   if(ready?.enabled!==1)return deny('game_engine_disabled',409);
  }
  await db.batch([
   db.prepare("UPDATE sharika_center_publishing SET published=?,updated_by=?,updated_at=datetime('now') WHERE id=? AND kind=?")
    .bind(body.published?1:0,uid,id,kind),
   db.prepare('INSERT INTO sharika_center_audit(actor_uid,action,target,details_json) VALUES(?,?,?,?)')
    .bind(uid,'visibility_update',kind+':'+id,JSON.stringify({from:!!existed.published,to:body.published}))
  ]);
  return send({id,kind,published:body.published,server_enforced:true});
 }
 if(path==='/api/v1/center/admin/odds-draft'&&request.method==='PATCH'){
  let body;try{body=await bodyJson(request)}catch(e){return deny(e.message,400)}
  const game_id=String(body.game_id||'');
  const win=body.win_rate_basis_points,rtp=body.target_rtp_basis_points;
  if(!SAFE_KEY.test(game_id)||!Number.isInteger(win)||win<0||win>10000||
      !Number.isInteger(rtp)||rtp<0||rtp>10000||
      typeof body.notes!=='string'||body.notes.length>500)
   return deny('invalid_odds_draft',400);
  const game=await db.prepare('SELECT id FROM sharika_game_catalog WHERE id=?').bind(game_id).first();
  if(!game)return deny('game_not_found',404);
  // Important: no hidden probability changes. Enabling new odds requires
  // a versioned engine adapter, disclosure, full payout QA and round isolation.
  await db.batch([
   db.prepare("INSERT INTO sharika_center_odds_drafts(game_id,win_rate_basis_points,target_rtp_basis_points,notes,changed_by) "+
    "VALUES(?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET "+
    "win_rate_basis_points=excluded.win_rate_basis_points,target_rtp_basis_points=excluded.target_rtp_basis_points,"+
    "notes=excluded.notes,changed_by=excluded.changed_by,changed_at=datetime('now')")
    .bind(game_id,win,rtp,body.notes,uid),
   db.prepare('INSERT INTO sharika_center_audit(actor_uid,action,target,details_json) VALUES(?,?,?,?)')
    .bind(uid,'odds_draft_update',game_id,JSON.stringify({win_rate_basis_points:win,target_rtp_basis_points:rtp}))
  ]);
  return send({game_id,status:'pending_engine_adapter',applied_to_live_games:false,
   notice:'Saved as a draft. Current game odds and active rounds remain unchanged.'});
 }
 return deny('center_route_not_found',404);
}