// Agency/BD/Host is an additive earnings projection on verified gift events.
// A projection is never a coin, diamond, Crystal transfer, or paid salary.
const results=value=>value?.results||[];
const publicId=n=>String(n).padStart(8,'0');
const isPublicId=x=>typeof x==='string'&&/^[0-9]{8}$/.test(x);
const periodSql=period=>({
  today:"datetime('now','start of day')",
  week:"datetime('now','weekday 0','-6 days','start of day')",
  month:"datetime('now','start of month')"
})[period];
const periodDaySql=period=>({
  today:"date('now')",
  week:"date('now','weekday 0','-6 days')",
  month:"date('now','start of month')"
})[period];
async function parseBody(request){
  const raw=await request.text();
  if(raw.length>4096)throw Error('invalid_agency_body');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_agency_body');
  return body;
}
async function policy(db){
  const data=await db.prepare("SELECT * FROM sharika_agency_policy WHERE key='standard'").first();
  if(!data)throw Error('agency_migration_required');
  return data;
}
async function salaryConfig(db){
  const data=await db.prepare("SELECT * FROM sharika_agency_salary_config WHERE key='standard'").first();
  if(!data)throw Error('agency_salary_migration_required');
  return data;
}
async function salaryTargets(db){
  return results(await db.prepare('SELECT target_coins FROM sharika_agency_salary_targets '+
    'WHERE active=1 ORDER BY target_coins ASC LIMIT 20').all());
}
const salaryMaturity=mode=>mode==='daily'?"datetime('now','start of day')":
  mode==='weekly'?"datetime('now','weekday 0','-6 days','start of day')":
  "datetime('now','start of month')";
async function salarySummary(db,uid,mode){
  const condition=salaryMaturity(mode);
  const [earned,matured,exchanged,config]=await Promise.all([
    db.prepare('SELECT COALESCE(SUM(amount_units),0) AS units FROM sharika_agency_earnings '+
      'WHERE beneficiary_uid=?').bind(uid).first(),
    db.prepare('SELECT COALESCE(SUM(a.amount_units),0) AS units FROM sharika_agency_earnings a '+
      'JOIN sharika_agency_salary_config c ON c.key=\'standard\' '+
      `WHERE a.beneficiary_uid=? AND a.created_at<${condition} AND (`+
      'SELECT COALESCE(SUM(e.quantity*e.price_coins),0) FROM sharika_agency_earnings h '+
      "JOIN sharika_gift_events e ON e.id=h.gift_event_id WHERE h.kind='host_salary' "+
      'AND h.host_uid=a.host_uid)>=c.min_host_target_coins').bind(uid).first(),
    db.prepare('SELECT COALESCE(SUM(salary_units),0) AS units FROM sharika_agency_salary_exchanges '+
      'WHERE auth_uid=?').bind(uid).first(),
    salaryConfig(db)
  ]);
  const paid=Number(exchanged?.units)||0;
  return {earned_units:Number(earned?.units)||0,exchanged_units:paid,
    matured_available_units:Math.max(0,(Number(matured?.units)||0)-paid),
    exchange_enabled:!!config.exchange_enabled,settlement_mode:mode,
    min_host_target_coins:config.min_host_target_coins,
    coins_per_usd:config.coins_per_usd,policy_version:config.version};
}
async function actor(db,uid){
  return db.prepare("SELECT auth_uid,public_no,name,pic,status FROM sharika_users WHERE auth_uid=? AND status='active'")
    .bind(uid).first();
}
async function roomActivityDays(db,uid){
  const history=await db.prepare('SELECT utc_day,COALESCE(SUM(active_seconds),0) AS seconds,'+
    'COUNT(DISTINCT room_id) AS rooms FROM sharika_agency_room_activity '+
    "WHERE user_uid=? AND utc_day>=date('now','-30 days') "+
    'GROUP BY utc_day ORDER BY utc_day DESC LIMIT 31').bind(uid).all();
  return results(history).map(x=>({...x,seconds:Number(x.seconds)||0}));
}
async function familyRole(db,uid,familyId){
  return db.prepare('SELECT f.id,f.name,f.status,f.owner_uid,f.bd_uid,ou.pic AS logo,'+
    'ou.public_no AS owner_no,ou.name AS owner_name,'+
    'CASE WHEN f.owner_uid=? THEN 1 ELSE 0 END AS is_owner,'+
    'CASE WHEN f.bd_uid=? AND b.active=1 THEN 1 ELSE 0 END AS is_bd '+
    'FROM sharika_families f JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
    'LEFT JOIN sharika_bd_agents b ON b.bd_uid=f.bd_uid WHERE f.id=?')
    .bind(uid,uid,familyId).first();
}

