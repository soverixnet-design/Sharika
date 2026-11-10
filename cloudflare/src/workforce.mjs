// Verified BD > Agency > Host salaries; 10,000 salary units equal one coin.
// All gift salaries are settled by migration 0057's INSERT trigger, never by UI.
const REQ=/^[A-Za-z0-9:_-]{12,80}$/;
const PUBLIC_ID=/^[0-9]{8}$/;
const ROLES=new Set(['bd','agency','host','assistant_bd','assistant_agency']);
const PARENTS={bd:null,agency:'bd',host:'agency',assistant_bd:'bd',assistant_agency:'agency'};
const MODES=new Set(['daily','weekly','monthly']);
const policyFields=['enabled','host_bps','agency_bps','bd_bps','direct_exchange_bps',
  'coins_per_usd','settlement_mode','salary_exchange_enabled'];
const rows=record=>record?.results||[];
const publicId=value=>String(value).padStart(8,'0');
const number=value=>Number(value)||0;

async function bodyOf(request){
  const raw=await request.text();
  if(raw.length>10000)throw Error('workforce_body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_workforce_body');
  return body;
}
async function policy(db){
  const row=await db.prepare('SELECT * FROM sharika_workforce_policy WHERE id=1').first();
  if(!row)throw Error('workforce_migration_required');
  return row;
}
async function active(db,uid){
  return db.prepare("SELECT auth_uid,public_no,name,minor FROM sharika_users WHERE auth_uid=? AND status='active'")
    .bind(uid).first();
}
async function member(db,uid){
  return db.prepare('SELECT * FROM sharika_workforce_members WHERE auth_uid=?')
    .bind(uid).first();
}
async function targetList(db){
  return rows(await db.prepare('SELECT id,label,target_coins FROM sharika_workforce_targets '+
    'WHERE active=1 ORDER BY target_coins ASC LIMIT 20').all());
}
function maturityCondition(mode){
  return mode==='daily' ? "datetime('now','start of day')" :
    mode==='weekly' ? "datetime('now','weekday 0','-6 days','start of day')" :
    "datetime('now','start of month')";
}
async function salarySummary(db,uid,mode){
  const credits=await db.prepare('SELECT kind,COALESCE(SUM(salary_units),0) AS units,'+
    'COALESCE(SUM(gift_coins),0) AS gift_coins,COUNT(*) AS gifts '+
    'FROM sharika_workforce_salary_ledger WHERE beneficiary_uid=? GROUP BY kind').bind(uid).all();
  const matured=await db.prepare('SELECT COALESCE(SUM(salary_units),0) AS units '+
    'FROM sharika_workforce_salary_ledger WHERE beneficiary_uid=? AND created_at < '+
    maturityCondition(mode)).bind(uid).first();
  const exchanged=await db.prepare('SELECT COALESCE(SUM(salary_units),0) AS units '+
    'FROM sharika_workforce_salary_exchanges WHERE auth_uid=?').bind(uid).first();
  const earnings=rows(credits).reduce((s,r)=>s+number(r.units),0);
  const paid=number(exchanged?.units);
  return {earned_units:earnings,exchanged_units:paid,
    matured_available_units:Math.max(0,number(matured?.units)-paid),
    remaining_units:Math.max(0,earnings-paid),by_kind:rows(credits)};
}
async function hostTargetProgress(db,uid,assignedAt){
  const record=await db.prepare('SELECT COALESCE(SUM(gift_coins),0) AS coins '+
    'FROM sharika_workforce_host_gifts WHERE host_uid=? AND created_at>=?')
    .bind(uid,assignedAt).first();
  return number(record?.coins);
}
async function roster(db,actor,limit=100){
  if(!actor?.active)return [];
  let parentUid=actor.auth_uid;
  if(actor.role==='assistant_bd'||actor.role==='assistant_agency')parentUid=actor.parent_uid;
  return rows(await db.prepare('SELECT m.auth_uid,m.role,m.active,m.assigned_at,'+
    'u.public_no,u.name,COALESCE(SUM(CASE WHEN l.kind=m.role THEN l.gift_coins ELSE 0 END),0) AS gift_coins '+
    'FROM sharika_workforce_members m JOIN sharika_users u ON u.auth_uid=m.auth_uid '+
    'LEFT JOIN sharika_workforce_salary_ledger l ON l.beneficiary_uid=m.auth_uid '+
    'WHERE m.parent_uid=? GROUP BY m.auth_uid ORDER BY m.assigned_at DESC LIMIT ?')
    .bind(parentUid,limit).all()).map(r=>({...r,public_id:publicId(r.public_no),public_no:undefined}));
}
async function readCenter(db,uid){
  const user=await active(db,uid);
  if(!user)return null;
  const current=await policy(db),role=await member(db,uid);
  const targets=await targetList(db);
  const salary=await salarySummary(db,uid,current.settlement_mode);
  const exchangeHistory=rows(await db.prepare('SELECT credited_coins,salary_units,settlement_mode,created_at '+
    'FROM sharika_workforce_salary_exchanges WHERE auth_uid=? ORDER BY id DESC LIMIT 30')
    .bind(uid).all());
  const recentSalary=rows(await db.prepare('SELECT l.kind,l.gift_coins,l.salary_units,l.rate_bps,l.created_at,'+
    'u.public_no AS host_no FROM sharika_workforce_salary_ledger l '+
    'JOIN sharika_users u ON u.auth_uid=l.host_uid '+
    'WHERE l.beneficiary_uid=? ORDER BY l.id DESC LIMIT 30').bind(uid).all())
    .map(r=>({...r,host_id:publicId(r.host_no),host_no:undefined}));
  let ancestry=[];
  if(role?.parent_uid){
    ancestry=rows(await db.prepare('SELECT u.public_no,u.name,m.role FROM sharika_workforce_members m '+
      'JOIN sharika_users u ON u.auth_uid=m.auth_uid WHERE m.auth_uid=? OR m.auth_uid='+
      '(SELECT parent_uid FROM sharika_workforce_members WHERE auth_uid=?)')
      .bind(role.parent_uid,role.parent_uid).all()).map(r=>({role:r.role,
        public_id:publicId(r.public_no),name:r.name}));
  }
  const totalHostGifts=role?.role==='host'&&role.active?
    await hostTargetProgress(db,uid,role.assigned_at):0;
  return {user:{public_id:publicId(user.public_no),name:user.name},
    role:role?{kind:role.role,active:!!role.active,assigned_at:role.assigned_at}:null,
    ancestry,policy:{...current,updated_by:undefined},targets,
    host_target_gifts:totalHostGifts,
    target_progress:targets.map(t=>({...t,completed:totalHostGifts>=t.target_coins,
      progress:Math.min(totalHostGifts,t.target_coins)})),
    salary,roster:await roster(db,{...role,auth_uid:uid}),recent_salary:recentSalary,
    exchanges:exchangeHistory,source:'verified_d1_workforce',read_only:!role?.active};
}
function failed(fail,cors,error){
  const message=String(error?.message||error);
  if(/workforce_parent_invalid|workforce_member_reparent_forbidden|workforce_descendants_active|UNIQUE constraint|FOREIGN KEY constraint/.test(message))
    return fail('workforce_assignment_conflict',409,cors);
  if(/salary_not_matured_or_insufficient|salary_exchange_disabled|salary_exchange_ineligible/.test(message))
    return fail('salary_exchange_not_available',409,cors);
  if(/workforce_body_too_large|invalid_workforce_body|SyntaxError/.test(message))
    return fail('invalid_workforce_request',400,cors);
  console.error('workforce_error',message);
  return fail('workforce_service_unavailable',503,cors);
}
async function assign(db,actorUid,targetPublicId,role,parentUid,superAdmin){
  if(!ROLES.has(role)||!PUBLIC_ID.test(String(targetPublicId)))
    throw Error('invalid_assignment');
  const target=await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
    .bind(Number(targetPublicId)).first();
  if(!target)throw Error('target_not_found');
  if(target.auth_uid===actorUid)throw Error('cannot_assign_self');
  const parentRole=PARENTS[role];
  if(parentRole){
    const parent=await member(db,parentUid);
    if(!parent||!parent.active||parent.role!==parentRole)throw Error('workforce_parent_invalid');
  }else if(parentUid)throw Error('workforce_parent_invalid');
  const prior=await member(db,target.auth_uid);
  if(prior){
    if(prior.role!==role||prior.parent_uid!==parentUid)
      throw Error('workforce_member_reparent_forbidden');
    if(prior.active)return {assigned:false,duplicate:true};
    await db.batch([
      db.prepare("UPDATE sharika_workforce_members SET active=1,updated_at=datetime('now') WHERE auth_uid=?")
        .bind(target.auth_uid),
      db.prepare('INSERT INTO sharika_workforce_assignment_audit(actor_uid,target_uid,action,role,parent_uid) '+
        "VALUES(?,?,'reactivate',?,?)").bind(actorUid,target.auth_uid,role,parentUid)
    ]);
    return {assigned:true,reactivated:true};
  }
  if(!superAdmin && role==='bd')throw Error('workforce_assignment_forbidden');
  await db.batch([
    db.prepare('INSERT INTO sharika_workforce_members(auth_uid,role,parent_uid,assigned_by) VALUES(?,?,?,?)')
      .bind(target.auth_uid,role,parentUid,actorUid),
    db.prepare('INSERT INTO sharika_workforce_assignment_audit(actor_uid,target_uid,action,role,parent_uid) '+
      "VALUES(?,?,'assign',?,?)").bind(actorUid,target.auth_uid,role,parentUid)
  ]);
  return {assigned:true};
}

