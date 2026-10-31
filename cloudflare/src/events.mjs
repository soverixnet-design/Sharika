// Server-verified, Super-Admin-controlled staging events and one-time coin prizes.
// Publication is separate from payment; only an ended published event can pay a rank.
// Winners are selected explicitly by Super Admin and every credit has a D1 receipt + ledger.
const PUBLIC_ID=/^[0-9]{8}$/;
const KINDS=new Set(['gift_race','room_battle','recharge_bonus','game_tournament',
  'invite_campaign','checkin_festival','festival','custom']);
const STATUSES=new Set(['draft','published','cancelled']);
const MAX_BALANCE=1_000_000_000_000;
const ID_RE=/^[a-zA-Z0-9:_-]{12,80}$/;
const pad=n=>String(n).padStart(8,'0');
const rows=r=>r?.results||[];
function eventDto(row,awards,now){
  const status=row.status!=='published'?row.status:
    row.starts_at>now?'scheduled':row.ends_at>now?'live':'ended';
  return {id:Number(row.id),title:row.title,kind:row.kind,description:row.description,
    starts_at:row.starts_at,ends_at:row.ends_at,status,published:row.status==='published',
    prizes:[Number(row.prize_1),Number(row.prize_2),Number(row.prize_3)],
    awards:awards.filter(a=>Number(a.event_id)===Number(row.id)).map(a=>({
      rank:Number(a.rank),coins:Number(a.coins),public_id:pad(a.public_no),
      name:a.name,created_at:a.created_at
    })),locked:awards.some(a=>Number(a.event_id)===Number(row.id))};
}
export function validEventPayload(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  const title=body.title,description=body.description;
  if(typeof title!=='string'||title.trim().length<3||title.trim().length>100||
    typeof description!=='string'||description.trim().length>1000||
    !KINDS.has(body.kind)||!STATUSES.has(body.status))return false;
  if(typeof body.starts_at!=='string'||typeof body.ends_at!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.starts_at)||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.ends_at))return false;
  const start=new Date(body.starts_at),end=new Date(body.ends_at);
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||
    start.toISOString()!==body.starts_at||end.toISOString()!==body.ends_at||
    end<=start||end-start>366*86400000)return false;
  return Array.isArray(body.prizes)&&body.prizes.length===3&&
    body.prizes.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000)&&
    body.prizes.some(n=>n>0);
}
async function parseBody(request,max=4096){
  const raw=await request.text();
  if(raw.length>max)throw Error('body_too_large');
  const value=JSON.parse(raw||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_body');
  return value;
}
export async function listEventData(db,admin=false,now=new Date()){
  const boundary=new Date(now.getTime()-30*86400000).toISOString();
  let statement=db.prepare(
    'SELECT id,title,kind,description,starts_at,ends_at,status,prize_1,prize_2,prize_3 '+
    'FROM sharika_events '+(admin?'':'WHERE status=? AND ends_at>=? ')+
    'ORDER BY starts_at DESC,id DESC LIMIT 60');
  if(!admin)statement=statement.bind('published',boundary);
  const events=rows(await statement.all());
  if(!events.length)return {events:[],server_time:now.toISOString()};
  const minId=Math.min(...events.map(e=>Number(e.id)));
  const prizeRows=rows(await db.prepare(
    'SELECT a.event_id,a.rank,a.coins,a.created_at,u.public_no,u.name '+
    'FROM sharika_event_awards a JOIN sharika_users u ON u.auth_uid=a.auth_uid '+
    'WHERE a.event_id>=? ORDER BY a.event_id DESC,a.rank ASC LIMIT 200'
  ).bind(minId).all());
  const eventIds=new Set(events.map(e=>Number(e.id)));
  const relevant=prizeRows.filter(a=>eventIds.has(Number(a.event_id)));
  return {events:events.map(e=>eventDto(e,relevant,now.toISOString())),
    server_time:now.toISOString()};
}
export async function handleEventApp({request,env,uid,path,cors,reply,fail}){
  if(path!=='/api/v1/events')return null;
  if(request.method!=='GET')return fail('events_method_not_allowed',405,cors);
  const active=await env.DB.prepare(
    'SELECT public_no FROM sharika_users WHERE auth_uid=? AND status=?'
  ).bind(uid,'active').first();
  if(!active)return fail('profile_unavailable',403,cors);
  return reply(await listEventData(env.DB,false),200,cors);
}
export async function handleEventAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(!/^events(?:\/\d+(?:\/award)?)?$/.test(operation))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='events'&&request.method==='GET')
    return reply({...await listEventData(db,true),read_only:actor.role!=='super'},200,cors);
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='events'&&request.method==='POST'){
    let body;try{body=await parseBody(request);}catch(_){return fail('invalid_event_json',400,cors);}
    if(!validEventPayload(body))return fail('invalid_event_fields',400,cors);
    const result=await db.batch([
      db.prepare('INSERT INTO sharika_events '+
        '(title,kind,description,starts_at,ends_at,status,prize_1,prize_2,prize_3,created_by,updated_by) '+
        'VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .bind(body.title.trim(),body.kind,body.description.trim(),body.starts_at,body.ends_at,
          body.status,...body.prizes,uid,uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'event_created',?)")
        .bind(uid,JSON.stringify({title:body.title.trim(),kind:body.kind,status:body.status}))
    ]);
    return reply({created:true,id:Number(result[0]?.meta?.last_row_id)||null},201,cors);
  }
  const patch=/^events\/([1-9]\d*)$/.exec(operation);
  if(patch&&request.method==='PATCH'){
    let body;try{body=await parseBody(request);}catch(_){return fail('invalid_event_json',400,cors);}
    if(!validEventPayload(body))return fail('invalid_event_fields',400,cors);
    const id=Number(patch[1]);
    const existing=await db.prepare('SELECT id FROM sharika_events WHERE id=?').bind(id).first();
    if(!existing)return fail('event_not_found',404,cors);
    const paid=await db.prepare('SELECT id FROM sharika_event_awards WHERE event_id=? LIMIT 1').bind(id).first();
    if(paid)return fail('awarded_event_locked',409,cors);
    try{
      await db.batch([
        db.prepare('UPDATE sharika_events SET title=?,kind=?,description=?,starts_at=?,ends_at=?,'+
          "status=?,prize_1=?,prize_2=?,prize_3=?,updated_by=?,updated_at=datetime('now') "+
          'WHERE id=?')
          .bind(body.title.trim(),body.kind,body.description.trim(),body.starts_at,body.ends_at,
            body.status,...body.prizes,uid,id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
          "VALUES(?,'event_updated',?)").bind(uid,JSON.stringify({event_id:id,status:body.status,prizes:body.prizes}))
      ]);
    }catch(error){
      if(String(error?.message||'').includes('awarded_event_locked'))return fail('awarded_event_locked',409,cors);
      throw error;
    }
    return reply({updated:true,id},200,cors);
  }
  const award=/^events\/([1-9]\d*)\/award$/.exec(operation);
  if(award&&request.method==='POST'){
    let body;try{body=await parseBody(request,1024);}catch(_){return fail('invalid_event_json',400,cors);}
    const eventId=Number(award[1]),rank=body.rank,publicId=body.public_id,requestId=body.request_id;
    if(!Number.isSafeInteger(rank)||rank<1||rank>3||
      typeof publicId!=='string'||!PUBLIC_ID.test(publicId)||
      typeof requestId!=='string'||!ID_RE.test(requestId))
      return fail('invalid_event_award',400,cors);
    const event=await db.prepare('SELECT id,status,starts_at,ends_at,prize_1,prize_2,prize_3 '+
      'FROM sharika_events WHERE id=?').bind(eventId).first();
    if(!event)return fail('event_not_found',404,cors);
    if(event.status!=='published'||Date.now()<Date.parse(event.ends_at))
      return fail('event_not_ended',409,cors);
    const coins=Number(event['prize_'+rank]);
    if(!Number.isSafeInteger(coins)||coins<1)return fail('event_rank_unrewarded',409,cors);
    const old=await db.prepare(
      'SELECT a.id,u.public_no,a.coins FROM sharika_event_awards a '+
      'JOIN sharika_users u ON u.auth_uid=a.auth_uid WHERE a.event_id=? AND a.rank=?'
    ).bind(eventId,rank).first();
    if(old){
      return Number(old.public_no)===Number(publicId)
        ?reply({duplicate:true,award_id:old.id,rank,public_id:pad(old.public_no),coins:Number(old.coins)},200,cors)
        :fail('event_rank_already_awarded',409,cors);
    }
    const recipient=await db.prepare(
      'SELECT auth_uid,coins FROM sharika_users WHERE public_no=? AND status=?'
    ).bind(Number(publicId),'active').first();
    if(!recipient)return fail('event_recipient_not_found',404,cors);
    const prior=await db.prepare('SELECT id FROM sharika_event_awards WHERE event_id=? AND auth_uid=?')
      .bind(eventId,recipient.auth_uid).first();
    if(prior)return fail('event_user_already_awarded',409,cors);
    if(Number(recipient.coins)>MAX_BALANCE-coins)return fail('wallet_balance_limit',409,cors);
    try{
      await db.batch([
        db.prepare('INSERT INTO sharika_event_awards '+
          '(event_id,rank,auth_uid,coins,request_id,granted_by) VALUES(?,?,?,?,?,?)')
          .bind(eventId,rank,recipient.auth_uid,coins,requestId,uid),
        db.prepare("UPDATE sharika_users SET coins=CASE WHEN status=\'active\' AND coins<=? "+
          "THEN coins+? ELSE -1 END,updated_at=datetime(\'now\') WHERE auth_uid=?")
          .bind(MAX_BALANCE-coins,coins,recipient.auth_uid),
        db.prepare('INSERT INTO sharika_wallet_ledger '+
          '(auth_uid,currency,delta,balance_after,reason,request_id) '+
          "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'event_reward',?)")
          .bind(recipient.auth_uid,coins,recipient.auth_uid,'event:'+eventId+':rank:'+rank),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
          "VALUES(?,'event_prize_awarded',?)").bind(uid,JSON.stringify({
            event_id:eventId,rank,public_id:publicId,coins,request_id:requestId}))
      ]);
    }catch(error){
      const committed=await db.prepare('SELECT a.id,a.coins,u.public_no '+
        'FROM sharika_event_awards a JOIN sharika_users u ON u.auth_uid=a.auth_uid '+
        'WHERE a.event_id=? AND a.rank=?').bind(eventId,rank).first();
      if(committed&&Number(committed.public_no)===Number(publicId))
        return reply({duplicate:true,award_id:committed.id,rank,public_id:publicId,
          coins:Number(committed.coins)},200,cors);
      if(committed)return fail('event_rank_already_awarded',409,cors);
      throw error;
    }
    const receipt=await db.prepare('SELECT id FROM sharika_event_awards WHERE event_id=? AND rank=?')
      .bind(eventId,rank).first();
    return reply({awarded:true,award_id:receipt?.id,rank,public_id:publicId,coins},201,cors);
  }
  return fail('event_method_not_allowed',405,cors);
}
