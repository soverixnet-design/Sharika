import {verifiedRankingWindow} from './verified-rankings.mjs';

// BD -> Agency -> Host, independent of legacy Family records.
// Commissions are exact immutable accrual units, NOT spendable wallet coins.
const ID=/^[0-9]{8}$/;
const DISPLAY_ID=/^[0-9]{1,10}$/;
const REQ=/^[A-Za-z0-9:_-]{12,80}$/;
const ROLES=['host','agency','bd'];
const PERIODS=['daily','weekly','monthly'];
const pad=n=>String(n).padStart(8,'0');
const alias=(table)=>"(SELECT s.special_id FROM sharika_special_ids s WHERE s.auth_uid="+
  table+".auth_uid AND (s.expires_at IS NULL OR s.expires_at>datetime('now')) LIMIT 1)";
const rows=r=>r?.results||[];
const stamp=date=>date.toISOString().slice(0,19).replace('T',' ');
async function body(request){
  const raw=await request.text();if(raw.length>4096)throw Error('too_large');
  const result=JSON.parse(raw||'{}');
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_body');
  return result;
}
async function config(db){
  const [policy,targets]=await Promise.all([
    db.prepare("SELECT * FROM sharika_agency_policy WHERE key='standard'").first(),
    db.prepare('SELECT role,period,target_coins,revision FROM sharika_agency_targets '+
      'ORDER BY role,period').all()]);
  return {enabled:policy?.active===1,payout_enabled:false,
    settlement_mode:policy?.settlement_mode||'monthly',
    host_percent:Number(policy?.host_bps||0)/100,
    agency_percent:Number(policy?.agency_bps||0)/100,
    bd_percent:Number(policy?.bd_bps||0)/100,
    host_bps:Number(policy?.host_bps||0),
    agency_bps:Number(policy?.agency_bps||0),bd_bps:Number(policy?.bd_bps||0),
    revision:Number(policy?.revision||0),targets:rows(targets).map(t=>({
      role:t.role,period:t.period,target_coins:Number(t.target_coins),revision:t.revision}))};
}
async function profile(db,uid){
  return db.prepare("SELECT auth_uid,public_no,name FROM sharika_users WHERE auth_uid=? AND status='active'")
    .bind(uid).first();
}
async function resolveActiveId(db,id){
  if(typeof id!=='string'||!DISPLAY_ID.test(id))return null;
  return db.prepare('SELECT u.auth_uid,u.public_no FROM sharika_users u '+
    'LEFT JOIN sharika_special_ids s ON s.auth_uid=u.auth_uid '+
    "AND (s.expires_at IS NULL OR s.expires_at>datetime('now')) "+
    "WHERE u.status='active' AND (s.special_id=? OR u.public_no=?) LIMIT 1")
    .bind(id,Number(id)).first();
}
async function agencyOf(db,uid){
  return db.prepare('SELECT a.id,a.name,a.owner_uid,a.bd_uid,a.status,ou.public_no AS owner_no,'+
    'bu.public_no AS bd_no,'+alias('ou')+' AS owner_alias,'+alias('bu')+' AS bd_alias,'+
    'h.status AS host_status,h.joined_at '+
    'FROM sharika_agency_hosts h JOIN sharika_agencies a ON a.id=h.agency_id '+
    'JOIN sharika_users ou ON ou.auth_uid=a.owner_uid '+
    'JOIN sharika_users bu ON bu.auth_uid=a.bd_uid WHERE h.host_uid=? AND h.status=\'active\'')
    .bind(uid).first();
}
function presentAgency(a,masked=false){
  return {id:Number(a.id),name:a.name,status:a.status,
    owner_id:masked&&a.owner_alias!=null?String(a.owner_alias):pad(a.owner_no),
    bd_id:masked&&a.bd_alias!=null?String(a.bd_alias):pad(a.bd_no)};
}
async function targetsAndProgress(db,uid,agency,cfg,now=Date.now()){
  const progress={};
  for(const role of ROLES){
    progress[role]={};
    for(const period of PERIODS){
      const window=verifiedRankingWindow(period,now);
      const where=role==='host'?'host_uid=?':role==='agency'?'agency_id=?':'bd_uid=?';
      const param=role==='host'?uid:role==='agency'?agency?.id:uid;
      const rate=role==='host'?cfg.host_bps:role==='agency'?cfg.agency_bps:cfg.bd_bps;
      const found=param==null?null:await db.prepare(
        'SELECT COALESCE(SUM(gift_coins),0) AS total '+
        'FROM sharika_agency_commission_ledger WHERE kind=? AND '+where+
        ' AND occurred_at>=? AND occurred_at<?')
        .bind('host',param,stamp(window.start),stamp(window.end)).first();
      // Scope-based progress measures the host gift receipts once. The host
      // ledger uniquely attributes each gift to its original Agency and BD.
      const target=cfg.targets.find(t=>t.role===role&&t.period===period)?.target_coins||5000000;
      progress[role][period]={received_coins:Number(found?.total||0),
        target_coins:target,remaining_coins:Math.max(0,target-Number(found?.total||0)),
        reached:Number(found?.total||0)>=target,commission_percent:rate/100,
        start_at:window.start.toISOString(),end_at:window.end.toISOString()};
    }
  }
  return progress;
}
async function creditSummary(db,uid){
  const summary=await db.prepare('SELECT kind,COUNT(*) AS gifts,COALESCE(SUM(units),0) AS units '+
    'FROM sharika_agency_commission_ledger WHERE beneficiary_uid=? GROUP BY kind')
    .bind(uid).all();
  return rows(summary).map(s=>({role:s.kind,gifts:Number(s.gifts),accrued_units:String(s.units),
    unit_description:'10000 units = 1 coin; not spendable until salary settlement approved'}));
}