// Called from the SAME transaction batch that records verified recipient gifts.
// Replayed request IDs never enter this batch; unique(event,kind) is a second
// idempotency guard. Separate from legacy Family sender-side Crystal rewards.
export function agencyGiftEarningStatements(db,senderUid,requestId,giftTab){
  if(giftTab===2)return [];
  const transaction='(SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?)';
  const eligible='FROM sharika_gift_events e '+
    'JOIN sharika_agency_hosts h ON h.host_uid=e.recipient_uid AND h.active=1 '+
    'AND e.created_at>=h.assigned_at '+
    "JOIN sharika_families f ON f.id=h.family_id AND f.status='active' "+
    'JOIN sharika_family_members m ON m.family_id=f.id AND m.user_uid=h.host_uid '+
    "JOIN sharika_agency_policy p ON p.key='standard' AND p.active=1 "+
    'JOIN sharika_gifts g ON g.id=e.gift_id AND g.tab IN (0,1) ';
  const selection=(kind,beneficiary,rate,joins='')=>db.prepare(
    'INSERT INTO sharika_agency_earnings(gift_event_id,family_id,host_uid,'+
    'beneficiary_uid,kind,rate_bps,amount_units) '+
    `SELECT e.id,f.id,h.host_uid,${beneficiary},'${kind}',p.${rate},`+
    `e.quantity*e.price_coins*p.${rate} `+eligible+joins+
    `WHERE e.transaction_id=${transaction} `+
    `AND p.${rate}>0`
  ).bind(senderUid,requestId);
  return [
    selection('host_salary','h.host_uid','host_bps'),
    selection('agency','f.owner_uid','agency_bps'),
    selection('bd','f.bd_uid','bd_bps',
      'JOIN sharika_bd_agents b ON b.bd_uid=f.bd_uid AND b.active=1 ')
  ];
}