export async function handleWorkforceApp({request,env,uid,path,cors,reply,fail}){
  if(!path.startsWith('/api/v1/workforce'))return null;
  const db=env.DB;
  try{
    if(!await active(db,uid))return fail('profile_unavailable',403,cors);
    if(path==='/api/v1/workforce/me'&&request.method==='GET')
      return reply(await readCenter(db,uid),200,cors);
    if(path==='/api/v1/workforce/assign'&&request.method==='POST'){
      const actor=await member(db,uid);
      if(!actor?.active||!['bd','agency'].includes(actor.role))
        return fail('workforce_assignment_forbidden',403,cors);
      const payload=await bodyOf(request);
      const allowed=actor.role==='bd'?new Set(['agency','assistant_bd']):
        new Set(['host','assistant_agency']);
      if(!allowed.has(payload.role)||!PUBLIC_ID.test(String(payload.public_id||'')))
        return fail('invalid_assignment',400,cors);
      const done=await assign(db,uid,payload.public_id,payload.role,uid,false);
      return reply({ok:true,...done},200,cors);
    }
    if(path==='/api/v1/workforce/salary/exchange'&&request.method==='POST'){
      const payload=await bodyOf(request);
      if(!REQ.test(String(payload.request_id||''))||!Number.isSafeInteger(payload.coins)||
        payload.coins<1||payload.coins>100000000)
        return fail('invalid_salary_exchange',400,cors);
      const prior=await db.prepare('SELECT credited_coins FROM sharika_workforce_salary_exchanges '+
        'WHERE auth_uid=? AND request_id=?').bind(uid,payload.request_id).first();
      if(prior)return number(prior.credited_coins)===payload.coins?
        reply({ok:true,credited_coins:number(prior.credited_coins),duplicate:true},200,cors):
        fail('idempotency_conflict',409,cors);
      const current=await policy(db);
      if(!current.enabled||!current.salary_exchange_enabled)
        return fail('salary_exchange_disabled',403,cors);
      if(payload.expected_version!==current.version)
        return fail('workforce_policy_changed',409,cors);
      const salaryUnits=payload.coins*10000;
      try{
        await db.batch([
          db.prepare('INSERT INTO sharika_workforce_salary_exchanges(auth_uid,salary_units,credited_coins,'+
            'settlement_mode,policy_version,request_id) VALUES(?,?,?,?,?,?)')
            .bind(uid,salaryUnits,payload.coins,current.settlement_mode,current.version,payload.request_id),
          db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
            "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
            .bind(1000000000000-payload.coins,payload.coins,uid),
          db.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
            "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'workforce_salary_exchange',?)")
            .bind(uid,payload.coins,uid,'wfs:'+payload.request_id)
        ]);
      }catch(error){return failed(fail,cors,error);}
      return reply({ok:true,credited_coins:payload.coins,duplicate:false},200,cors);
    }
    return fail('workforce_route_not_found',404,cors);
  }catch(error){return failed(fail,cors,error);}
}