export async function readAgencyRankings(db,{kind='host',period='weekly',now=Date.now()}={}){
  if(!ROLES.includes(kind))return null;
  const window=verifiedRankingWindow(period,now);
  if(!window)return null;
  const chosen=kind==='host'?{group:'l.host_uid',join:'JOIN sharika_users u ON u.auth_uid=l.host_uid',
    fields:'u.public_no,u.name,'+alias('u')+' AS display_alias'}:
    kind==='agency'?{group:'l.agency_id',
      join:'JOIN sharika_agencies a ON a.id=l.agency_id '+
        'JOIN sharika_users u ON u.auth_uid=a.owner_uid',
      fields:'u.public_no,a.name,'+alias('u')+' AS display_alias,a.id AS agency_id'}:
      {group:'l.bd_uid',join:'JOIN sharika_users u ON u.auth_uid=l.bd_uid',
        fields:'u.public_no,u.name,'+alias('u')+' AS display_alias'};
  const total='SUM(l.gift_coins)';
  const result=await db.prepare('SELECT '+chosen.fields+',CAST('+total+' AS TEXT) AS score '+
    'FROM sharika_agency_commission_ledger l '+chosen.join+
    " WHERE l.kind='host' AND l.occurred_at>=? AND l.occurred_at<? "+
    'GROUP BY '+chosen.group+' HAVING '+total+'>0 ORDER BY '+total+
    ' DESC,u.public_no ASC LIMIT 50').bind(stamp(window.start),stamp(window.end)).all();
  return {kind,period,leaders:rows(result).map((r,i)=>({rank:i+1,
    display_id:r.display_alias==null?pad(r.public_no):String(r.display_alias),
    name:r.name,agency_id:r.agency_id||null,total:String(r.score)})),
    start_at:window.start.toISOString(),end_at:window.end.toISOString(),
    source:'verified_host_received_gifts',coverage:'agency_activation_forward_only',read_only:true};
}