export async function handleAgencyApp({request,env,uid,path,cors,reply,fail}){
  if(!path.startsWith('/api/v1/agency'))return null;
  const db=env.DB;
  if(!await actor(db,uid))return fail('profile_unavailable',403,cors);
  const terms=await policy(db);
  if(path==='/api/v1/agency/me'&&request.method==='GET'){
    const currentUser=await actor(db,uid);
    const [bd,owned,host,personal,salary,targets,exchanges]=await Promise.all([
      db.prepare('SELECT active,can_grant FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first(),
      db.prepare('SELECT id,name,status FROM sharika_families WHERE owner_uid=?').bind(uid).first(),
      db.prepare('SELECT h.active,h.family_id,f.name AS family_name FROM sharika_agency_hosts h '+
        'JOIN sharika_families f ON f.id=h.family_id WHERE h.host_uid=?').bind(uid).first(),
      db.prepare('SELECT kind,COALESCE(SUM(amount_units),0) AS units FROM sharika_agency_earnings '+
        'WHERE beneficiary_uid=? GROUP BY kind').bind(uid).all(),
      salarySummary(db,uid,terms.settlement_mode),salaryTargets(db),
      db.prepare('SELECT credited_coins,salary_units,settlement_mode,created_at '+
        'FROM sharika_agency_salary_exchanges WHERE auth_uid=? ORDER BY id DESC LIMIT 30')
        .bind(uid).all()
    ]);
    return reply({bd:{active:!!bd?.active,can_grant:!!bd?.active&&!!bd.can_grant},
      agency:owned||null,host:host?{...host,public_id:publicId(currentUser.public_no)}:null,
      pending_earnings:Object.fromEntries(results(personal).map(x=>[x.kind,x.units])),
      policy:{enabled:!!terms.active,host_percent:terms.host_bps/100,
        agency_percent:terms.agency_bps/100,bd_percent:terms.bd_bps/100,
        settlement_mode:terms.settlement_mode},
      salary,targets,salary_exchanges:results(exchanges),
      payout_status:salary.exchange_enabled?'eligible_after_target_and_period':'pending_admin_verification',
      source:'settled_regular_gift_events'},200,cors);
  }
  if(path==='/api/v1/agency/salary/exchange'&&request.method==='POST'){
    let body;try{body=await parseBody(request);}catch{return fail('invalid_agency_body',400,cors);}
    const requestId=typeof body.request_id==='string'?body.request_id.trim():'';
    if(!/^[A-Za-z0-9:_-]{12,80}$/.test(requestId)||
      !Number.isSafeInteger(body.coins)||body.coins<1||body.coins>100000000)
      return fail('invalid_salary_exchange',400,cors);
    const previous=await db.prepare('SELECT credited_coins FROM sharika_agency_salary_exchanges '+
      'WHERE auth_uid=? AND request_id=?').bind(uid,requestId).first();
    if(previous)return Number(previous.credited_coins)===body.coins?
      reply({ok:true,duplicate:true,credited_coins:body.coins},200,cors):
      fail('idempotency_conflict',409,cors);
    const config=await salaryConfig(db);
    if(!config.exchange_enabled||!terms.active)return fail('salary_exchange_disabled',403,cors);
    if(body.expected_version!==config.version)return fail('salary_policy_changed',409,cors);
    const amount=body.coins*10000;
    try{
      await db.batch([
        db.prepare('INSERT INTO sharika_agency_salary_exchanges(auth_uid,request_id,salary_units,'+
          'credited_coins,settlement_mode,policy_version) VALUES(?,?,?,?,?,?)')
          .bind(uid,requestId,amount,body.coins,terms.settlement_mode,config.version),
        db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND minor=0 "+
          'AND coins<=? THEN coins+? ELSE -1 END,updated_at=datetime(\'now\') WHERE auth_uid=?')
          .bind(1000000000000-body.coins,body.coins,uid),
        db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,'+
          "reason,request_id) VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
          "'agency_salary_exchange',?)")
          .bind(uid,body.coins,uid,'agency-salary:'+requestId)
      ]);
    }catch(error){
      const message=String(error?.message||error);
      if(/agency_salary_not_matured_or_insufficient|agency_salary_exchange_disabled_or_changed|CHECK constraint|UNIQUE constraint/.test(message))
        return fail('salary_exchange_not_available',409,cors);
      throw error;
    }
    return reply({ok:true,duplicate:false,credited_coins:body.coins},200,cors);
  }
  if(path==='/api/v1/agency/bd/center'&&request.method==='GET'){
    const bd=await db.prepare('SELECT active FROM sharika_bd_agents WHERE bd_uid=?').bind(uid).first();
    if(!bd?.active)return fail('bd_permission_denied',403,cors);
    const currentUser=await actor(db,uid);
    const families=results(await db.prepare(
      'SELECT f.id,f.name,f.status,ou.pic AS logo,ou.name AS owner_name,'+
      'ou.public_no AS owner_no,'+
      'COUNT(DISTINCT CASE WHEN h.active=1 THEN h.host_uid END) AS hosts,'+
      'COALESCE(SUM(CASE WHEN a.kind=\'host_salary\' AND a.created_at>='+periodSql('week')+
      ' THEN e.quantity*e.price_coins ELSE 0 END),0) AS week_gifts '+
      'FROM sharika_families f JOIN sharika_users ou ON ou.auth_uid=f.owner_uid '+
      'LEFT JOIN sharika_agency_hosts h ON h.family_id=f.id '+
      'LEFT JOIN sharika_agency_earnings a ON a.host_uid=h.host_uid AND a.family_id=f.id '+
      'AND a.kind=\'host_salary\' '+
      'LEFT JOIN sharika_gift_events e ON e.id=a.gift_event_id '+
      'WHERE f.bd_uid=? GROUP BY f.id ORDER BY week_gifts DESC,f.id DESC LIMIT 100'
    ).bind(uid).all());
    const [total,activity,history]=await Promise.all([db.prepare(
      'SELECT COALESCE(SUM(amount_units),0) AS units FROM sharika_agency_earnings '+
      'WHERE beneficiary_uid=? AND kind=\'bd\' AND created_at>='+periodSql('week')
    ).bind(uid).first(),db.prepare(
      'SELECT COALESCE(SUM(active_seconds),0) AS seconds FROM sharika_agency_room_activity '+
      "WHERE user_uid=? AND utc_day=date('now')"
    ).bind(uid).first(),roomActivityDays(db,uid)]);
    return reply({families:families.map(f=>({...f,owner_id:publicId(f.owner_no),
      owner_no:undefined})),pending_bd_units:Number(total?.units)||0,
      bd_profile:{public_id:publicId(currentUser.public_no),name:currentUser.name,
        pic:currentUser.pic},today_active_seconds:Number(activity?.seconds)||0,
      bd_activity_by_day:history,
      payout_status:'pending_admin_verification',period:'week'},200,cors);
  }
  const familyMatch=/^\/api\/v1\/agency\/([1-9][0-9]{0,9})\/hosts$/.exec(path);
  if(familyMatch&&request.method==='GET'){
    const family=await familyRole(db,uid,Number(familyMatch[1]));
    if(!family)return fail('agency_not_found',404,cors);
    if(!family.is_owner&&!family.is_bd)return fail('agency_permission_denied',403,cors);
    const list=results(await db.prepare(
      'SELECT u.public_no,u.name,u.pic,h.active,h.assigned_at,'+
      'COALESCE(SUM(CASE WHEN a.kind=\'host_salary\' AND a.created_at>='+periodSql('today')+
      ' THEN e.quantity*e.price_coins ELSE 0 END),0) AS today_gifts,'+
      'COALESCE(SUM(CASE WHEN a.kind=\'host_salary\' AND a.created_at>='+periodSql('week')+
      ' THEN e.quantity*e.price_coins ELSE 0 END),0) AS week_gifts,'+
      'COALESCE(SUM(CASE WHEN a.kind=\'host_salary\' THEN a.amount_units ELSE 0 END),0) AS salary_units,'+
      'COALESCE(MAX(activity.today_seconds),0) AS today_seconds,'+
      'COALESCE(MAX(activity.week_seconds),0) AS week_seconds '+
      'FROM sharika_agency_hosts h JOIN sharika_users u ON u.auth_uid=h.host_uid '+
      'LEFT JOIN (SELECT user_uid,'+
      "SUM(CASE WHEN utc_day=date('now') THEN active_seconds ELSE 0 END) AS today_seconds,"+
      "SUM(CASE WHEN utc_day>=date('now','weekday 0','-6 days') THEN active_seconds ELSE 0 END) AS week_seconds "+
      'FROM sharika_agency_room_activity GROUP BY user_uid) activity ON activity.user_uid=h.host_uid '+
      'LEFT JOIN sharika_agency_earnings a ON a.host_uid=h.host_uid AND a.family_id=h.family_id '+
      'AND a.kind=\'host_salary\' '+
      'LEFT JOIN sharika_gift_events e ON e.id=a.gift_event_id '+
      'WHERE h.family_id=? GROUP BY h.host_uid ORDER BY week_gifts DESC,u.public_no LIMIT 200'
    ).bind(family.id).all());
    const [ownerTime,ownerDays]=await Promise.all([db.prepare(
      'SELECT COALESCE(SUM(active_seconds),0) AS seconds FROM sharika_agency_room_activity '+
      "WHERE user_uid=? AND utc_day=date('now')"
    ).bind(family.owner_uid).first(),roomActivityDays(db,family.owner_uid)]);
    return reply({agency:{id:family.id,name:family.name,status:family.status,logo:family.logo,
      owner_name:family.owner_name,owner_id:publicId(family.owner_no),
      owner_today_seconds:Number(ownerTime?.seconds)||0,owner_activity_by_day:ownerDays},
      hosts:list.map(x=>({...x,public_id:publicId(x.public_no),public_no:undefined,
        today_seconds:Number(x.today_seconds)||0,
        week_seconds:Number(x.week_seconds)||0})),source:'verified_host_recipient_gifts',
      activity_source:'server_verified_room_heartbeats'},200,cors);
  }
  const earningMatch=/^\/api\/v1\/agency\/host\/([0-9]{8})\/earnings$/.exec(path);
  if(earningMatch&&request.method==='GET'){
    const host=await db.prepare('SELECT h.host_uid,h.family_id,h.active,u.public_no,u.name,u.pic,'+
      'f.name AS agency_name,f.owner_uid,f.bd_uid '+
      'FROM sharika_agency_hosts h JOIN sharika_users u ON u.auth_uid=h.host_uid '+
      'JOIN sharika_families f ON f.id=h.family_id WHERE u.public_no=?')
      .bind(Number(earningMatch[1])).first();
    if(!host)return fail('host_not_found',404,cors);
    const permitted=uid===host.host_uid||uid===host.owner_uid||
      uid===host.bd_uid&&!!(await db.prepare('SELECT active FROM sharika_bd_agents WHERE bd_uid=?')
        .bind(uid).first())?.active;
    if(!permitted)return fail('host_report_permission_denied',403,cors);
    const period=new URL(request.url).searchParams.get('period')||'today';
    if(!periodSql(period))return fail('invalid_report_period',400,cors);
    const dateFrom=periodSql(period);
    const [total,gifts,activity,days,rooms,progress,targets]=await Promise.all([
      db.prepare('SELECT COALESCE(SUM(amount_units),0) AS units,'+
        'COUNT(*) AS gift_count FROM sharika_agency_earnings '+
        "WHERE host_uid=? AND kind='host_salary' AND created_at>="+dateFrom)
        .bind(host.host_uid).first(),
      db.prepare('SELECT e.created_at,e.quantity,e.price_coins,g.name AS gift_name,'+
        'su.public_no AS sender_no, e.quantity*e.price_coins AS gift_coins '+
        'FROM sharika_gift_events e '+
        'JOIN sharika_agency_earnings a ON a.gift_event_id=e.id AND a.kind=\'host_salary\' '+
        'JOIN sharika_gifts g ON g.id=e.gift_id '+
        'JOIN sharika_users su ON su.auth_uid=e.sender_uid '+
        'WHERE a.host_uid=? AND a.created_at>='+dateFrom+' ORDER BY e.id DESC LIMIT 100'
      ).bind(host.host_uid).all(),
      db.prepare('SELECT COALESCE(SUM(active_seconds),0) AS seconds '+
        'FROM sharika_agency_room_activity WHERE user_uid=? AND utc_day>='+periodDaySql(period))
        .bind(host.host_uid).first(),
      roomActivityDays(db,host.host_uid),
      db.prepare("SELECT a.room_id,COALESCE(r.name,'Room · ' || a.room_id) AS room_name,"+
        'SUM(a.active_seconds) AS seconds FROM sharika_agency_room_activity a '+
        'LEFT JOIN sharika_rooms r ON r.id=a.room_id '+
        'WHERE a.user_uid=? AND a.utc_day>='+periodDaySql(period)+
      ' GROUP BY a.room_id ORDER BY seconds DESC LIMIT 50').bind(host.host_uid).all(),
      db.prepare('SELECT COALESCE(SUM(e.quantity*e.price_coins),0) AS coins '+
        'FROM sharika_agency_earnings a JOIN sharika_gift_events e ON e.id=a.gift_event_id '+
        "WHERE a.kind='host_salary' AND a.host_uid=?").bind(host.host_uid).first(),
      salaryTargets(db)
    ]);
    return reply({host:{public_id:publicId(host.public_no),name:host.name,pic:host.pic,
      active:!!host.active,agency_id:host.family_id,agency_name:host.agency_name},
      period,estimated_salary_units:Number(total?.units)||0,
      qualified_gift_events:Number(total?.gift_count)||0,
      gifts:results(gifts).map(x=>({...x,sender_id:publicId(x.sender_no),sender_no:undefined})),
      active_seconds:Number(activity?.seconds)||0,
      activity_by_day:days,
      activity_by_room:results(rooms).map(x=>({...x,seconds:Number(x.seconds)||0})),
      activity_source:'server_verified_room_heartbeats',
      target_progress_coins:Number(progress?.coins)||0,
      targets:targets.map(t=>({...t,completed:(Number(progress?.coins)||0)>=t.target_coins})),
      payout_status:'pending_admin_verification',currency:'estimated_coins',
      source:'verified_regular_gifts_to_host'},200,cors);
  }
  if(path==='/api/v1/agency/hosts/assign'&&request.method==='POST'){
    let body;try{body=await parseBody(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(!Number.isSafeInteger(body.agency_id)||body.agency_id<1||
      !isPublicId(body.host_public_id)||typeof body.active!=='boolean')
      return fail('invalid_host_assignment',400,cors);
    const family=await familyRole(db,uid,body.agency_id);
    if(!family?.is_owner||family.status!=='active')return fail('agency_owner_only',403,cors);
    const member=await db.prepare('SELECT m.user_uid FROM sharika_family_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_uid '+
      "WHERE m.family_id=? AND u.public_no=? AND u.status='active' AND u.minor=0")
      .bind(body.agency_id,Number(body.host_public_id)).first();
    if(!member)return fail('host_must_be_approved_adult_member',409,cors);
    const previous=await db.prepare('SELECT family_id FROM sharika_agency_hosts WHERE host_uid=?')
      .bind(member.user_uid).first();
    if(previous&&previous.family_id!==body.agency_id)
      return fail('host_already_assigned_elsewhere',409,cors);
    await db.batch([
      db.prepare('INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by) '+
        'VALUES(?,?,?,?) ON CONFLICT(host_uid) DO UPDATE SET active=excluded.active,'+
        "updated_at=datetime('now')")
        .bind(member.user_uid,body.agency_id,Number(body.active),uid),
      // Admin audit accepts owner-originated role actions; the historical
      // Family activity CHECK disallows 'host_assignment' and would roll
      // back the whole D1 batch (including the Host activation).
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'agency_owner_host_assignment',JSON.stringify({
          agency_id:body.agency_id,host_public_id:body.host_public_id,active:body.active
        }))
    ]);
    return reply({saved:true,host_public_id:body.host_public_id,active:body.active},200,cors);
  }
  return fail('agency_route_not_found',404,cors);
}

