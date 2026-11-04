import { sheetsConfigured, sheetSyncStatus, syncFamilyGoogleSheet } from './family-sheets.mjs';
import { notifyUser, deliverNotification } from './notifications.mjs';
import {recordUserEvent} from './transaction-notices.mjs';
// Royal Family / BD staging service. All money-like values are integers.
// 10000 crystal_units represent 1 Crystal; no Crystal is a coin balance.
const ID=/^[0-9]{8}$/;
const REQ=/^[A-Za-z0-9:_-]{12,80}$/;
const familyId=v=>Number.isSafeInteger(v)&&v>0&&v<=999999999;
const rows=x=>x?.results||[];
const showId=n=>String(n).padStart(8,'0');
async function input(request){
  const raw=await request.text();
  if(raw.length>8192)throw Error('family_body_too_large');
  const value=JSON.parse(raw||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_family_body');
  return value;
}
function errorResponse(fail,cors,error){
  const code=String(error?.message||error);
  if(/UNIQUE constraint failed|family_grant_conflict|FOREIGN KEY constraint/.test(code))
    return fail('family_conflict',409,cors);
  if(/family_owner_transfer_invalid|already_in_family|family_activity_immutable/.test(code))
    return fail('family_management_conflict',409,cors);
  if(/crystal_insufficient|seller_not_approved|seller_stock_limit|invalid_transfer_transition|family_full|family_join_cooldown/.test(code))
    return fail(code.includes('crystal_insufficient')?'crystal_insufficient':
      code.includes('seller')?'seller_unavailable':code.includes('family_full')?'family_full':code.includes('family_join_cooldown')?'family_join_cooldown':'transfer_conflict',409,cors);
  console.error('family_request_failure',code);
  return fail('family_request_failed',503,cors);
}
async function policy(db){
  const found=await db.prepare("SELECT * FROM sharika_family_policy WHERE key='standard'").first();
  if(!found)throw Error('family_policy_unavailable');
  const prefs=await db.prepare("SELECT mode FROM sharika_family_settlement_preferences WHERE key='standard'").first();
  return {...found,settlement_mode:prefs?.mode||found.settlement_mode};
}
async function active(db,uid){
  return db.prepare("SELECT auth_uid,public_no,name,minor FROM sharika_users WHERE auth_uid=? AND status='active'")
    .bind(uid).first();
}
async function familyFor(db,uid){
  return db.prepare(
    'SELECT f.id,f.name,f.level,f.status,f.owner_uid,f.bd_uid,m.role,m.joined_at,'+
    'ou.public_no AS owner_no,ou.name AS owner_name,bu.public_no AS bd_no,'+
    'COUNT(mm.user_uid) AS member_count FROM sharika_family_members m '+
    'JOIN sharika_families f ON f.id=m.family_id '+
    'JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
    'JOIN sharika_users bu ON bu.auth_uid=f.bd_uid '+
    'LEFT JOIN sharika_family_members mm ON mm.family_id=f.id '+
    'WHERE m.user_uid=? GROUP BY f.id'
  ).bind(uid).first();
}
async function crystalSummary(db,uid){
  const credits=await db.prepare(
    'SELECT COALESCE(SUM(crystal_units),0) AS units FROM sharika_family_crystal_ledger '+
    'WHERE beneficiary_uid=?').bind(uid).first();
  const held=await db.prepare(
    "SELECT COALESCE(SUM(crystal_units),0) AS units FROM sharika_family_crystal_transfers "+
    "WHERE sender_uid=? AND status IN ('pending','approved')"
  ).bind(uid).first();
  const total=Number(credits?.units)||0,reserved=Number(held?.units)||0;
  return {total_units:total,available_units:Math.max(0,total-reserved),
    transferred_units:reserved,crystals:total/10000};
}
export async function handleFamilyApp({request,env,uid,path,cors,reply,fail,ctx}){
  if(!path.startsWith('/api/v1/family'))return null;
  const db=env.DB;
  if(!await active(db,uid))return fail('profile_unavailable',403,cors);
  const current=await policy(db);
  if(path==='/api/v1/family/me'&&request.method==='GET'){
    const family=await familyFor(db,uid);
    const bd=await db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?')
      .bind(uid).first();
    const memberList=family?rows(await db.prepare(
      'SELECT u.public_no,u.name,m.role,m.joined_at FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid WHERE m.family_id=? '+
      "ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'co_leader' THEN 1 ELSE 2 END, m.joined_at LIMIT 200"
    ).bind(family.id).all()).map(m=>({...m,public_id:showId(m.public_no),public_no:undefined})):[];
    const applications=family?[]:rows(await db.prepare(
      'SELECT r.id,r.family_id,f.name AS family_name,r.state,r.created_at '+
      'FROM sharika_family_join_requests r JOIN sharika_families f ON f.id=r.family_id '+
      'WHERE r.applicant_uid=? ORDER BY r.id DESC LIMIT 20'
    ).bind(uid).all());
    const incoming=family?[]:rows(await db.prepare(
      "SELECT i.id,i.family_id,f.name AS family_name,u.public_no AS inviter_no,i.expires_at "+
      "FROM sharika_family_invites i JOIN sharika_families f ON f.id=i.family_id "+
      "JOIN sharika_users u ON u.auth_uid=i.inviter_uid "+
      "WHERE i.recipient_uid=? AND i.state='pending' AND i.expires_at>datetime('now') "+
      "AND f.status='active' ORDER BY i.id DESC LIMIT 30"
    ).bind(uid).all());
    // Family target tracks diamonds actually created by ordinary gift events,
    // including gifts sent by the owner. Commission eligibility is separate.
    // Derive from immutable events, so previous verified gifts are visible too.
    const activity=family?await db.prepare(
      "SELECT COUNT(*) AS total_gifts,COALESCE(SUM(e.quantity*e.price_coins),0) AS total_coins,"+
      "SUM(CASE WHEN e.created_at>=datetime('now','start of day') THEN 1 ELSE 0 END) AS daily_gifts,"+
      "SUM(CASE WHEN e.created_at>=datetime('now','weekday 0','-6 days','start of day') THEN 1 ELSE 0 END) AS weekly_gifts,"+
      "SUM(CASE WHEN e.created_at>=datetime('now','start of month') THEN 1 ELSE 0 END) AS monthly_gifts,"+
      "COALESCE(SUM(CASE WHEN g.tab IN (0,1) THEN e.quantity*e.price_coins ELSE 0 END),0) AS total_diamonds,"+
      "COALESCE(SUM(CASE WHEN g.tab IN (0,1) AND e.created_at>=datetime('now','start of day') "+
      "THEN e.quantity*e.price_coins ELSE 0 END),0) AS daily_diamonds,"+
      "COALESCE(SUM(CASE WHEN g.tab IN (0,1) AND "+
      "e.created_at>=datetime('now','weekday 0','-6 days','start of day') "+
      "THEN e.quantity*e.price_coins ELSE 0 END),0) AS weekly_diamonds,"+
      "COALESCE(SUM(CASE WHEN g.tab IN (0,1) AND e.created_at>=datetime('now','start of month') "+
      "THEN e.quantity*e.price_coins ELSE 0 END),0) AS monthly_diamonds "+
      "FROM sharika_gift_events e "+
      "JOIN sharika_family_members fm ON fm.user_uid=e.sender_uid "+
      "JOIN sharika_gifts g ON g.id=e.gift_id "+
      "WHERE fm.family_id=? AND e.created_at>=fm.joined_at"
    ).bind(family.id).first():null;
    return reply({activity:activity||{total_gifts:0,total_coins:0,
      daily_gifts:0,weekly_gifts:0,monthly_gifts:0},
      target_progress:{
        unit:'diamonds',today:Number(activity?.daily_diamonds)||0,
        week:Number(activity?.weekly_diamonds)||0,
        month:Number(activity?.monthly_diamonds)||0,
        lifetime:Number(activity?.total_diamonds)||0,
        source:'settled_regular_gifts_after_family_join'
      },
      invitations:incoming.map(i=>({...i,inviter_id:showId(i.inviter_no),
      inviter_no:undefined})),family:family?{
      id:family.id,name:family.name,level:family.level,status:family.status,role:family.role,
      owner_id:showId(family.owner_no),owner_name:family.owner_name,
      bd_id:showId(family.bd_no),member_count:family.member_count,members:memberList}:null,
      applications,
      bd:{active:!!bd?.active,can_grant:!!bd?.active&&!!bd?.can_grant},
      wallet:await crystalSummary(db,uid),
      policy:{enabled:!!current.active,owner_percent:current.owner_bps/100,
        bd_percent:current.bd_bps/100,settlement_mode:current.settlement_mode,
        max_members:current.max_members,conversion_enabled:!!current.conversion_enabled,
        coins_per_crystal:current.coins_per_crystal}},200,cors);
  }
  // A Family leader can inspect verified member gift activity by UTC day.
  // Members may see their own details, never another Family's records or
  // anyone's wallet balance. This endpoint does not change gift/coin ledgers.
  const memberActivity=path.match(/^\/api\/v1\/family\/members\/([0-9]{8})\/activity$/);
  if(memberActivity&&request.method==='GET'){
    const family=await familyFor(db,uid);
    if(!family)return fail('family_membership_required',403,cors);
    const selectedId=memberActivity[1];
    const viewer=await active(db,uid);
    if(!['leader','co_leader'].includes(family.role)&&showId(viewer.public_no)!==selectedId)
      return fail('family_member_detail_permission_denied',403,cors);
    const member=await db.prepare(
      'SELECT u.auth_uid,u.public_no,u.name,m.role,m.joined_at FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      'WHERE m.family_id=? AND u.public_no=?'
    ).bind(family.id,Number(selectedId)).first();
    if(!member)return fail('family_member_not_found',404,cors);
    const dateParam=new URL(request.url).searchParams.get('date');
    const day=dateParam||new Date().toISOString().slice(0,10);
    const parsedDay=Date.parse(day+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(parsedDay)||
      new Date(parsedDay).toISOString().slice(0,10)!==day)
      return fail('invalid_family_activity_date',400,cors);
    const total=await db.prepare(
      'SELECT COUNT(*) AS gift_count,COALESCE(SUM(e.quantity*e.price_coins),0) AS gift_coins '+
      'FROM sharika_gift_events e JOIN sharika_gifts g ON g.id=e.gift_id '+
      'WHERE e.sender_uid=? AND e.created_at>=? AND g.tab IN (0,1)'
    ).bind(member.auth_uid,member.joined_at).first();
    const byDay=rows(await db.prepare(
      'SELECT date(e.created_at) AS day,COUNT(*) AS gift_count,'+
      'SUM(e.quantity*e.price_coins) AS gift_coins '+
      'FROM sharika_gift_events e JOIN sharika_gifts g ON g.id=e.gift_id '+
      'WHERE e.sender_uid=? AND e.created_at>=? AND g.tab IN (0,1) '+
      'GROUP BY date(e.created_at) ORDER BY day DESC LIMIT 31'
    ).bind(member.auth_uid,member.joined_at).all());
    const gifts=rows(await db.prepare(
      'SELECT e.id,e.created_at,e.room_id,e.quantity,e.price_coins,'+
      'g.name AS gift_name,u.public_no AS recipient_no '+
      'FROM sharika_gift_events e JOIN sharika_gifts g ON g.id=e.gift_id '+
      'JOIN sharika_users u ON u.auth_uid=e.recipient_uid '+
      'WHERE e.sender_uid=? AND e.created_at>=? AND date(e.created_at)=? '+
      'AND g.tab IN (0,1) ORDER BY e.id DESC LIMIT 100'
    ).bind(member.auth_uid,member.joined_at,day).all());
    const earned=await db.prepare(
      'SELECT COALESCE(SUM(crystal_units),0) AS units '+
      'FROM sharika_family_crystal_ledger WHERE family_id=? AND beneficiary_uid=?'
    ).bind(family.id,member.auth_uid).first();
    return reply({member:{id:selectedId,name:member.name,role:member.role,
      joined_at:member.joined_at},total:{gift_count:Number(total?.gift_count)||0,
      gift_coins:Number(total?.gift_coins)||0,
      earned_crystal_units:Number(earned?.units)||0},days:byDay,
      selected_date:day,gifts:gifts.map(g=>({...g,recipient_id:showId(g.recipient_no),
        recipient_no:undefined})),has_more_gifts:gifts.length===100,
      source:'verified_regular_gifts_after_family_join',timezone:'UTC'},200,cors);
  }
  if(path==='/api/v1/family/ledger'&&request.method==='GET'){
    const credits=rows(await db.prepare(
      'SELECT l.id,l.family_id,f.name AS family_name,l.kind,l.crystal_units,l.rate_bps,'+
      'l.created_at,e.transaction_id, u.public_no AS gift_sender_no '+
      'FROM sharika_family_crystal_ledger l '+
      'JOIN sharika_families f ON f.id=l.family_id '+
      'JOIN sharika_gift_events e ON e.id=l.gift_event_id '+
      'JOIN sharika_users u ON u.auth_uid=e.sender_uid '+
      'WHERE l.beneficiary_uid=? ORDER BY l.id DESC LIMIT 100'
    ).bind(uid).all()).map(x=>({...x,gift_sender_id:showId(x.gift_sender_no),gift_sender_no:undefined}));
    const transfers=rows(await db.prepare(
      'SELECT t.id,t.crystal_units,t.coins_to_seller,t.status,t.created_at,t.resolved_at,'+
      'u.public_no AS seller_no FROM sharika_family_crystal_transfers t '+
      'JOIN sharika_users u ON u.auth_uid=t.seller_uid '+
      'WHERE t.sender_uid=? ORDER BY t.id DESC LIMIT 100'
    ).bind(uid).all()).map(x=>({...x,seller_id:showId(x.seller_no),seller_no:undefined}));
    return reply({wallet:await crystalSummary(db,uid),credits,transfers},200,cors);
  }
  // Host statements are derived from immutable, server-verified regular gifts.
  // A statement is NOT a salary credit; salary policies/payments require an
  // explicit, audited Admin decision before any money-like ledger is affected.
  if(path==='/api/v1/family/host/statement'&&request.method==='GET'){
    const family=await familyFor(db,uid);
    if(!family)return fail('family_membership_required',403,cors);
    const user=await active(db,uid);
    const statement=await db.prepare(
      'SELECT COUNT(e.id) AS lifetime_gifts,'+
      'COALESCE(SUM(e.quantity*e.price_coins),0) AS lifetime_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','start of day') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS today_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','weekday 0','-6 days','start of day') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS week_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','start of month') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS month_diamonds '+
      'FROM sharika_gift_events e JOIN sharika_gifts g ON g.id=e.gift_id '+
      'JOIN sharika_family_members m ON m.user_uid=e.sender_uid '+
      'WHERE m.family_id=? AND m.user_uid=? AND e.created_at>=m.joined_at AND g.tab IN (0,1)'
    ).bind(family.id,uid).first();
    const days=rows(await db.prepare(
      'SELECT date(e.created_at) AS day,COUNT(*) AS gift_count,'+
      'SUM(e.quantity*e.price_coins) AS gift_diamonds '+
      'FROM sharika_gift_events e JOIN sharika_gifts g ON g.id=e.gift_id '+
      'JOIN sharika_family_members m ON m.user_uid=e.sender_uid '+
      'WHERE m.family_id=? AND m.user_uid=? AND e.created_at>=m.joined_at AND g.tab IN (0,1) '+
      'GROUP BY date(e.created_at) ORDER BY day DESC LIMIT 31'
    ).bind(family.id,uid).all());
    const earned=await db.prepare(
      'SELECT COALESCE(SUM(crystal_units),0) AS units FROM sharika_family_crystal_ledger '+
      'WHERE beneficiary_uid=? AND family_id=?'
    ).bind(uid,family.id).first();
    return reply({host:{id:showId(user.public_no),name:user.name,role:family.role,
      agency_id:family.id,agency_name:family.name,joined_at:family.joined_at},
      gifts:statement||{lifetime_gifts:0,lifetime_diamonds:0,today_diamonds:0,
        week_diamonds:0,month_diamonds:0},days,
      earned_crystal_units:Number(earned?.units)||0,
      salary:{state:'not_configured',payable_units:0,automatic_payment:false,
        note:'Host salary policy and payment approval have not been configured by Admin.'},
      source:'verified_regular_gift_events_since_join',timezone:'UTC'},200,cors);
  }
  if(path==='/api/v1/family/agency/hosts'&&request.method==='GET'){
    const family=await familyFor(db,uid);
    if(!family||!['leader','co_leader'].includes(family.role))
      return fail('agency_report_permission_denied',403,cors);
    const hosts=rows(await db.prepare(
      'SELECT u.public_no AS host_no,u.name,m.role,m.joined_at,'+
      'COUNT(e.id) AS gift_count,'+
      'COALESCE(SUM(e.quantity*e.price_coins),0) AS lifetime_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','start of day') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS today_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','weekday 0','-6 days','start of day') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS week_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','start of month') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS month_diamonds '+
      'FROM sharika_family_members m JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      'LEFT JOIN sharika_gift_events e ON e.sender_uid=m.user_uid AND e.created_at>=m.joined_at '+
      'AND EXISTS(SELECT 1 FROM sharika_gifts g WHERE g.id=e.gift_id AND g.tab IN (0,1)) '+
      'WHERE m.family_id=? GROUP BY m.user_uid '+
      'ORDER BY month_diamonds DESC,lifetime_diamonds DESC,u.public_no ASC LIMIT 200'
    ).bind(family.id).all()).map(h=>({...h,host_id:showId(h.host_no),host_no:undefined}));
    return reply({agency:{id:family.id,name:family.name,role:family.role},hosts,
      period:'UTC_calendar_month',source:'verified_regular_gifts_after_join'},200,cors);
  }
  // BD oversight is strictly scoped by the authenticated active BD's UID.
  // Never expose other agents' agencies, personal wallets, or member gift events.
  if(path==='/api/v1/family/bd/overview'&&request.method==='GET'){
    const agent=await db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?')
      .bind(uid).first();
    if(!agent?.active)return fail('bd_permission_denied',403,cors);
    const agencies=rows(await db.prepare(
      'WITH gift_totals AS ('+
      'SELECT m.family_id,COUNT(e.id) AS gift_count,'+
      'COALESCE(SUM(e.quantity*e.price_coins),0) AS lifetime_diamonds,'+
      "COALESCE(SUM(CASE WHEN e.created_at>=datetime('now','start of month') "+
      'THEN e.quantity*e.price_coins ELSE 0 END),0) AS month_diamonds '+
      'FROM sharika_families f JOIN sharika_family_members m ON m.family_id=f.id '+
      'JOIN sharika_gift_events e ON e.sender_uid=m.user_uid AND e.created_at>=m.joined_at '+
      'JOIN sharika_gifts g ON g.id=e.gift_id AND g.tab IN (0,1) '+
      'WHERE f.bd_uid=? GROUP BY m.family_id),'+
      'commission_totals AS ('+
      'SELECT family_id,SUM(crystal_units) AS earned_units,'+
      "SUM(CASE WHEN created_at>=datetime('now','start of month') "+
      'THEN crystal_units ELSE 0 END) AS month_units '+
      "FROM sharika_family_crystal_ledger WHERE beneficiary_uid=? AND kind='bd' "+
      'GROUP BY family_id) '+
      'SELECT f.id,f.name,f.level,f.status,u.public_no AS owner_no,'+
      'COUNT(m.user_uid) AS member_count,'+
      'COALESCE(g.gift_count,0) AS gift_count,'+
      'COALESCE(g.lifetime_diamonds,0) AS lifetime_diamonds,'+
      'COALESCE(g.month_diamonds,0) AS month_diamonds,'+
      'COALESCE(c.earned_units,0) AS earned_crystal_units,'+
      'COALESCE(c.month_units,0) AS month_crystal_units '+
      'FROM sharika_families f JOIN sharika_users u ON u.auth_uid=f.owner_uid '+
      'LEFT JOIN sharika_family_members m ON m.family_id=f.id '+
      'LEFT JOIN gift_totals g ON g.family_id=f.id '+
      'LEFT JOIN commission_totals c ON c.family_id=f.id '+
      'WHERE f.bd_uid=? GROUP BY f.id ORDER BY f.id DESC LIMIT 100'
    ).bind(uid,uid,uid).all()).map(a=>({...a,owner_id:showId(a.owner_no),owner_no:undefined}));
    return reply({bd:{active:true,can_grant:!!agent.can_grant},
      totals:{agency_count:agencies.length,
        host_count:agencies.reduce((sum,a)=>sum+Number(a.member_count||0),0),
        month_gift_diamonds:agencies.reduce((sum,a)=>sum+Number(a.month_diamonds||0),0),
        earned_crystal_units:agencies.reduce((sum,a)=>sum+Number(a.earned_crystal_units||0),0)},
      agencies,has_more_agencies:agencies.length===100,
      source:'verified_regular_gifts_and_immutable_bd_crystal_ledger',timezone:'UTC'},200,cors);
  }
  if(path==='/api/v1/family/bd/families'&&request.method==='GET'){
    const bd=await db.prepare('SELECT active FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first();
    if(!bd?.active)return fail('bd_permission_denied',403,cors);
    const families=rows(await db.prepare(
      'SELECT f.id,f.name,f.level,f.status,f.created_at,u.public_no AS owner_no,'+
      'COUNT(m.user_uid) AS member_count FROM sharika_families f '+
      'JOIN sharika_users u ON u.auth_uid=f.owner_uid '+
      'LEFT JOIN sharika_family_members m ON m.family_id=f.id '+
      'WHERE f.bd_uid=? GROUP BY f.id ORDER BY f.id DESC LIMIT 100'
    ).bind(uid).all());
    return reply({families:families.map(f=>({...f,owner_id:showId(f.owner_no),owner_no:undefined}))},200,cors);
  }
  // Family Discovery is available before membership. Never expose private BD stock.
  if(path==='/api/v1/family/discover'&&request.method==='GET'){
    const params=new URL(request.url).searchParams;
    const sort=params.get('sort')==='new'?'new':'recommend';
    const query=String(params.get('q')||'').trim().slice(0,60);
    const order=sort==='new'?'f.created_at DESC,f.id DESC':
      'member_count DESC,f.level DESC,f.created_at DESC';
    const results=rows(await db.prepare(
      'SELECT f.id,f.name,f.level,f.created_at,u.public_no AS owner_no,'+
      'u.name AS owner_name,u.pic AS logo,u.country,COUNT(m.user_uid) AS member_count '+
      'FROM sharika_families f JOIN sharika_users u ON u.auth_uid=f.owner_uid '+
      'LEFT JOIN sharika_family_members m ON m.family_id=f.id '+
      "WHERE f.status='active' AND f.name LIKE ? GROUP BY f.id ORDER BY "+order+' LIMIT 60'
    ).bind('%'+query+'%').all());
    return reply({families:results.map(x=>({...x,owner_id:showId(x.owner_no),
      owner_no:undefined,max_members:current.max_members})),sort},200,cors);
  }
  if(path==='/api/v1/family/creation/requests'&&request.method==='GET'){
    const requests=rows(await db.prepare(
      'SELECT id,name,description,country,state,family_id,decision_reason,created_at,reviewed_at '+
      'FROM sharika_family_creation_requests WHERE requester_uid=? ORDER BY id DESC LIMIT 30'
    ).bind(uid).all());
    return reply({requests},200,cors);
  }
  if(path==='/api/v1/family/creation/request'&&request.method==='POST'){
    if(!current.active)return fail('family_disabled',403,cors);
    if(await familyFor(db,uid))return fail('already_in_family',409,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    const name=typeof body.name==='string'?body.name.trim():'';
    const description=typeof body.description==='string'?body.description.trim():'';
    if(name.length<3||name.length>40||!/^[\p{L}\p{N} ._-]+$/u.test(name)||
      description.length>240||body.accept_rules!==true)
      return fail('invalid_family_creation_request',400,cors);
    const existing=await db.prepare(
      "SELECT id,name,state FROM sharika_family_creation_requests WHERE requester_uid=? AND state='pending'"
    ).bind(uid).first();
    if(existing)return reply({request_id:existing.id,state:'pending',duplicate:true},200,cors);
    if(await db.prepare('SELECT 1 FROM sharika_families WHERE name=? COLLATE NOCASE')
      .bind(name).first())return fail('family_name_unavailable',409,cors);
    const applicant=await db.prepare(
      "SELECT country FROM sharika_users WHERE auth_uid=? AND status='active'"
    ).bind(uid).first();
    try{
      await db.prepare(
        "INSERT INTO sharika_family_creation_requests(requester_uid,name,description,country) "+
        'VALUES(?,?,?,?)'
      ).bind(uid,name,description,String(applicant?.country||'').slice(0,80)).run();
      const created=await db.prepare(
        "SELECT id FROM sharika_family_creation_requests WHERE requester_uid=? AND state='pending'"
      ).bind(uid).first();
      return reply({request_id:created.id,state:'pending'},201,cors);
    }catch(error){return errorResponse(fail,cors,error);}
  }
  if(path==='/api/v1/family/bd/grant'&&request.method==='POST'){
    if(!current.active)return fail('family_disabled',403,cors);
    const bd=await db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first();
    if(!bd?.active||!bd?.can_grant)return fail('bd_permission_denied',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    const ownerId=body.owner_public_id,name=typeof body.name==='string'?body.name.trim():'';
    if(typeof ownerId!=='string'||!ID.test(ownerId)||name.length<3||name.length>40||
      !/^[\p{L}\p{N} ._-]+$/u.test(name)||typeof body.request_id!=='string'||!REQ.test(body.request_id))
      return fail('invalid_family_grant',400,cors);
    const prior=await db.prepare(
      'SELECT g.family_id,g.owner_uid,f.name FROM sharika_family_grants g '+
      'JOIN sharika_families f ON f.id=g.family_id WHERE g.bd_uid=? AND g.request_id=?'
    ).bind(uid,body.request_id).first();
    const owner=await db.prepare("SELECT auth_uid,public_no,status FROM sharika_users WHERE public_no=?")
      .bind(Number(ownerId)).first();
    if(!owner||owner.status!=='active')return fail('family_owner_unavailable',404,cors);
    if(prior)return prior.owner_uid===owner.auth_uid&&prior.name===name
      ?reply({created:false,family_id:prior.family_id,duplicate:true},200,cors)
      :fail('idempotency_conflict',409,cors);
    const previous=await db.prepare('SELECT 1 FROM sharika_family_members WHERE user_uid=?')
      .bind(owner.auth_uid).first();
    if(previous)return fail('already_in_family',409,cors);
    try{
      await db.batch([
        db.prepare('INSERT INTO sharika_families(name,owner_uid,bd_uid) '+
          'SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM sharika_bd_agents WHERE bd_uid=? AND active=1 AND can_grant=1)')
          .bind(name,owner.auth_uid,uid,uid),
        db.prepare("INSERT INTO sharika_family_members(family_id,user_uid,role) "+
          "VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,'leader')")
          .bind(owner.auth_uid,owner.auth_uid),
        db.prepare('INSERT INTO sharika_family_grants(family_id,bd_uid,owner_uid,request_id) '+
          'VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,?,?)')
          .bind(owner.auth_uid,uid,owner.auth_uid,body.request_id)
      ]);
      const created=await db.prepare('SELECT id FROM sharika_families WHERE owner_uid=?')
        .bind(owner.auth_uid).first();
      await recordUserEvent({env,ctx,recipientUid:owner.auth_uid,title:'Your Royal Family was created',
        body:'You are now the leader of Family '+name+' (#'+created.id+').',
        dedupeKey:'family_bd_grant:'+created.id,createdBy:uid});
      return reply({created:true,family_id:created.id,owner_public_id:ownerId},201,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(path==='/api/v1/family/join'&&request.method==='POST'){
    if(!current.active)return fail('family_disabled',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!familyId(body.family_id))return fail('invalid_family_id',400,cors);
    if(await familyFor(db,uid))return fail('already_in_family',409,cors);
    const family=await db.prepare("SELECT id FROM sharika_families WHERE id=? AND status='active'")
      .bind(body.family_id).first();
    if(!family)return fail('family_unavailable',404,cors);
    const found=await db.prepare(
      'SELECT id,state FROM sharika_family_join_requests WHERE family_id=? AND applicant_uid=?'
    ).bind(family.id,uid).first();
    if(found){
      if(found.state==='pending')
        return reply({request_id:found.id,state:'pending',duplicate:true},200,cors);
      try{
        const saved=await db.prepare(
          "UPDATE sharika_family_join_requests SET state='pending',"+
          "created_at=datetime('now'),reviewed_at=NULL WHERE id=? AND applicant_uid=? "+
          "AND family_id=? AND state IN ('accepted','rejected')"
        ).bind(found.id,uid,family.id).run();
        if(!saved.meta?.changes)return fail('family_join_conflict',409,cors);
        return reply({request_id:found.id,state:'pending',reopened:true},200,cors);
      }catch(e){return errorResponse(fail,cors,e);}
    }
    await db.prepare(
      'INSERT OR IGNORE INTO sharika_family_join_requests(family_id,applicant_uid) VALUES(?,?)'
    ).bind(family.id,uid).run();
    const saved=await db.prepare(
      'SELECT id,state FROM sharika_family_join_requests WHERE family_id=? AND applicant_uid=?'
    ).bind(family.id,uid).first();
    return reply({request_id:saved.id,state:saved.state},201,cors);
  }
  // Owners invite by ID. Acceptance is always recipient-confirmed; direct
  // Super Admin additions use a separate audited admin-only route.
  if(path==='/api/v1/family/invite'&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine||mine.role!=='leader'||mine.status!=='active')
      return fail('family_leader_only',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(typeof body.public_id!=='string'||!ID.test(body.public_id))
      return fail('invalid_family_invitee',400,cors);
    const person=await db.prepare(
      "SELECT auth_uid,name,status FROM sharika_users WHERE public_no=?"
    ).bind(Number(body.public_id)).first();
    if(!person||person.status!=='active'||person.auth_uid===uid)
      return fail('family_invitee_unavailable',404,cors);
    if(await db.prepare("SELECT 1 FROM sharika_family_members WHERE user_uid=?")
      .bind(person.auth_uid).first())return fail('already_in_family',409,cors);
    if(mine.member_count>=current.max_members)return fail('family_full',409,cors);
    const duplicate=await db.prepare(
      "SELECT id,expires_at FROM sharika_family_invites WHERE family_id=? "+
      "AND recipient_uid=? AND state='pending'"
    ).bind(mine.id,person.auth_uid).first();
    if(duplicate&&duplicate.expires_at<=new Date().toISOString().slice(0,19).replace('T',' ')){
      await db.prepare("UPDATE sharika_family_invites SET state='expired',"+
        "responded_at=datetime('now') WHERE id=? AND state='pending'")
        .bind(duplicate.id).run();
    }
    if(!duplicate||duplicate.expires_at<=new Date().toISOString().slice(0,19).replace('T',' ')){
      try{await db.prepare(
        "INSERT INTO sharika_family_invites(family_id,inviter_uid,recipient_uid) "+
        "VALUES(?,?,?)"
      ).bind(mine.id,uid,person.auth_uid).run();}
      catch(e){return errorResponse(fail,cors,e);}
    }
    const invite=await db.prepare(
      "SELECT id,expires_at FROM sharika_family_invites WHERE family_id=? "+
      "AND recipient_uid=? AND state='pending' ORDER BY id DESC LIMIT 1"
    ).bind(mine.id,person.auth_uid).first();
    if(!invite)return fail('family_invite_conflict',409,cors);
    try{
      const note=await notifyUser(db,{
        recipientUid:person.auth_uid,kind:'system',
        title:'Family Invitation: '+mine.name,
        body:'Family '+mine.name+' invited you. Open Family and tap Join or Decline.',
        dedupeKey:'family_invite:'+invite.id,createdBy:uid
      });
      if(note.created)await deliverNotification(env,note.notification);
    }catch(error){console.error('family_invite_notification',String(error.message||error));}
    return reply({invited:true,invite_id:invite.id,family_id:mine.id,
      expires_at:invite.expires_at},201,cors);
  }
  if(path==='/api/v1/family/invites'&&request.method==='GET'){
    const pending=rows(await db.prepare(
      "SELECT i.id,i.family_id,f.name AS family_name,i.expires_at "+
      "FROM sharika_family_invites i JOIN sharika_families f ON f.id=i.family_id "+
      "WHERE i.recipient_uid=? AND i.state='pending' AND i.expires_at>datetime('now') "+
      "AND f.status='active' ORDER BY i.id DESC LIMIT 30"
    ).bind(uid).all());
    return reply({invitations:pending},200,cors);
  }
  const inviteDecision=/^\/api\/v1\/family\/invites\/([1-9][0-9]{0,9})\/(accept|decline)$/.exec(path);
  if(inviteDecision&&request.method==='POST'){
    const invite=await db.prepare(
      "SELECT i.id,i.family_id,i.recipient_uid,i.state,i.expires_at,f.status AS family_status "+
      "FROM sharika_family_invites i JOIN sharika_families f ON f.id=i.family_id WHERE i.id=?"
    ).bind(Number(inviteDecision[1])).first();
    if(!invite||invite.recipient_uid!==uid)return fail('family_invite_not_found',404,cors);
    if(invite.state!=='pending'||invite.expires_at<=new Date().toISOString().slice(0,19).replace('T',' '))
      return fail('family_invite_expired',409,cors);
    if(inviteDecision[2]==='decline'){
      const result=await db.prepare(
        "UPDATE sharika_family_invites SET state='declined',responded_at=datetime('now') "+
        "WHERE id=? AND recipient_uid=? AND state='pending'"
      ).bind(invite.id,uid).run();
      return reply({declined:!!result.meta?.changes},200,cors);
    }
    if(invite.family_status!=='active'||await familyFor(db,uid))
      return fail('already_in_family_or_suspended',409,cors);
    try{
      await db.batch([
        db.prepare(
          "INSERT INTO sharika_family_members(family_id,user_uid,role) VALUES(?,?,'member')"
        ).bind(invite.family_id,uid),
        db.prepare(
          "UPDATE sharika_family_invites SET state='accepted',responded_at=datetime('now') "+
          "WHERE id=? AND recipient_uid=? AND state='pending'"
        ).bind(invite.id,uid)
      ]);
      await recordUserEvent({env,ctx,recipientUid:uid,title:'You joined a Family',
        body:'You accepted the invitation to Family #'+invite.family_id+'.',
        dedupeKey:'family_invite_accepted:'+invite.id});
      return reply({joined:true,family_id:invite.family_id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(path==='/api/v1/family/requests'&&request.method==='GET'){
    const mine=await familyFor(db,uid);
    if(!mine||!['leader','co_leader'].includes(mine.role))return fail('family_manager_only',403,cors);
    const list=rows(await db.prepare(
      'SELECT r.id,u.public_no,u.name,r.created_at FROM sharika_family_join_requests r '+
      'JOIN sharika_users u ON u.auth_uid=r.applicant_uid '+
      "WHERE r.family_id=? AND r.state='pending' ORDER BY r.id LIMIT 100"
    ).bind(mine.id).all());
    return reply({requests:list.map(r=>({...r,public_id:showId(r.public_no),public_no:undefined}))},200,cors);
  }
  const acceptance=/^\/api\/v1\/family\/requests\/([1-9][0-9]{0,9})\/(accept|reject)$/.exec(path);
  if(acceptance&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine||!['leader','co_leader'].includes(mine.role))return fail('family_manager_only',403,cors);
    const application=await db.prepare(
      'SELECT id,family_id,applicant_uid,state FROM sharika_family_join_requests WHERE id=?'
    ).bind(Number(acceptance[1])).first();
    if(!application||application.family_id!==mine.id)return fail('request_not_found',404,cors);
    if(application.state!=='pending')return fail('request_already_reviewed',409,cors);
    try{
      const statements=[];
      if(acceptance[2]==='accept')statements.push(db.prepare(
        "INSERT INTO sharika_family_members(family_id,user_uid,role) "+
        "SELECT ?,?,'member' WHERE "+
        "(SELECT COUNT(*) FROM sharika_family_members WHERE family_id=?) < "+
        "(SELECT max_members FROM sharika_family_policy WHERE key='standard') "+
        "AND EXISTS(SELECT 1 FROM sharika_family_join_requests WHERE id=? AND state='pending') "+
        "AND EXISTS(SELECT 1 FROM sharika_families WHERE id=? AND status='active')"
      ).bind(mine.id,application.applicant_uid,mine.id,application.id,mine.id));
      statements.push(db.prepare(
        "UPDATE sharika_family_join_requests SET state=?,reviewed_at=datetime('now') "+
        "WHERE id=? AND state='pending' AND (?='rejected' OR "+
        "EXISTS(SELECT 1 FROM sharika_family_members WHERE family_id=? AND user_uid=?))"
      ).bind(acceptance[2]==='accept'?'accepted':'rejected',application.id,
        acceptance[2]==='accept'?'accepted':'rejected',mine.id,application.applicant_uid));
      await db.batch(statements);
      const member=await db.prepare(
        'SELECT 1 FROM sharika_family_members WHERE family_id=? AND user_uid=?'
      ).bind(mine.id,application.applicant_uid).first();
      if(acceptance[2]==='accept'&&!member)return fail('family_full',409,cors);
      await recordUserEvent({env,ctx,recipientUid:application.applicant_uid,
        title:acceptance[2]==='accept'?'Family membership approved':'Family request declined',
        body:acceptance[2]==='accept'?'Your request to join Family #'+mine.id+' was accepted.':
          'Your request to join Family #'+mine.id+' was declined.',
        dedupeKey:'family_join_decision:'+application.id+':'+acceptance[2]+':'+Date.now(),createdBy:uid});
      return reply({ok:true,decision:acceptance[2]},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  // Ownership may only move to a current member. A D1 trigger updates both
  // roles and writes an immutable activity record in the same SQL statement.
  if(path==='/api/v1/family/ownership/transfer'&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine||mine.role!=='leader')return fail('family_leader_only',403,cors);
    if(mine.status!=='active')return fail('family_suspended',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(typeof body.new_owner_public_id!=='string'||!ID.test(body.new_owner_public_id))
      return fail('invalid_family_member',400,cors);
    const next=await db.prepare(
      'SELECT m.user_uid FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      "WHERE m.family_id=? AND u.public_no=? AND u.status='active'"
    ).bind(mine.id,Number(body.new_owner_public_id)).first();
    if(!next||next.user_uid===uid)return fail('family_transfer_target_invalid',409,cors);
    try{
      const changed=await db.prepare(
        "UPDATE sharika_families SET owner_uid=? WHERE id=? AND owner_uid=? AND status='active' "+
        'AND EXISTS(SELECT 1 FROM sharika_family_members WHERE family_id=? AND user_uid=?)'
      ).bind(next.user_uid,mine.id,uid,mine.id,next.user_uid).run();
      if(!changed.meta?.changes)return fail('family_management_conflict',409,cors);
      await recordUserEvent({env,ctx,recipientUid:next.user_uid,title:'Family leadership transferred',
        body:'You are now the leader of Family #'+mine.id+'.',
        dedupeKey:'family_owner_transfer:'+mine.id+':'+Date.now(),createdBy:uid});
      await recordUserEvent({env,ctx,recipientUid:uid,title:'Family leadership transferred',
        body:'You transferred leadership of Family #'+mine.id+'.',
        dedupeKey:'family_owner_transfer_out:'+mine.id+':'+Date.now()});
      return reply({transferred:true,new_owner_public_id:body.new_owner_public_id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const roleAction=/^\/api\/v1\/family\/members\/([0-9]{8})\/role$/.exec(path);
  if(roleAction&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine||mine.role!=='leader')return fail('family_leader_only',403,cors);
    if(mine.status!=='active')return fail('family_suspended',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!['co_leader','elder','member'].includes(body.role))
      return fail('invalid_family_role',400,cors);
    const target=await db.prepare(
      'SELECT m.user_uid,m.role FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid WHERE m.family_id=? AND u.public_no=?'
    ).bind(mine.id,Number(roleAction[1])).first();
    if(!target||target.user_uid===uid||target.role==='leader')
      return fail('family_member_not_manageable',403,cors);
    if(target.role===body.role)return reply({saved:true,unchanged:true},200,cors);
    try{
      const changed=await db.prepare(
        'UPDATE sharika_family_members SET role=? WHERE family_id=? AND user_uid=? '+
        "AND role!='leader' AND EXISTS(SELECT 1 FROM sharika_families "+
        "WHERE id=? AND owner_uid=? AND status='active')"
      ).bind(body.role,mine.id,target.user_uid,mine.id,uid).run();
      if(!changed.meta?.changes)return fail('family_management_conflict',409,cors);
      await recordUserEvent({env,ctx,recipientUid:target.user_uid,title:'Family role updated',
        body:'Your role in Family #'+mine.id+' is now '+body.role.replaceAll('_',' ')+'.',
        dedupeKey:'family_role:'+mine.id+':'+roleAction[1]+':'+Date.now(),createdBy:uid});
      return reply({saved:true,member_public_id:roleAction[1],role:body.role},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const removeAction=/^\/api\/v1\/family\/members\/([0-9]{8})\/remove$/.exec(path);
  if(removeAction&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine||mine.role!=='leader')return fail('family_leader_only',403,cors);
    if(mine.status!=='active')return fail('family_suspended',403,cors);
    const target=await db.prepare(
      'SELECT m.user_uid,m.role FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid WHERE m.family_id=? AND u.public_no=?'
    ).bind(mine.id,Number(removeAction[1])).first();
    if(!target||target.user_uid===uid||target.role==='leader')
      return fail('family_member_not_manageable',403,cors);
    try{
      // Audit + removal commit together. Existing leave trigger enforces the
      // same 24-hour cooldown after a removal as after a voluntary exit.
      await db.batch([
        db.prepare(
          "INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json) "+
          "SELECT ?,?,?, 'member_remove',json_object('previous_role',role) "+
          "FROM sharika_family_members WHERE family_id=? AND user_uid=? AND role!='leader' "+
          "AND EXISTS(SELECT 1 FROM sharika_families WHERE id=? AND owner_uid=? AND status='active')"
        ).bind(mine.id,uid,target.user_uid,mine.id,target.user_uid,mine.id,uid),
        db.prepare(
          "DELETE FROM sharika_family_members WHERE family_id=? AND user_uid=? "+
          "AND role!='leader' AND EXISTS(SELECT 1 FROM sharika_families "+
          "WHERE id=? AND owner_uid=? AND status='active')"
        ).bind(mine.id,target.user_uid,mine.id,uid)
      ]);
      const still=await db.prepare(
        'SELECT 1 FROM sharika_family_members WHERE family_id=? AND user_uid=?'
      ).bind(mine.id,target.user_uid).first();
      if(still)return fail('family_management_conflict',409,cors);
      await recordUserEvent({env,ctx,recipientUid:target.user_uid,title:'Family membership ended',
        body:'You were removed from Family #'+mine.id+'.',
        dedupeKey:'family_member_removed:'+mine.id+':'+removeAction[1]+':'+Date.now(),createdBy:uid});
      return reply({removed:true,member_public_id:removeAction[1]},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(path==='/api/v1/family/leave'&&request.method==='POST'){
    const mine=await familyFor(db,uid);
    if(!mine)return fail('not_in_family',404,cors);
    if(mine.role==='leader')return fail('transfer_ownership_first',409,cors);
    await db.prepare('DELETE FROM sharika_family_members WHERE user_uid=? AND family_id=?')
      .bind(uid,mine.id).run();
    await recordUserEvent({env,ctx,recipientUid:uid,title:'You left a Family',
      body:'You left Family #'+mine.id+'.',dedupeKey:'family_left:'+mine.id+':'+Date.now()});
    return reply({left:true},200,cors);
  }
  if(path==='/api/v1/family/crystal/transfer'&&request.method==='POST'){
    if(!current.conversion_enabled)return fail('crystal_conversion_disabled',403,cors);
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(typeof body.seller_public_id!=='string'||!ID.test(body.seller_public_id)||
      !Number.isSafeInteger(body.crystals)||body.crystals<1||body.crystals>1000000||
      typeof body.request_id!=='string'||!REQ.test(body.request_id))
      return fail('invalid_crystal_transfer',400,cors);
    const seller=await db.prepare(
      'SELECT s.seller_uid FROM sharika_coin_sellers s JOIN sharika_users u ON u.auth_uid=s.seller_uid '+
      "WHERE u.public_no=? AND s.active=1 AND u.status='active'"
    ).bind(Number(body.seller_public_id)).first();
    if(!seller)return fail('seller_not_approved',404,cors);
    const units=body.crystals*10000;
    const prior=await db.prepare(
      'SELECT id,seller_uid,crystal_units,status FROM sharika_family_crystal_transfers '+
      'WHERE sender_uid=? AND request_id=?'
    ).bind(uid,body.request_id).first();
    if(prior)return prior.seller_uid===seller.seller_uid&&prior.crystal_units===units
      ?reply({transfer_id:prior.id,status:prior.status,duplicate:true},200,cors)
      :fail('idempotency_conflict',409,cors);
    try{
      await db.prepare(
        'INSERT INTO sharika_family_crystal_transfers(sender_uid,seller_uid,crystal_units,request_id) VALUES(?,?,?,?)'
      ).bind(uid,seller.seller_uid,units,body.request_id).run();
      const transfer=await db.prepare(
        'SELECT id,status FROM sharika_family_crystal_transfers WHERE sender_uid=? AND request_id=?'
      ).bind(uid,body.request_id).first();
      return reply({transfer_id:transfer.id,status:transfer.status,crystals:body.crystals},201,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  return fail('family_route_not_found',404,cors);
}
// Call these statements from the *same D1 batch* as the verified regular gift.
// Gift event IDs are generated by the existing gift handler; the SELECT uses
// its verified sender/request pair. Idempotent duplicate requests skip the batch.
export function familyGiftCommissionStatements(db,senderUid,requestId,giftTab){
  if(giftTab===2)return [];
  const tx='(SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?)';
  const eligibility="JOIN sharika_family_members fm ON fm.user_uid=e.sender_uid "+
    "JOIN sharika_families f ON f.id=fm.family_id AND f.status='active' "+
    "JOIN sharika_family_policy p ON p.key='standard' AND p.active=1 ";
  return [
    db.prepare(
      'INSERT INTO sharika_family_crystal_ledger(gift_event_id,family_id,beneficiary_uid,kind,rate_bps,crystal_units) '+
      "SELECT e.id,f.id,f.owner_uid,'family_owner',p.owner_bps,e.quantity*e.price_coins*p.owner_bps "+
      'FROM sharika_gift_events e '+eligibility+
      'WHERE e.transaction_id='+tx+' AND e.sender_uid<>f.owner_uid AND p.owner_bps>0'
    ).bind(senderUid,requestId),
    db.prepare(
      'INSERT INTO sharika_family_crystal_ledger(gift_event_id,family_id,beneficiary_uid,kind,rate_bps,crystal_units) '+
      "SELECT e.id,f.id,f.bd_uid,'bd',p.bd_bps,e.quantity*e.price_coins*p.bd_bps "+
      'FROM sharika_gift_events e '+eligibility+
      'JOIN sharika_bd_agents b ON b.bd_uid=f.bd_uid AND b.active=1 '+
      'WHERE e.transaction_id='+tx+' AND e.sender_uid<>f.bd_uid AND p.bd_bps>0'
    ).bind(senderUid,requestId)
  ];
}
export async function handleFamilyAdmin({request,env,uid,actor,operation,cors,reply,fail,ctx}){
  if(!(operation==='family'||operation.startsWith('family/')))return null;
  const db=env.DB;
  if(actor.role!=='super'&&actor.role!=='finance')return fail('admin_permission_denied',403,cors);
  if(operation==='family'&&request.method==='GET'){
    const [settings,agents,families,transfers]=await Promise.all([
      policy(db),
      db.prepare('SELECT a.active,a.can_grant,u.public_no,u.name,a.updated_at FROM sharika_bd_agents a '+
        'JOIN sharika_users u ON u.auth_uid=a.bd_uid ORDER BY a.updated_at DESC LIMIT 100').all(),
      db.prepare('SELECT f.id,f.name,f.level,f.status,f.created_at,'+
        'ou.public_no AS owner_no,bu.public_no AS bd_no,b.active AS bd_active,COUNT(m.user_uid) AS member_count '+
        'FROM sharika_families f JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
        'JOIN sharika_users bu ON bu.auth_uid=f.bd_uid '+
        'JOIN sharika_bd_agents b ON b.bd_uid=f.bd_uid '+
        'LEFT JOIN sharika_family_members m ON m.family_id=f.id '+
        'GROUP BY f.id ORDER BY f.id DESC LIMIT 100').all(),
      db.prepare('SELECT t.id,t.crystal_units,t.status,t.created_at,'+
        'su.public_no AS sender_no,cu.public_no AS seller_no FROM sharika_family_crystal_transfers t '+
        'JOIN sharika_users su ON su.auth_uid=t.sender_uid '+
        'JOIN sharika_users cu ON cu.auth_uid=t.seller_uid ORDER BY t.id DESC LIMIT 100').all()
    ]);
    return reply({policy:{enabled:!!settings.active,owner_bps:settings.owner_bps,
      bd_bps:settings.bd_bps,settlement_mode:settings.settlement_mode,
      max_members:settings.max_members,conversion_enabled:!!settings.conversion_enabled,
      coins_per_crystal:settings.coins_per_crystal},
      agents:rows(agents).map(a=>({...a,public_id:showId(a.public_no),public_no:undefined})),
      families:rows(families).map(f=>({...f,owner_id:showId(f.owner_no),
        bd_id:showId(f.bd_no),owner_no:undefined,bd_no:undefined})),
      transfers:rows(transfers).map(t=>({...t,sender_id:showId(t.sender_no),
        seller_id:showId(t.seller_no),sender_no:undefined,seller_no:undefined}))},200,cors);
  }
  if(operation==='family/sheets/status'&&request.method==='GET'){
    return reply(await sheetSyncStatus(db,env),200,cors);
  }
  const adminMembers=/^family\/([1-9][0-9]{0,9})\/members$/.exec(operation);
  if(adminMembers&&request.method==='GET'){
    const family=await db.prepare('SELECT id,name,status FROM sharika_families WHERE id=?')
      .bind(Number(adminMembers[1])).first();
    if(!family)return fail('family_unavailable',404,cors);
    const members=rows(await db.prepare(
      'SELECT u.public_no,u.name,m.role,m.joined_at FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      'WHERE m.family_id=? ORDER BY m.joined_at ASC LIMIT 200'
    ).bind(family.id).all()).map(m=>({...m,public_id:showId(m.public_no),public_no:undefined}));
    return reply({family,members},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='family/creation/requests'&&request.method==='GET'){
    const pending=rows(await db.prepare(
      'SELECT r.id,r.name,r.description,r.country,r.state,r.created_at,'+
      'u.public_no AS requester_no,u.name AS requester_name,u.pic AS requester_pic '+
      'FROM sharika_family_creation_requests r '+
      'JOIN sharika_users u ON u.auth_uid=r.requester_uid '+
      "WHERE r.state='pending' ORDER BY r.created_at ASC LIMIT 100"
    ).all()).map(r=>({...r,requester_id:showId(r.requester_no),requester_no:undefined}));
    return reply({requests:pending},200,cors);
  }
  const creationDecision=/^family\/creation\/requests\/([1-9][0-9]{0,9})\/(approve|reject)$/.exec(operation);
  if(creationDecision&&request.method==='POST'){
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    const id=Number(creationDecision[1]),action=creationDecision[2];
    const application=await db.prepare(
      'SELECT r.id,r.requester_uid,r.name,r.state,r.family_id,u.status AS requester_status '+
      'FROM sharika_family_creation_requests r '+
      'JOIN sharika_users u ON u.auth_uid=r.requester_uid WHERE r.id=?'
    ).bind(id).first();
    if(!application)return fail('family_application_not_found',404,cors);
    if(application.state!=='pending')return fail('family_application_already_reviewed',409,cors);
    if(action==='reject'){
      const reason=typeof body.reason==='string'?body.reason.trim().slice(0,240):'';
      const result=await db.batch([
        db.prepare("UPDATE sharika_family_creation_requests SET state='rejected',"+
          "decision_reason=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND state='pending'")
          .bind(reason,uid,id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_application_reject',JSON.stringify({request_id:id,reason}))
      ]);
      if(!result[0]?.meta?.changes)return fail('family_application_conflict',409,cors);
      try{
        const n=await notifyUser(db,{recipientUid:application.requester_uid,kind:'system',
          title:'Family application not approved',
          body:'Your Family '+application.name+' application was declined. '+reason,
          dedupeKey:'family_creation_reject:'+id,createdBy:uid});
        if(n.created)await deliverNotification(env,n.notification);
      }catch(e){console.error('family_creation_notification',String(e));}
      return reply({saved:true,state:'rejected'},200,cors);
    }
    if(typeof body.bd_public_id!=='string'||!ID.test(body.bd_public_id))
      return fail('invalid_bd_permission',400,cors);
    const bd=await db.prepare(
      'SELECT a.bd_uid,a.active FROM sharika_bd_agents a '+
      'JOIN sharika_users u ON u.auth_uid=a.bd_uid WHERE u.public_no=?'
    ).bind(Number(body.bd_public_id)).first();
    if(!bd?.active||application.requester_status!=='active')
      return fail('owner_or_bd_unavailable',404,cors);
    if(await db.prepare('SELECT 1 FROM sharika_family_members WHERE user_uid=?')
      .bind(application.requester_uid).first())return fail('already_in_family',409,cors);
    const grantId='admin:creation:'+id;
    try{
      const result=await db.batch([
        db.prepare("INSERT INTO sharika_families(name,owner_uid,bd_uid) "+
          "SELECT name,requester_uid,? FROM sharika_family_creation_requests "+
          "WHERE id=? AND state='pending'")
          .bind(bd.bd_uid,id),
        db.prepare("INSERT INTO sharika_family_members(family_id,user_uid,role) "+
          "VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,'leader')")
          .bind(application.requester_uid,application.requester_uid),
        db.prepare("INSERT INTO sharika_family_grants(family_id,bd_uid,owner_uid,request_id) "+
          "VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,?,?)")
          .bind(application.requester_uid,bd.bd_uid,application.requester_uid,grantId),
        db.prepare("UPDATE sharika_family_creation_requests SET state='approved',"+
          "family_id=(SELECT id FROM sharika_families WHERE owner_uid=?),"+
          "assigned_bd_uid=?,reviewed_by=?,reviewed_at=datetime('now') "+
          "WHERE id=? AND state='pending'")
          .bind(application.requester_uid,bd.bd_uid,uid,id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_application_approve',JSON.stringify({request_id:id,bd:body.bd_public_id}))
      ]);
      if(!result[3]?.meta?.changes)return fail('family_application_conflict',409,cors);
      const approved=await db.prepare('SELECT family_id FROM sharika_family_creation_requests WHERE id=?')
        .bind(id).first();
      try{
        const n=await notifyUser(db,{recipientUid:application.requester_uid,kind:'system',
          title:'Your Royal Family is approved',
          body:application.name+' has been created. Open Family to manage members.',
          dedupeKey:'family_creation_approve:'+id,createdBy:uid});
        if(n.created)await deliverNotification(env,n.notification);
      }catch(e){console.error('family_creation_notification',String(e));}
      return reply({saved:true,state:'approved',family_id:approved?.family_id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(operation==='family/sheets/sync'&&request.method==='POST'){
    if(!sheetsConfigured(env))return fail('google_sheets_credentials_required',503,cors);
    try { return reply(await syncFamilyGoogleSheet(env),200,cors); }
    catch(error){
      console.error('family_sheet_sync_error',String(error.message||error));
      return fail('google_sheets_sync_failed',503,cors);
    }
  }
  if(operation==='family/bd'&&request.method==='POST'){
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(typeof body.public_id!=='string'||!ID.test(body.public_id)||
      typeof body.active!=='boolean'||typeof body.can_grant!=='boolean')
      return fail('invalid_bd_permission',400,cors);
    const person=await db.prepare("SELECT auth_uid,minor,status FROM sharika_users WHERE public_no=?")
      .bind(Number(body.public_id)).first();
    if(!person||person.status!=='active')return fail('user_not_found',404,cors);
    if(person.minor&&body.active)return fail('bd_adult_only',403,cors);
    await db.prepare(
      "INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) VALUES(?,?,?,?) "+
      "ON CONFLICT(bd_uid) DO UPDATE SET active=excluded.active,can_grant=excluded.can_grant,"+
      "assigned_by=excluded.assigned_by,updated_at=datetime('now')"
    ).bind(person.auth_uid,Number(body.active),Number(body.active&&body.can_grant),uid).run();
    await db.prepare(
      "INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)"
    ).bind(uid,'family_bd_permission',JSON.stringify({
      public_id:body.public_id,active:body.active,can_grant:body.can_grant})).run();
    await recordUserEvent({env,ctx,recipientUid:person.auth_uid,title:'BD authorization updated',
      body:body.active?'You are now an authorized BD agent for Royal Families.':
        'Your BD agent authorization has been disabled.',
      dedupeKey:'family_bd_permission:'+body.public_id+':'+Date.now(),createdBy:uid});
    return reply({saved:true},200,cors);
  }
  // Staging Super Admin operations; all existing Families and ledgers persist.
  if(operation==='family/create'&&request.method==='POST'){
    let b;try{b=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    const name=typeof b.name==='string'?b.name.trim():'';
    if(!ID.test(b.owner_public_id||'')||!ID.test(b.bd_public_id||'')||
       name.length<3||name.length>40||!/^[\p{L}\p{N} ._-]+$/u.test(name)||
       !REQ.test(b.request_id||''))return fail('invalid_family_grant',400,cors);
    const owner=await db.prepare("SELECT auth_uid,status FROM sharika_users WHERE public_no=?")
      .bind(Number(b.owner_public_id)).first();
    const bd=await db.prepare("SELECT a.bd_uid,a.active FROM sharika_bd_agents a "+
      "JOIN sharika_users u ON u.auth_uid=a.bd_uid WHERE u.public_no=?")
      .bind(Number(b.bd_public_id)).first();
    if(owner?.status!=='active'||!bd?.active)return fail('owner_or_bd_unavailable',404,cors);
    if(await db.prepare("SELECT 1 FROM sharika_family_members WHERE user_uid=?")
      .bind(owner.auth_uid).first())return fail('already_in_family',409,cors);
    try{
      await db.batch([
        db.prepare('INSERT INTO sharika_families(name,owner_uid,bd_uid) VALUES(?,?,?)')
          .bind(name,owner.auth_uid,bd.bd_uid),
        db.prepare("INSERT INTO sharika_family_members(family_id,user_uid,role) "+
          "VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,'leader')")
          .bind(owner.auth_uid,owner.auth_uid),
        db.prepare('INSERT INTO sharika_family_grants(family_id,bd_uid,owner_uid,request_id) '+
          'VALUES((SELECT id FROM sharika_families WHERE owner_uid=?),?,?,?)')
          .bind(owner.auth_uid,bd.bd_uid,owner.auth_uid,b.request_id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_admin_create',JSON.stringify({name,owner:b.owner_public_id,bd:b.bd_public_id}))
      ]);
      const family=await db.prepare('SELECT id FROM sharika_families WHERE owner_uid=?')
        .bind(owner.auth_uid).first();
      await recordUserEvent({env,ctx,recipientUid:owner.auth_uid,title:'Royal Family created',
        body:'An administrator created '+name+' (#'+family.id+') for you.',
        dedupeKey:'family_admin_created:'+family.id,createdBy:uid});
      return reply({created:true,family_id:family.id},201,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const memberAdd=/^family\/([1-9][0-9]{0,9})\/members\/add$/.exec(operation);
  if(memberAdd&&request.method==='POST'){
    let b;try{b=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!ID.test(b.public_id||''))return fail('invalid_family_member',400,cors);
    const family=await db.prepare('SELECT id,status FROM sharika_families WHERE id=?')
      .bind(Number(memberAdd[1])).first();
    const person=await db.prepare("SELECT auth_uid,status FROM sharika_users WHERE public_no=?")
      .bind(Number(b.public_id)).first();
    if(family?.status!=='active'||person?.status!=='active')
      return fail('family_or_member_unavailable',404,cors);
    if(await db.prepare('SELECT 1 FROM sharika_family_members WHERE user_uid=?')
      .bind(person.auth_uid).first())return fail('already_in_family',409,cors);
    try{
      const result=await db.batch([
        db.prepare("UPDATE sharika_family_invites SET state='cancelled',responded_at=datetime('now') "+
          "WHERE family_id=? AND recipient_uid=? AND state='pending'")
          .bind(family.id,person.auth_uid),
        db.prepare("INSERT INTO sharika_family_invites(family_id,inviter_uid,recipient_uid,source) "+
          "VALUES(?,?,?,'admin')").bind(family.id,uid,person.auth_uid),
        db.prepare("INSERT INTO sharika_family_members(family_id,user_uid,role) VALUES(?,?,'member')")
          .bind(family.id,person.auth_uid),
        db.prepare("UPDATE sharika_family_invites SET state='accepted',responded_at=datetime('now') "+
          "WHERE family_id=? AND recipient_uid=? AND source='admin' AND state='pending'")
          .bind(family.id,person.auth_uid),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_admin_member_add',JSON.stringify({family_id:family.id,member:b.public_id}))
      ]);
      if(!result[2]?.meta?.changes)return fail('family_add_conflict',409,cors);
      try{
        const n=await notifyUser(db,{recipientUid:person.auth_uid,kind:'system',
          title:'Family membership updated',body:'An administrator added you to Family #'+family.id,
          dedupeKey:'family_admin_add:'+family.id+':'+Date.now(),createdBy:uid});
        if(n.created)await deliverNotification(env,n.notification);
      }catch(e){console.error('family_admin_notification',String(e.message||e));}
      return reply({added:true,family_id:family.id,public_id:b.public_id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const memberRemove=/^family\/([1-9][0-9]{0,9})\/members\/([0-9]{8})\/remove$/.exec(operation);
  if(memberRemove&&request.method==='POST'){
    const id=Number(memberRemove[1]),memberId=memberRemove[2];
    const member=await db.prepare('SELECT m.user_uid,m.role FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid WHERE m.family_id=? AND u.public_no=?')
      .bind(id,Number(memberId)).first();
    if(!member)return fail('family_member_unavailable',404,cors);
    if(member.role==='leader')return fail('transfer_ownership_first',409,cors);
    try{
      const results=await db.batch([
        db.prepare("INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json) "+
          "VALUES(?,?,?,'admin_member_remove',?)")
          .bind(id,uid,member.user_uid,JSON.stringify({member:memberId,role:member.role})),
        db.prepare("DELETE FROM sharika_family_members WHERE family_id=? AND user_uid=? AND role!='leader'")
          .bind(id,member.user_uid),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_admin_member_remove',JSON.stringify({family_id:id,member:memberId}))
      ]);
      if(results[1]?.meta?.changes)await recordUserEvent({env,ctx,recipientUid:member.user_uid,
        title:'Family membership ended',body:'An administrator removed you from Family #'+id+'.',
        dedupeKey:'family_admin_remove:'+id+':'+memberId+':'+Date.now(),createdBy:uid});
      return reply({removed:!!results[1]?.meta?.changes},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const bdSwap=/^family\/([1-9][0-9]{0,9})\/bd$/.exec(operation);
  if(bdSwap&&request.method==='POST'){
    let b;try{b=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!ID.test(b.bd_public_id||''))return fail('invalid_bd_permission',400,cors);
    const family=await db.prepare('SELECT id,owner_uid,bd_uid FROM sharika_families WHERE id=?')
      .bind(Number(bdSwap[1])).first();
    const next=await db.prepare('SELECT a.bd_uid,a.active FROM sharika_bd_agents a '+
      'JOIN sharika_users u ON u.auth_uid=a.bd_uid WHERE u.public_no=?')
      .bind(Number(b.bd_public_id)).first();
    if(!family||!next?.active)return fail('family_or_bd_unavailable',404,cors);
    if(family.bd_uid===next.bd_uid)return reply({saved:true,unchanged:true},200,cors);
    try{
      await db.batch([
        db.prepare('UPDATE sharika_families SET bd_uid=? WHERE id=?').bind(next.bd_uid,family.id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_bd_reassign',JSON.stringify({family_id:family.id,new_bd:b.bd_public_id}))
      ]);
      await recordUserEvent({env,ctx,recipientUid:next.bd_uid,title:'Assigned to a Family',
        body:'You are the BD agent assigned to Family #'+family.id+'.',
        dedupeKey:'family_bd_assigned:'+family.id+':'+Date.now(),createdBy:uid});
      return reply({saved:true,family_id:family.id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const ownerSwap=/^family\/([1-9][0-9]{0,9})\/owner$/.exec(operation);
  if(ownerSwap&&request.method==='POST'){
    let b;try{b=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!ID.test(b.owner_public_id||''))return fail('invalid_family_member',400,cors);
    const family=await db.prepare('SELECT id,owner_uid,status FROM sharika_families WHERE id=?')
      .bind(Number(ownerSwap[1])).first();
    const next=await db.prepare('SELECT m.user_uid FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      "WHERE m.family_id=? AND u.public_no=? AND u.status='active'")
      .bind(Number(ownerSwap[1]),Number(b.owner_public_id)).first();
    if(!family||!next)return fail('family_member_unavailable',404,cors);
    if(family.owner_uid===next.user_uid)return reply({saved:true,unchanged:true},200,cors);
    if(family.status!=='active')return fail('family_suspended',403,cors);
    try{
      await db.batch([
        db.prepare('UPDATE sharika_families SET owner_uid=? WHERE id=?')
          .bind(next.user_uid,family.id),
        db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'family_owner_reassign',JSON.stringify({family_id:family.id,new_owner:b.owner_public_id}))
      ]);
      await recordUserEvent({env,ctx,recipientUid:next.user_uid,title:'Family leadership updated',
        body:'An administrator made you the leader of Family #'+family.id+'.',
        dedupeKey:'family_admin_owner:'+family.id+':'+Date.now(),createdBy:uid});
      return reply({saved:true,family_id:family.id},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  const familyStatus=/^family\/([1-9][0-9]{0,9})\/status$/.exec(operation);
  if(familyStatus&&request.method==='POST'){
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(!['active','suspended'].includes(body.status))
      return fail('invalid_family_status',400,cors);
    const existing=await db.prepare('SELECT id,owner_uid,status FROM sharika_families WHERE id=?')
      .bind(Number(familyStatus[1])).first();
    if(!existing)return fail('family_unavailable',404,cors);
    if(existing.status===body.status)return reply({saved:true,unchanged:true},200,cors);
    try{
      await db.batch([
        db.prepare('UPDATE sharika_families SET status=? WHERE id=? AND status=?')
          .bind(body.status,existing.id,existing.status),
        db.prepare(
          'INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json) '+
          'VALUES(?,?,?,?,?)'
        ).bind(existing.id,uid,existing.owner_uid,'family_status',
          JSON.stringify({from:existing.status,to:body.status})),
        db.prepare(
          'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
        ).bind(uid,'family_status',JSON.stringify({
          family_id:existing.id,from:existing.status,to:body.status}))
      ]);
      await recordUserEvent({env,ctx,recipientUid:existing.owner_uid,title:'Family status changed',
        body:'Family #'+existing.id+' is now '+body.status+'.',
        dedupeKey:'family_status:'+existing.id+':'+Date.now(),createdBy:uid});
      return reply({saved:true,family_id:existing.id,status:body.status},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(operation==='family/policy'&&request.method==='PATCH'){
    let body;try{body=await input(request);}catch(_){return fail('invalid_family_body',400,cors);}
    if(typeof body.enabled!=='boolean'||typeof body.conversion_enabled!=='boolean'||
      !Number.isSafeInteger(body.owner_bps)||body.owner_bps<0||body.owner_bps>2000||
      !Number.isSafeInteger(body.bd_bps)||body.bd_bps<0||body.bd_bps>1000||
      body.owner_bps+body.bd_bps>2500||
      !['daily','weekly','monthly'].includes(body.settlement_mode)||
      !Number.isSafeInteger(body.max_members)||body.max_members<2||body.max_members>200||
      !Number.isSafeInteger(body.coins_per_crystal)||
      body.coins_per_crystal<1||body.coins_per_crystal>10000)
      return fail('invalid_family_policy',400,cors);
    const before=await policy(db);
    await db.batch([
      db.prepare('UPDATE sharika_family_policy SET active=?,owner_bps=?,bd_bps=?,'+
        'settlement_mode=?,max_members=?,conversion_enabled=?,coins_per_crystal=?,'+
        "updated_by=?,updated_at=datetime('now') WHERE key='standard'")
        .bind(Number(body.enabled),body.owner_bps,body.bd_bps,body.settlement_mode==='weekly'?'monthly':body.settlement_mode,
          body.max_members,Number(body.conversion_enabled),body.coins_per_crystal,uid),
      db.prepare("INSERT INTO sharika_family_settlement_preferences(key,mode,updated_at) VALUES('standard',?,datetime('now')) "+
        "ON CONFLICT(key) DO UPDATE SET mode=excluded.mode,updated_at=datetime('now')")
        .bind(body.settlement_mode),
      db.prepare('INSERT INTO sharika_family_policy_audit(actor_uid,before_json,after_json) VALUES(?,?,?)')
        .bind(uid,JSON.stringify(before),JSON.stringify(body))
    ]);
    return reply({saved:true},200,cors);
  }
  const approval=/^family\/transfers\/([1-9][0-9]{0,9})\/(approve|reject)$/.exec(operation);
  if(approval&&request.method==='POST'){
    const trans=await db.prepare(
      'SELECT id,seller_uid,crystal_units,status FROM sharika_family_crystal_transfers WHERE id=?'
    ).bind(Number(approval[1])).first();
    if(!trans)return fail('transfer_not_found',404,cors);
    if(trans.status!=='pending')return fail('transfer_already_reviewed',409,cors);
    const cfg=await policy(db);
    if(approval[2]==='approve'&&!cfg.conversion_enabled)
      return fail('crystal_conversion_disabled',403,cors);
    const amount=approval[2]==='approve'?
      Math.floor(trans.crystal_units/10000)*cfg.coins_per_crystal:0;
    if(!Number.isSafeInteger(amount)||amount>1000000000)
      return fail('conversion_limit',400,cors);
    try{
      await db.prepare(
        "UPDATE sharika_family_crystal_transfers SET status=?,coins_to_seller=?,"+
        "approved_by=?,resolved_at=datetime('now') WHERE id=? AND status='pending'"
      ).bind(approval[2]==='approve'?'approved':'rejected',amount,uid,trans.id).run();
      const saved=await db.prepare(
        'SELECT status,coins_to_seller FROM sharika_family_crystal_transfers WHERE id=?'
      ).bind(trans.id).first();
      if(saved.status==='pending')return fail('transfer_conflict',409,cors);
      return reply({transfer_id:trans.id,status:saved.status,coins_to_seller:saved.coins_to_seller},200,cors);
    }catch(e){return errorResponse(fail,cors,e);}
  }
  if(operation==='family/report'&&request.method==='GET'){
    const url=new URL(request.url),period=url.searchParams.get('period')||'week';
    if(!['day','week','month'].includes(period))return fail('invalid_report_period',400,cors);
    const from=period==='day'?"datetime('now','start of day')":
      period==='week'?"datetime('now','weekday 0','-6 days','start of day')":
      "datetime('now','start of month')";
    const query='SELECT l.id,l.created_at,e.transaction_id,e.room_id,e.gift_id,'+
      'e.quantity,e.price_coins,l.family_id,f.name AS family_name,l.kind,l.rate_bps,l.crystal_units,'+
      'su.public_no AS sender_no,bu.public_no AS beneficiary_no,ou.public_no AS owner_no,'+
      'bdu.public_no AS bd_no FROM sharika_family_crystal_ledger l '+
      'JOIN sharika_gift_events e ON e.id=l.gift_event_id '+
      'JOIN sharika_families f ON f.id=l.family_id '+
      'JOIN sharika_users su ON su.auth_uid=e.sender_uid '+
      'JOIN sharika_users bu ON bu.auth_uid=l.beneficiary_uid '+
      'JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
      'JOIN sharika_users bdu ON bdu.auth_uid=f.bd_uid '+
      'WHERE l.created_at>='+from+' ORDER BY l.id ASC LIMIT 1000';
    const ledger=rows(await db.prepare(query).all()).map(x=>({...x,
      sender_id:showId(x.sender_no),beneficiary_id:showId(x.beneficiary_no),
      owner_id:showId(x.owner_no),bd_id:showId(x.bd_no),
      sender_no:undefined,beneficiary_no:undefined,owner_no:undefined,bd_no:undefined}));
    const activity=await db.prepare(
      'SELECT COUNT(*) AS gift_events,COALESCE(SUM(e.quantity*e.price_coins),0) AS gift_coins '+
      'FROM sharika_gift_events e '+
      'JOIN sharika_family_members fm ON fm.user_uid=e.sender_uid '+
      'WHERE e.created_at>='+from+' AND e.created_at>=fm.joined_at'
    ).first();
    return reply({period,rows:ledger,truncated:ledger.length===1000,
      activity:activity||{gift_events:0,gift_coins:0},
      source:'verified_gift_event_commissions',settlement_mode:(await policy(db)).settlement_mode},200,cors);
  }
  return fail('family_admin_route_not_found',404,cors);
}