export async function handleWorkforceAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='workforce'&&!operation.startsWith('workforce/'))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  try{
    const current=await policy(db);
    if(operation==='workforce'&&request.method==='GET'){
      const all=rows(await db.prepare('SELECT m.role,m.active,m.parent_uid,m.assigned_at,'+
        'u.public_no,u.name,COALESCE(SUM(l.salary_units),0) AS earned_units '+
        'FROM sharika_workforce_members m JOIN sharika_users u ON u.auth_uid=m.auth_uid '+
        'LEFT JOIN sharika_workforce_salary_ledger l ON l.beneficiary_uid=m.auth_uid '+
        'GROUP BY m.auth_uid ORDER BY m.assigned_at DESC LIMIT 500').all())
        .map(r=>({...r,public_id:publicId(r.public_no),public_no:undefined,parent_uid:undefined}));
      return reply({policy:{...current,updated_by:undefined},targets:await targetList(db),members:all,
        read_only:actor.role!=='super',source:'verified_d1_workforce'},200,cors);
    }
    if(operation==='workforce/policy'&&request.method==='PATCH'){
      if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
      const payload=await bodyOf(request);
      if(!Number.isSafeInteger(payload.expected_version)||payload.expected_version!==current.version)
        return fail('workforce_policy_changed',409,cors);
      const values={};
      for(const field of policyFields)values[field]=payload[field]===undefined?current[field]:payload[field];
      for(const field of ['enabled','salary_exchange_enabled'])
        if(![0,1].includes(values[field]))return fail('invalid_workforce_policy',400,cors);
      for(const field of ['host_bps','agency_bps','bd_bps','direct_exchange_bps'])
        if(!Number.isSafeInteger(values[field])||values[field]<0||values[field]>10000)
          return fail('invalid_workforce_policy',400,cors);
      if(values.direct_exchange_bps<100||values.direct_exchange_bps%100!==0)
        return fail('invalid_workforce_exchange_increment',400,cors);
      if(values.host_bps+values.agency_bps+values.bd_bps+values.direct_exchange_bps>10000||
        !Number.isSafeInteger(values.coins_per_usd)||values.coins_per_usd<1||
        values.coins_per_usd>1000000000||!MODES.has(values.settlement_mode))
        return fail('invalid_workforce_policy',400,cors);
      const list=payload.targets;
      if(!Array.isArray(list)||list.length<1||list.length>12||list[0]!==5000000||
        list.some((n,i)=>!Number.isSafeInteger(n)||n>1000000000000||n<5000000||
          (i>0&&n<=list[i-1])))return fail('invalid_workforce_targets',400,cors);
      const before={...current,targets:(await targetList(db)).map(t=>t.target_coins)};
      const next={...values,version:current.version+1,targets:list};
      const statements=[db.prepare('UPDATE sharika_workforce_policy SET '+
        policyFields.map(field=>field+'=?').join(',')+
        ",version=CASE WHEN version=? THEN version+1 ELSE 0 END,updated_by=?,updated_at=datetime('now') WHERE id=1")
        .bind(...policyFields.map(f=>values[f]),current.version,uid),
        db.prepare('UPDATE sharika_workforce_targets SET active=0')];
      for(const targetCoins of list)statements.push(db.prepare(
        'INSERT INTO sharika_workforce_targets(target_coins,label,active) VALUES(?,?,1) '+
        "ON CONFLICT(target_coins) DO UPDATE SET active=1,label=excluded.label,updated_at=datetime('now')")
        .bind(targetCoins,`${targetCoins/1000000}M`));
      statements.push(db.prepare('INSERT INTO sharika_workforce_policy_audit(actor_uid,old_json,new_json) '+
        'VALUES(?,?,?)').bind(uid,JSON.stringify(before),JSON.stringify(next)));
      try{await db.batch(statements);}catch(error){
        if(/CHECK constraint/.test(String(error)))return fail('workforce_policy_changed',409,cors);
        throw error;
      }
      return reply({ok:true,policy:next},200,cors);
    }
    if(operation==='workforce/assign'&&request.method==='POST'){
      if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
      const payload=await bodyOf(request);
      const parentId=payload.parent_public_id;
      let parentUid=null;
      if(payload.role!=='bd'){
        if(!PUBLIC_ID.test(String(parentId||'')))return fail('invalid_assignment',400,cors);
        const parent=await db.prepare('SELECT auth_uid FROM sharika_users WHERE public_no=?')
          .bind(Number(parentId)).first();
        if(!parent)return fail('workforce_parent_not_found',404,cors);
        parentUid=parent.auth_uid;
      }
      const result=await assign(db,uid,payload.public_id,payload.role,parentUid,true);
      return reply({ok:true,...result},200,cors);
    }
    if(operation==='workforce/deactivate'&&request.method==='POST'){
      if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
      const payload=await bodyOf(request);
      if(!PUBLIC_ID.test(String(payload.public_id||'')))return fail('invalid_assignment',400,cors);
      const target=await db.prepare('SELECT m.auth_uid,m.role,m.parent_uid,m.active FROM sharika_workforce_members m '+
        'JOIN sharika_users u ON u.auth_uid=m.auth_uid WHERE u.public_no=?')
        .bind(Number(payload.public_id)).first();
      if(!target)return fail('workforce_member_not_found',404,cors);
      if(!target.active)return reply({ok:true,unchanged:true},200,cors);
      await db.batch([
        db.prepare("UPDATE sharika_workforce_members SET active=0,updated_at=datetime('now') WHERE auth_uid=?")
          .bind(target.auth_uid),
        db.prepare('INSERT INTO sharika_workforce_assignment_audit(actor_uid,target_uid,action,role,parent_uid) '+
          "VALUES(?,?,'deactivate',?,?)").bind(uid,target.auth_uid,target.role,target.parent_uid)
      ]);
      return reply({ok:true},200,cors);
    }
    return fail('workforce_admin_route_not_found',404,cors);
  }catch(error){return failed(fail,cors,error);}
}