export async function handleAgencyAdmin({request,env,uid,actor:admin,operation,cors,reply,fail}){
  if(!(operation==='agency'||operation.startsWith('agency/')))return null;
  if(!['super','finance'].includes(admin.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='agency'&&request.method==='GET'){
    const [settings,salary,targets]=await Promise.all([
      policy(db),salaryConfig(db),salaryTargets(db)]);
    const hosts=results(await db.prepare('SELECT h.family_id,h.active,u.public_no,u.name,u.pic,'+
      'f.name AS agency_name FROM sharika_agency_hosts h '+
      'JOIN sharika_users u ON u.auth_uid=h.host_uid '+
      'JOIN sharika_families f ON f.id=h.family_id ORDER BY h.updated_at DESC LIMIT 200').all());
    return reply({policy:{enabled:!!settings.active,host_bps:settings.host_bps,
      agency_bps:settings.agency_bps,bd_bps:settings.bd_bps,
      settlement_mode:settings.settlement_mode},
      salary_config:{coins_per_usd:salary.coins_per_usd,
        min_host_target_coins:salary.min_host_target_coins,
        exchange_enabled:!!salary.exchange_enabled,version:salary.version},
      targets:targets.map(t=>t.target_coins),
      hosts:hosts.map(h=>({...h,public_id:publicId(h.public_no),public_no:undefined})),
      payouts_enabled:!!salary.exchange_enabled,
      payout_status:salary.exchange_enabled?'configured_period_exchange':'manual_review_required'},200,cors);
  }
  if(admin.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='agency/salary/policy'&&request.method==='PATCH'){
    let body;try{body=await parseBody(request);}catch{return fail('invalid_agency_body',400,cors);}
    const current=await salaryConfig(db);
    const targets=body.targets;
    if(!Number.isSafeInteger(body.expected_version)||body.expected_version!==current.version)
      return fail('agency_salary_policy_changed',409,cors);
    if(!Array.isArray(targets)||targets.length<1||targets.length>12||
      targets.some((x,i)=>!Number.isSafeInteger(x)||
        x<1||x>1000000000000||(i>0&&x<=targets[i-1]))||
      !Number.isSafeInteger(body.coins_per_usd)||body.coins_per_usd<1||
      body.coins_per_usd>1000000000||typeof body.exchange_enabled!=='boolean')
      return fail('invalid_agency_salary_policy',400,cors);
    const before={...current,targets:(await salaryTargets(db)).map(t=>t.target_coins)};
    const statements=[
      db.prepare('UPDATE sharika_agency_salary_config SET coins_per_usd=?,min_host_target_coins=?,'+
        'exchange_enabled=?,version=CASE WHEN version=? THEN version+1 ELSE 0 END,'+
        "updated_by=?,updated_at=datetime('now') WHERE key='standard'")
        .bind(body.coins_per_usd,targets[0],Number(body.exchange_enabled),current.version,uid),
      db.prepare('UPDATE sharika_agency_salary_targets SET active=0')
    ];
    for(const target of targets)statements.push(db.prepare(
      'INSERT INTO sharika_agency_salary_targets(target_coins,active) VALUES(?,1) '+
      "ON CONFLICT(target_coins) DO UPDATE SET active=1,updated_at=datetime('now')")
      .bind(target));
    statements.push(db.prepare('INSERT INTO sharika_agency_salary_policy_audit(actor_uid,'+
      'old_json,new_json) VALUES(?,?,?)').bind(uid,JSON.stringify(before),
      JSON.stringify({coins_per_usd:body.coins_per_usd,targets,
        exchange_enabled:body.exchange_enabled,version:current.version+1})));
    try{await db.batch(statements);}catch(error){
      if(/CHECK constraint/.test(String(error)))return fail('agency_salary_policy_changed',409,cors);
      throw error;
    }
    return reply({saved:true,version:current.version+1,
      applies_to:'future_eligibility_and_exchange_only'},200,cors);
  }
  if(operation==='agency/policy'&&request.method==='PATCH'){
    let body;try{body=await parseBody(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(typeof body.enabled!=='boolean'||!['daily','weekly','monthly'].includes(body.settlement_mode)||
      !Number.isSafeInteger(body.host_bps)||body.host_bps<0||body.host_bps>8000||
      !Number.isSafeInteger(body.agency_bps)||body.agency_bps<0||body.agency_bps>5000||
      !Number.isSafeInteger(body.bd_bps)||body.bd_bps<0||body.bd_bps>3000||
      body.host_bps+body.agency_bps+body.bd_bps>10000)
      return fail('invalid_agency_policy',400,cors);
    const before=await policy(db);
    await db.batch([
      db.prepare('UPDATE sharika_agency_policy SET active=?,host_bps=?,agency_bps=?,bd_bps=?,'+
        "settlement_mode=?,updated_by=?,updated_at=datetime('now') WHERE key='standard'")
        .bind(Number(body.enabled),body.host_bps,body.agency_bps,body.bd_bps,body.settlement_mode,uid),
      db.prepare('INSERT INTO sharika_agency_policy_audit(actor_uid,before_json,after_json) '+
        'VALUES(?,?,?)').bind(uid,JSON.stringify(before),JSON.stringify(body))
    ]);
    return reply({saved:true,applies_to:'future_verified_gifts_only'},200,cors);
  }
  if(operation==='agency/hosts/assign'&&request.method==='POST'){
    let body;try{body=await parseBody(request);}catch{return fail('invalid_agency_body',400,cors);}
    if(!Number.isSafeInteger(body.agency_id)||body.agency_id<1||
      !isPublicId(body.host_public_id)||typeof body.active!=='boolean')
      return fail('invalid_host_assignment',400,cors);
    const family=await db.prepare('SELECT id,status FROM sharika_families WHERE id=?')
      .bind(body.agency_id).first();
    if(!family||family.status!=='active')return fail('agency_not_active',409,cors);
    const host=await db.prepare('SELECT u.auth_uid FROM sharika_users u '+
      'JOIN sharika_family_members m ON m.user_uid=u.auth_uid '+
      "WHERE m.family_id=? AND u.public_no=? AND u.status='active' AND u.minor=0")
      .bind(body.agency_id,Number(body.host_public_id)).first();
    if(!host)return fail('host_must_be_approved_adult_member',409,cors);
    const previous=await db.prepare('SELECT family_id FROM sharika_agency_hosts WHERE host_uid=?')
      .bind(host.auth_uid).first();
    if(previous&&previous.family_id!==body.agency_id)
      return fail('host_already_assigned_elsewhere',409,cors);
    await db.batch([
      db.prepare('INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by) '+
        'VALUES(?,?,?,?) ON CONFLICT(host_uid) DO UPDATE SET active=excluded.active,'+
        "updated_at=datetime('now')")
        .bind(host.auth_uid,body.agency_id,Number(body.active),uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'agency_host_assignment',JSON.stringify({family_id:body.agency_id,
          host_public_id:body.host_public_id,active:body.active}))
    ]);
    return reply({saved:true,host_public_id:body.host_public_id,active:body.active},200,cors);
  }
  return fail('agency_admin_route_not_found',404,cors);
}