async function createAgency(db,{bdUid,ownerNo,name,requestId,actorUid}){
  if(typeof ownerNo!=='string'||!DISPLAY_ID.test(ownerNo)||!REQ.test(requestId)||
    typeof name!=='string'||name.trim().length<3||name.trim().length>40||
    !/^[\p{L}\p{N} ._-]+$/u.test(name.trim()))return {error:'invalid_agency_request',status:400};
  const bd=await db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?').bind(bdUid).first();
  if(!bd?.active||!bd?.can_grant)return {error:'bd_permission_denied',status:403};
  const owner=await resolveActiveId(db,ownerNo);
  if(!owner)return {error:'owner_not_found',status:404};
  const old=await db.prepare('SELECT g.agency_id,g.owner_uid,a.name FROM sharika_agency_grants g '+
    'JOIN sharika_agencies a ON a.id=g.agency_id WHERE g.bd_uid=? AND g.request_id=?')
    .bind(bdUid,requestId).first();
  if(old)return old.owner_uid===owner.auth_uid&&old.name===name.trim()
    ?{duplicate:true,agency_id:Number(old.agency_id)}:{error:'idempotency_conflict',status:409};
  try{
    const saved=await db.batch([
      db.prepare('INSERT INTO sharika_agencies(name,owner_uid,bd_uid) '+
        'SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM sharika_bd_agents '+
        'WHERE bd_uid=? AND active=1 AND can_grant=1)')
        .bind(name.trim(),owner.auth_uid,bdUid,bdUid),
      db.prepare('INSERT INTO sharika_agency_grants(agency_id,bd_uid,owner_uid,request_id) '+
        'VALUES((SELECT id FROM sharika_agencies WHERE owner_uid=?),?,?,?)')
        .bind(owner.auth_uid,bdUid,owner.auth_uid,requestId),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'agency_created',?)").bind(actorUid,JSON.stringify({
          bd_uid:bdUid,owner_public_id:pad(owner.public_no),name:name.trim(),request_id:requestId}))
    ]);
    return {created:true,agency_id:Number(saved[0]?.meta?.last_row_id)};
  }catch(error){
    if(/UNIQUE|constraint/i.test(String(error?.message||'')))
      return {error:'agency_already_exists',status:409};
    throw error;
  }
}

