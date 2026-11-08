import {notifyUser,deliverNotification} from './notifications.mjs';
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
const safeJson=(raw,fallback=[])=>{try{const value=JSON.parse(raw||'[]');return Array.isArray(value)?value:fallback;}catch(_){return fallback;}};
async function settledEventRanking(db,event,limit=100){
  const rules=safeJson(event.gift_rules_json).filter(r=>Number.isSafeInteger(r.gift_id)&&
    Number.isSafeInteger(r.points)&&r.points>0);
  if(!rules.length)return [];
  const start=event.starts_at.slice(0,19).replace('T',' ');
  const end=event.ends_at.slice(0,19).replace('T',' ');
  const matches=rules.map(()=>'?').join(',');
  const weights=rules.map(()=> 'WHEN ? THEN ?').join(' ');
  const weightsArgs=rules.flatMap(r=>[r.gift_id,r.points]);
  const query='SELECT u.public_no,u.name,u.pic,COUNT(g.id) AS gift_count,'+
    'SUM(g.quantity * CASE g.gift_id '+weights+' ELSE 0 END) AS points '+
    'FROM sharika_gift_events g JOIN sharika_users u ON u.auth_uid=g.sender_uid '+
    'WHERE g.gift_id IN ('+matches+') AND g.created_at>=? AND g.created_at<? '+
    "AND u.status='active' GROUP BY g.sender_uid ORDER BY points DESC,gift_count DESC,"+
    'u.public_no ASC LIMIT '+(limit===3?3:100);
  return rows(await db.prepare(query)
    .bind(...weightsArgs,...rules.map(r=>r.gift_id),start,end).all());
}
function validCampaign(body){
  if(body.banner_id!==undefined&&body.banner_id!==null&&
    (!Number.isSafeInteger(body.banner_id)||body.banner_id<0||body.banner_id>999999999))return false;
  if(body.gift_rules!==undefined&&(!Array.isArray(body.gift_rules)||body.gift_rules.length>12||
    body.gift_rules.some(r=>!r||!Number.isSafeInteger(r.gift_id)||r.gift_id<1||
      !Number.isSafeInteger(r.points)||r.points<1||r.points>1000000)||
    new Set(body.gift_rules.map(r=>r.gift_id)).size!==body.gift_rules.length))return false;
  if(body.reward_labels!==undefined&&(!Array.isArray(body.reward_labels)||
    body.reward_labels.length!==7||body.reward_labels.some(label=>
      typeof label!=='string'||label.length>80)))return false;
  return true;
}
async function validateCampaignReferences(db,body){
  if(body.banner_id!=null&&body.banner_id!==0){
    const banner=await db.prepare('SELECT id FROM sharika_banners WHERE id=?')
      .bind(body.banner_id).first();
    if(!banner)return 'event_banner_not_found';
  }
  for(const rule of body.gift_rules||[]){
    const gift=await db.prepare('SELECT id FROM sharika_gifts WHERE id=? AND tab IN (0,1)')
      .bind(rule.gift_id).first();
    if(!gift)return 'event_gift_not_found';
  }
  return null;
}
function eventDto(row,awards,now){
  const status=row.status!=='published'?row.status:
    row.starts_at>now?'scheduled':row.ends_at>now?'live':'ended';
  return {id:Number(row.id),title:row.title,kind:row.kind,description:row.description,
    starts_at:row.starts_at,ends_at:row.ends_at,status,published:row.status==='published',
    prizes:[Number(row.prize_1),Number(row.prize_2),Number(row.prize_3)],
    gift_rules:safeJson(row.gift_rules_json),reward_labels:safeJson(row.reward_labels_json),
    banner_id:row.banner_id==null?null:Number(row.banner_id),
    banner_image_url:row.banner_image_version>0&&row.banner_id!=null?
      '/api/v1/banners/'+Number(row.banner_id)+'/image?v='+Number(row.banner_image_version):null,
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
  return validCampaign(body)&&Array.isArray(body.prizes)&&body.prizes.length===3&&
    body.prizes.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000)&&
    !!(body.prizes.some(n=>n>0)||body.reward_labels?.some(label=>label.trim()));
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
    'SELECT e.id,e.title,e.kind,e.description,e.starts_at,e.ends_at,e.status,'+
    'e.prize_1,e.prize_2,e.prize_3,e.banner_id,e.gift_rules_json,e.reward_labels_json,'+
    'CASE WHEN i.image_bytes>0 THEN i.version ELSE 0 END AS banner_image_version '+
    'FROM sharika_events e LEFT JOIN sharika_banner_images i ON i.banner_id=e.banner_id '+
    (admin?'':'WHERE e.status=? AND e.ends_at>=? ')+
    'ORDER BY e.starts_at DESC,e.id DESC LIMIT 60');
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
  const leaderboard=/^\/api\/v1\/events\/([1-9]\d*)\/ranking$/.exec(path);
  if(path!=='/api/v1/events'&&!leaderboard)return null;
  if(request.method!=='GET')return fail('events_method_not_allowed',405,cors);
  const active=await env.DB.prepare(
    'SELECT public_no FROM sharika_users WHERE auth_uid=? AND status=?'
  ).bind(uid,'active').first();
  if(!active)return fail('profile_unavailable',403,cors);
  if(leaderboard){
    const event=await env.DB.prepare('SELECT id,title,starts_at,ends_at,status,gift_rules_json '+
      'FROM sharika_events WHERE id=?').bind(Number(leaderboard[1])).first();
    if(!event||event.status!=='published')return fail('event_unavailable',404,cors);
    const ranked=await settledEventRanking(env.DB,event);
    return reply({event_id:event.id,ranking:ranked.map((r,i)=>({rank:i+1,
      public_id:pad(r.public_no),name:r.name,pic:r.pic||null,
      points:Number(r.points)||0,gift_count:Number(r.gift_count)||0})),
      scoring:'selected_settled_gifts',server_time:new Date().toISOString()},200,cors);
  }
  return reply(await listEventData(env.DB,false),200,cors);
}
async function announceEvent(env,ctx,id,title,actorUid){
  const members=await env.DB.prepare(
    "SELECT auth_uid FROM sharika_users WHERE status='active' ORDER BY public_no LIMIT 500"
  ).all();
  for(const member of members.results||[]){
    try{
      const notice=await notifyUser(env.DB,{recipientUid:member.auth_uid,
        kind:'event',title:'New Sharika event',body:String(title).slice(0,100),
        dedupeKey:'event-published:'+id,createdBy:actorUid});
      if(notice.created&&notice.notification)
        ctx?.waitUntil(deliverNotification(env,notice.notification));
    }catch(error){console.error('event_notice_failed',String(error.message||error));}
  }
}
export async function handleEventAdmin({request,env,uid,actor,operation,cors,reply,fail,ctx}){
  if(!/^events(?:\/\d+(?:\/award)?)?$/.test(operation))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='events'&&request.method==='GET')
    return reply({...await listEventData(db,true),read_only:actor.role!=='super'},200,cors);
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='events'&&request.method==='POST'){
    let body;try{body=await parseBody(request);}catch(_){return fail('invalid_event_json',400,cors);}
    if(!validEventPayload(body))return fail('invalid_event_fields',400,cors);
    const invalidReference=await validateCampaignReferences(db,body);
    if(invalidReference)return fail(invalidReference,400,cors);
    const result=await db.batch([
      db.prepare('INSERT INTO sharika_events '+
        '(title,kind,description,starts_at,ends_at,status,prize_1,prize_2,prize_3,'+
        'banner_id,gift_rules_json,reward_labels_json,created_by,updated_by) '+
        'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(body.title.trim(),body.kind,body.description.trim(),body.starts_at,body.ends_at,
          body.status,...body.prizes,body.banner_id||null,JSON.stringify(body.gift_rules||[]),
          JSON.stringify(body.reward_labels||[]),uid,uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'event_created',?)")
        .bind(uid,JSON.stringify({title:body.title.trim(),kind:body.kind,status:body.status}))
    ]);
    const newId=Number(result[0]?.meta?.last_row_id)||null;
    if(newId&&body.status==='published')await announceEvent(env,ctx,newId,body.title.trim(),uid);
    return reply({created:true,id:newId},201,cors);
  }
  const patch=/^events\/([1-9]\d*)$/.exec(operation);
  if(patch&&request.method==='PATCH'){
    let body;try{body=await parseBody(request);}catch(_){return fail('invalid_event_json',400,cors);}
    if(!validEventPayload(body))return fail('invalid_event_fields',400,cors);
    const invalidReference=await validateCampaignReferences(db,body);
    if(invalidReference)return fail(invalidReference,400,cors);
    const id=Number(patch[1]);
    const existing=await db.prepare('SELECT id,status FROM sharika_events WHERE id=?').bind(id).first();
    if(!existing)return fail('event_not_found',404,cors);
    const paid=await db.prepare('SELECT id FROM sharika_event_awards WHERE event_id=? LIMIT 1').bind(id).first();
    if(paid)return fail('awarded_event_locked',409,cors);
    try{
      await db.batch([
        db.prepare('UPDATE sharika_events SET title=?,kind=?,description=?,starts_at=?,ends_at=?,'+
          'status=?,prize_1=?,prize_2=?,prize_3=?,'+
          'banner_id=CASE WHEN ?=0 THEN NULL ELSE COALESCE(?,banner_id) END,'+
          'gift_rules_json=COALESCE(?,gift_rules_json),'+
          "reward_labels_json=COALESCE(?,reward_labels_json),updated_by=?,updated_at=datetime('now') "+
          'WHERE id=?')
          .bind(body.title.trim(),body.kind,body.description.trim(),body.starts_at,body.ends_at,
            body.status,...body.prizes,body.banner_id??null,body.banner_id??null,
            body.gift_rules===undefined?null:JSON.stringify(body.gift_rules),
            body.reward_labels===undefined?null:JSON.stringify(body.reward_labels),uid,id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
          "VALUES(?,'event_updated',?)").bind(uid,JSON.stringify({event_id:id,status:body.status,prizes:body.prizes}))
      ]);
    }catch(error){
      if(String(error?.message||'').includes('awarded_event_locked'))return fail('awarded_event_locked',409,cors);
      throw error;
    }
    if(existing.status!=='published'&&body.status==='published')
      await announceEvent(env,ctx,id,body.title.trim(),uid);
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
    const event=await db.prepare('SELECT id,status,starts_at,ends_at,prize_1,prize_2,prize_3,gift_rules_json '+
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
    if(safeJson(event.gift_rules_json).length){
      const winners=await settledEventRanking(db,event,3);
      if(Number(winners[rank-1]?.public_no)!==Number(publicId))
        return fail('event_rank_mismatch',409,cors);
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
    try{
      const notice=await notifyUser(db,{recipientUid:recipient.auth_uid,
        kind:'reward',title:'Event prize awarded',
        body:'Rank #'+rank+' event prize: '+coins+' coins credited.',
        dedupeKey:'event-award:'+eventId+':'+rank,createdBy:uid});
      if(notice.created&&notice.notification)
        ctx?.waitUntil(deliverNotification(env,notice.notification));
    }catch(error){console.error('event_award_notice_failed',String(error.message||error));}
    return reply({awarded:true,award_id:receipt?.id,rank,public_id:publicId,coins},201,cors);
  }
  return fail('event_method_not_allowed',405,cors);
}