export async function handleAgencyApp({request,env,uid,path,cors,reply,fail}){
  if(!path.startsWith('/api/v1/agency'))return null;
  const db=env.DB;
  if(!await profile(db,uid))return fail('profile_unavailable',403,cors);
  if(path==='/api/v1/agency/rankings'&&request.method==='GET'){
    const q=new URL(request.url).searchParams;
    const result=await readAgencyRankings(db,{kind:q.get('kind')||'host',
      period:q.get('period')||'weekly'});
    return result?reply(result,200,cors):fail('invalid_agency_ranking_filter',400,cors);
  }
  if(path==='/api/v1/agency/me'&&request.method==='GET'){
    const [cfg,mine,bd]=await Promise.all([config(db),agencyOf(db,uid),
      db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first()]);
    const owned=mine?.owner_uid===uid;
    const hosts=owned?rows(await db.prepare('SELECT u.public_no,u.name,h.status,h.joined_at '+
      ','+alias('u')+' AS alias '+
      'FROM sharika_agency_hosts h JOIN sharika_users u ON u.auth_uid=h.host_uid '+
      'WHERE h.agency_id=? ORDER BY h.joined_at LIMIT 100').bind(mine.id).all()).map(h=>({
        id:h.alias==null?pad(h.public_no):String(h.alias),name:h.name,status:h.status,
        joined_at:h.joined_at})):[];
    const requests=owned?rows(await db.prepare('SELECT r.id,u.public_no,u.name,r.state '+
      ','+alias('u')+' AS alias '+
      'FROM sharika_agency_host_requests r JOIN sharika_users u ON u.auth_uid=r.applicant_uid '+
      "WHERE r.agency_id=? AND r.state='pending' ORDER BY r.created_at LIMIT 50")
      .bind(mine.id).all()).map(r=>({id:r.id,
        user_id:r.alias==null?pad(r.public_no):String(r.alias),name:r.name,state:r.state})):[];
    const bdAgencies=bd?.active?rows(await db.prepare('SELECT a.id,a.name,a.status,'+
      'ou.public_no AS owner_no,bu.public_no AS bd_no,'+
      alias('ou')+' AS owner_alias,'+alias('bu')+' AS bd_alias FROM sharika_agencies a '+
      'JOIN sharika_users ou ON ou.auth_uid=a.owner_uid '+
      'JOIN sharika_users bu ON bu.auth_uid=a.bd_uid WHERE a.bd_uid=? '+
      'ORDER BY a.id DESC LIMIT 100').bind(uid).all()).map(a=>presentAgency(a,true)):[];
    return reply({policy:cfg,agency:mine?presentAgency(mine,true):null,
      roles:{host:!!mine,agency_owner:owned,bd:!!bd?.active,can_grant:!!bd?.active&&!!bd?.can_grant},
      hosts,requests,bd_agencies:bdAgencies,
      targets:await targetsAndProgress(db,uid,mine,cfg),
      earnings:await creditSummary(db,uid),
      salary_status:'accrued_only_no_wallet_payout',
      source:'verified_regular_gifts_received',timezone:'UTC'},200,cors);
  }
  if(path==='/api/v1/agency/discover'&&request.method==='GET'){
    const result=await db.prepare('SELECT a.id,a.name,a.status,ou.public_no AS owner_no,'+
      'bu.public_no AS bd_no,'+alias('ou')+' AS owner_alias,'+
      alias('bu')+' AS bd_alias FROM sharika_agencies a '+
      'JOIN sharika_users ou ON ou.auth_uid=a.owner_uid '+
      'JOIN sharika_users bu ON bu.auth_uid=a.bd_uid '+
      "WHERE a.status='active' ORDER BY a.id DESC LIMIT 60").all();
    return reply({agencies:rows(result).map(a=>presentAgency(a,true))},200,cors);
  }
  if(path==='/api/v1/agency/create'&&request.method==='POST'){
    const grant=await db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first();
    if(!grant?.active||!grant.can_grant)return fail('bd_permission_denied',403,cors);
    let data;try{data=await body(request);}catch{return fail('invalid_agency_body',400,cors);}
    const result=await createAgency(db,{bdUid:uid,ownerNo:data.owner_public_id,
      name:data.name,requestId:data.request_id,actorUid:uid});
    return result.error?fail(result.error,result.status,cors):reply(result,result.created?201:200,cors);
  }
  if(path==='/api/v1/agency/hosts/request'&&request.method==='POST'){
    let data;try{data=await body(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(!Number.isSafeInteger(data.agency_id)||data.agency_id<1)return fail('invalid_agency_id',400,cors);
    const existing=await agencyOf(db,uid);
    if(existing)return fail('already_agency_host',409,cors);
    const agency=await db.prepare("SELECT id FROM sharika_agencies WHERE id=? AND status='active'")
      .bind(data.agency_id).first();
    if(!agency)return fail('agency_not_found',404,cors);
    await db.prepare('INSERT INTO sharika_agency_host_requests(agency_id,applicant_uid) '+
      "VALUES(?,?) ON CONFLICT(agency_id,applicant_uid) DO UPDATE SET state='pending',"+
      "created_at=datetime('now'),resolved_at=NULL WHERE state IN ('rejected','approved')")
      .bind(agency.id,uid).run();
    const result=await db.prepare('SELECT id,state FROM sharika_agency_host_requests '+
      'WHERE agency_id=? AND applicant_uid=?').bind(agency.id,uid).first();
    return reply({request_id:result.id,state:result.state},201,cors);
  }
  const respond=/^\/api\/v1\/agency\/hosts\/([1-9]\d*)\/(approve|reject)$/.exec(path);
  if(respond&&request.method==='POST'){
    const id=Number(respond[1]),accept=respond[2]==='approve';
    const found=await db.prepare('SELECT r.id,r.state,r.agency_id,r.applicant_uid,'+
      'a.owner_uid,a.status AS agency_status FROM sharika_agency_host_requests r '+
      'JOIN sharika_agencies a ON a.id=r.agency_id WHERE r.id=?').bind(id).first();
    if(!found)return fail('host_request_not_found',404,cors);
    if(found.owner_uid!==uid)return fail('agency_owner_only',403,cors);
    if(found.state!=='pending'||found.agency_status!=='active')return fail('request_not_pending',409,cors);
    if(accept){
      if(!await profile(db,found.applicant_uid))return fail('host_not_active',409,cors);
      const member=await agencyOf(db,found.applicant_uid);
      if(member)return fail('already_agency_host',409,cors);
    }
    try{
      const ops=[db.prepare('UPDATE sharika_agency_host_requests SET state=?,resolved_at=datetime(\'now\') '+
        "WHERE id=? AND state='pending'").bind(accept?'approved':'rejected',id)];
      if(accept)ops.push(db.prepare('INSERT INTO sharika_agency_hosts(host_uid,agency_id) '+
        "SELECT applicant_uid,agency_id FROM sharika_agency_host_requests WHERE id=? AND state='approved' "+
        "ON CONFLICT(host_uid) DO UPDATE SET agency_id=excluded.agency_id,status='active',"+
        "joined_at=datetime('now') WHERE sharika_agency_hosts.status='removed'").bind(id));
      await db.batch(ops);
      return reply({request_id:id,state:accept?'approved':'rejected'},200,cors);
    }catch(error){if(/constraint|UNIQUE|agency_owner_host_protected/i.test(String(error?.message)))
      return fail('host_membership_conflict',409,cors);throw error;}
  }
  const remove=/^\/api\/v1\/agency\/hosts\/([0-9]{1,10})\/remove$/.exec(path);
  if(remove&&request.method==='POST'){
    const mine=await agencyOf(db,uid);
    if(!mine||mine.owner_uid!==uid)return fail('agency_owner_only',403,cors);
    const target=await resolveActiveId(db,remove[1]);
    if(!target)return fail('host_not_found',404,cors);
    const result=await db.prepare('UPDATE sharika_agency_hosts SET status=\'removed\' '+
      'WHERE agency_id=? AND host_uid=? '+
      "AND host_uid!=? AND status='active'")
      .bind(mine.id,target.auth_uid,uid).run();
    return result.meta?.changes?reply({removed:true},200,cors):fail('host_not_removable',409,cors);
  }
  return fail('agency_route_not_found',404,cors);
}

export async function handleAgencyAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(!['agency','agency/create','agency/bd'].includes(operation))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='agency'&&request.method==='GET'){
    const [settings,agencies,bds]=await Promise.all([config(db),
      db.prepare('SELECT a.id,a.name,a.status,ou.public_no AS owner_no,'+
        'bu.public_no AS bd_no,COUNT(h.host_uid) AS host_count FROM sharika_agencies a '+
        'JOIN sharika_users ou ON ou.auth_uid=a.owner_uid '+
        'JOIN sharika_users bu ON bu.auth_uid=a.bd_uid '+
        'LEFT JOIN sharika_agency_hosts h ON h.agency_id=a.id AND h.status=\'active\' '+
        'GROUP BY a.id ORDER BY a.id DESC LIMIT 100').all(),
      db.prepare('SELECT u.public_no,b.active,b.can_grant FROM sharika_bd_agents b '+
        'JOIN sharika_users u ON u.auth_uid=b.bd_uid ORDER BY u.public_no').all()]);
    return reply({policy:settings,agencies:rows(agencies).map(a=>({
      ...presentAgency(a),host_count:Number(a.host_count)})),
      bds:rows(bds).map(b=>({public_id:pad(b.public_no),active:!!b.active,can_grant:!!b.can_grant})),
      read_only:actor.role!=='super',historical_family_data_preserved:true},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='agency'&&request.method==='PATCH'){
    let data;try{data=await body(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(typeof data.enabled!=='boolean'||!PERIODS.includes(data.settlement_mode)||
      ![data.host_bps,data.agency_bps,data.bd_bps].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000)||
      data.host_bps+data.agency_bps+data.bd_bps>10000||
      !Array.isArray(data.targets)||data.targets.length!==9)return fail('invalid_agency_policy',400,cors);
    const keys=new Set();
    for(const t of data.targets){
      if(!ROLES.includes(t.role)||!PERIODS.includes(t.period)||
        !Number.isSafeInteger(t.target_coins)||t.target_coins<1||t.target_coins>1e12||
        keys.has(t.role+':'+t.period))return fail('invalid_agency_target',400,cors);
      keys.add(t.role+':'+t.period);
    }
    const prior=await config(db);
    const ops=[];
    // At activation, old Family accrual stops in the SAME D1 transaction.
    // History and legacy crystal balances remain untouched.
    if(data.enabled)ops.push(db.prepare("UPDATE sharika_family_policy SET active=0 WHERE key='standard' AND active=1"));
    ops.push(db.prepare('UPDATE sharika_agency_policy SET active=?,host_bps=?,agency_bps=?,bd_bps=?,'+
      'settlement_mode=?,revision=revision+1,updated_by=?,updated_at=datetime(\'now\') '+
      "WHERE key='standard'").bind(Number(data.enabled),data.host_bps,data.agency_bps,
        data.bd_bps,data.settlement_mode,uid));
    for(const t of data.targets)ops.push(db.prepare('UPDATE sharika_agency_targets '+
      'SET target_coins=?,revision=revision+1 WHERE role=? AND period=?')
      .bind(t.target_coins,t.role,t.period));
    ops.push(db.prepare('INSERT INTO sharika_agency_policy_audit(actor_uid,before_json,after_json) '+
      'VALUES(?,?,?)').bind(uid,JSON.stringify(prior),JSON.stringify(data)));
    await db.batch(ops);
    return reply({saved:true,policy:await config(db),legacy_family_future_accrual_disabled:!!data.enabled},200,cors);
  }
  if(operation==='agency/bd'&&request.method==='POST'){
    let data;try{data=await body(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(!ID.test(data.public_id)||typeof data.active!=='boolean'||
      typeof data.can_grant!=='boolean')return fail('invalid_bd_assignment',400,cors);
    const person=await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(data.public_id)).first();
    if(!person)return fail('bd_user_unavailable',404,cors);
    await db.batch([
      db.prepare('INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) '+
        'VALUES(?,?,?,?) ON CONFLICT(bd_uid) DO UPDATE SET active=excluded.active,'+
        'can_grant=excluded.can_grant,assigned_by=excluded.assigned_by,updated_at=datetime(\'now\')')
        .bind(person.auth_uid,Number(data.active),Number(data.can_grant),uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'agency_bd_assignment',?)").bind(uid,JSON.stringify(data))
    ]);
    return reply({saved:true},200,cors);
  }
  if(operation==='agency/create'&&request.method==='POST'){
    let data;try{data=await body(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(!ID.test(data.bd_public_id))return fail('invalid_bd_id',400,cors);
    const bd=await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(data.bd_public_id)).first();
    if(!bd)return fail('bd_not_found',404,cors);
    const result=await createAgency(db,{bdUid:bd.auth_uid,ownerNo:data.owner_public_id,
      name:data.name,requestId:data.request_id,actorUid:uid});
    return result.error?fail(result.error,result.status,cors):reply(result,result.created?201:200,cors);
  }
  return fail('agency_method_not_allowed',405,cors);
}
