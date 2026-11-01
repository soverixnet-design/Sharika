// Verified weekly CP rewards. Only a completed UTC week can be settled.
// No gifts or balances are fabricated by the client. Rewards default OFF.
const WEEK=7*24*60*60*1000;
const MAX_BALANCE=1_000_000_000_000;
const rows=result=>result?.results||[];
const pad=id=>String(id).padStart(8,'0');
const appearance=(alias,kind)=>'COALESCE((SELECT substr(e.item_id,instr(e.item_id,\':\')+1) '+
  'FROM sharika_cosmetic_equipped e WHERE e.auth_uid='+alias+'.auth_uid '+
  "AND e.kind='"+kind+"'),"+alias+'.'+kind+",'')";

async function boundedBody(request,maxBytes){
  if(Number(request.headers.get('content-length'))>maxBytes)throw Error('body_too_large');
  if(!request.body)return {};
  const reader=request.body.getReader();
  const chunks=[];let count=0;
  try{
    while(true){
      const part=await reader.read();if(part.done)break;
      count+=part.value.byteLength;
      if(count>maxBytes)throw Error('body_too_large');
      chunks.push(part.value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  const buffer=new Uint8Array(count);let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder().decode(buffer)||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_body');
  return value;
}

export function cpWeekStart(nowMs=Date.now()){
  const date=new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()-
    (date.getUTCDay()+6)%7);
}
async function policyAndRules(db){
  const [policy,list]=await Promise.all([
    db.prepare("SELECT enabled,auto_award,auto_start_week_ms FROM sharika_cp_reward_policy WHERE key='weekly'").first(),
    db.prepare('SELECT r.rank,r.coins_each,r.frame_item_id,r.medal_item_id,'+
      'f.name AS frame_name,m.name AS medal_name FROM sharika_cp_reward_rules r '+
      'LEFT JOIN sharika_cosmetics_catalog f ON f.id=r.frame_item_id '+
      'LEFT JOIN sharika_cosmetics_catalog m ON m.id=r.medal_item_id ORDER BY r.rank').all()
  ]);
  if(!policy||rows(list).length!==7)throw Error('cp_reward_migration_required');
  return {policy:{enabled:!!policy.enabled,auto_award:!!policy.auto_award,
    auto_start_week_ms:Number(policy.auto_start_week_ms)},
    rules:rows(list).map(r=>({rank:Number(r.rank),coins_each:Number(r.coins_each),
      frame_item_id:r.frame_item_id||null,medal_item_id:r.medal_item_id||null,
      frame_name:r.frame_name||null,medal_name:r.medal_name||null}))};
}
function mapPair(row,index){
  return {rank:Number(row.rank??index+1),bond_id:Number(row.bond_id),total:Number(row.total),
    a:{id:pad(row.a_id),name:row.a_name,pic:row.a_pic,
      frame_style:row.a_frame||'',medal_style:row.a_medal||''},
    b:{id:pad(row.b_id),name:row.b_name,pic:row.b_pic,
      frame_style:row.b_frame||'',medal_style:row.b_medal||''}};
}
async function weeklyLeaders(db,start,end){
  const list=await db.prepare('SELECT b.id AS bond_id,b.uid_a,b.uid_b,'+
    'ua.public_no AS a_id,ua.name AS a_name,ua.pic AS a_pic,'+
    appearance('ua','frame_style')+' AS a_frame,'+
    appearance('ua','medal_style')+' AS a_medal,'+
    'ub.public_no AS b_id,ub.name AS b_name,ub.pic AS b_pic,'+
    appearance('ub','frame_style')+' AS b_frame,'+
    appearance('ub','medal_style')+' AS b_medal,'+
    'SUM(e.value_coins) AS total FROM sharika_bond_gift_events e '+
    'JOIN sharika_bonds b ON b.id=e.bond_id '+
    'JOIN sharika_users ua ON ua.auth_uid=b.uid_a '+
    'JOIN sharika_users ub ON ub.auth_uid=b.uid_b '+
    "WHERE b.type='cp' AND ua.status='active' AND ub.status='active' "+
    'AND b.created_at_ms<? AND (b.ended_at_ms IS NULL OR b.ended_at_ms>=?) '+
    'AND e.created_at_ms>=? AND e.created_at_ms<? '+
    'GROUP BY b.id ORDER BY total DESC,b.id ASC LIMIT 7')
    .bind(end,end,start,end).all();
  return rows(list);
}
async function paidLeaders(db,start){
  const list=await db.prepare('SELECT w.rank,w.bond_id,w.score AS total,'+
    'ua.public_no AS a_id,ua.name AS a_name,ua.pic AS a_pic,'+
    appearance('ua','frame_style')+' AS a_frame,'+
    appearance('ua','medal_style')+' AS a_medal,'+
    'ub.public_no AS b_id,ub.name AS b_name,ub.pic AS b_pic,'+
    appearance('ub','frame_style')+' AS b_frame,'+
    appearance('ub','medal_style')+' AS b_medal,'+
    'w.coins_each,w.frame_item_id,w.medal_item_id,'+
    'f.name AS frame_name,m.name AS medal_name '+
    'FROM sharika_cp_reward_winners w '+
    'JOIN sharika_users ua ON ua.auth_uid=w.uid_a '+
    'JOIN sharika_users ub ON ub.auth_uid=w.uid_b '+
    'LEFT JOIN sharika_cosmetics_catalog f ON f.id=w.frame_item_id '+
    'LEFT JOIN sharika_cosmetics_catalog m ON m.id=w.medal_item_id '+
    'WHERE w.week_start_ms=? ORDER BY w.rank').bind(start).all();
  return rows(list);
}
export async function readCpRewardBoard(db,nowMs=Date.now()){
  const current=cpWeekStart(nowMs),last=current-WEEK;
  const [config,batch]=await Promise.all([
    policyAndRules(db),
    db.prepare('SELECT week_start_ms,awarded_at_ms,winner_count FROM sharika_cp_reward_batches '+
      'WHERE week_start_ms=?').bind(last).first()
  ]);
  const leaders=batch?await paidLeaders(db,last):await weeklyLeaders(db,last,current);
  const rules=new Map(config.rules.map(r=>[r.rank,r]));
  return {...config,server_time_ms:nowMs,current_week_start_ms:current,
    next_reset_ms:current+WEEK,last_week:{start_ms:last,end_ms:current,
      awarded:!!batch,awarded_at_ms:batch?Number(batch.awarded_at_ms):null,
      leaders:leaders.map((r,i)=>({...mapPair(r,i),
        reward:batch?{coins_each:Number(r.coins_each),frame_item_id:r.frame_item_id||null,
          medal_item_id:r.medal_item_id||null,frame_name:r.frame_name||null,
          medal_name:r.medal_name||null}:rules.get(i+1)}))}};
}

// D1 batch is transactional. A unique week row is first, so overlapping admin
// requests or a cron retry cannot double-credit any member or re-grant items.
export async function settleLastCpWeek(db,nowMs=Date.now(),issuer='system',automatic=false){
  const current=cpWeekStart(nowMs),last=current-WEEK;
  if(last<=0)return {skipped:'no_completed_week'};
  const config=await policyAndRules(db);
  if(!config.policy.enabled)return {skipped:'disabled'};
  if(automatic&&(!config.policy.auto_award||last<config.policy.auto_start_week_ms))
    return {skipped:'auto_not_active'};
  const previous=await db.prepare('SELECT winner_count FROM sharika_cp_reward_batches '+
    'WHERE week_start_ms=?').bind(last).first();
  if(previous)return {duplicate:true,week_start_ms:last,winner_count:Number(previous.winner_count)};
  const winners=await weeklyLeaders(db,last,current);
  const rules=new Map(config.rules.map(rule=>[rule.rank,rule]));
  // Preflight prevents a large reward from overflowing the application's
  // safe balance range. The conditional UPDATE rechecks this inside the batch.
  for(let index=0;index<winners.length;index++){
    const row=winners[index],rule=rules.get(index+1);
    for(const uid of [row.uid_a,row.uid_b]){
      const account=await db.prepare('SELECT coins,status FROM sharika_users WHERE auth_uid=?')
        .bind(uid).first();
      if(!account||account.status!=='active'||Number(account.coins)>MAX_BALANCE-rule.coins_each)
        throw Error('cp_reward_wallet_preflight_failed');
    }
  }
  const work=[db.prepare('INSERT INTO sharika_cp_reward_batches '+
    '(week_start_ms,week_end_ms,issued_by,awarded_at_ms,winner_count) VALUES(?,?,?,?,?)')
    .bind(last,current,issuer,nowMs,winners.length)];
  for(let index=0;index<winners.length;index++){
    const rank=index+1,w=winners[index],rule=rules.get(rank);
    work.push(db.prepare('INSERT INTO sharika_cp_reward_winners '+
      '(week_start_ms,rank,bond_id,uid_a,uid_b,score,coins_each,frame_item_id,medal_item_id) '+
      'VALUES(?,?,?,?,?,?,?,?,?)').bind(last,rank,w.bond_id,w.uid_a,w.uid_b,
      Number(w.total),rule.coins_each,rule.frame_item_id,rule.medal_item_id));
    for(const member of [w.uid_a,w.uid_b]){
      const key='cpweek:'+last+':'+rank;
      work.push(db.prepare('INSERT INTO sharika_cp_reward_member_awards '+
        '(week_start_ms,rank,auth_uid,coins,frame_item_id,medal_item_id,awarded_at_ms) '+
        'VALUES(?,?,?,?,?,?,?)').bind(last,rank,member,rule.coins_each,
        rule.frame_item_id,rule.medal_item_id,nowMs));
      if(rule.coins_each>0){
        work.push(db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
          "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
          .bind(MAX_BALANCE-rule.coins_each,rule.coins_each,member));
        work.push(db.prepare('INSERT INTO sharika_wallet_ledger '+
          '(auth_uid,currency,delta,balance_after,reason,request_id) '+
          "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'cp_weekly_reward',?)")
          .bind(member,rule.coins_each,member,key));
      }
      for(const [kind,item] of [['frame',rule.frame_item_id],['medal',rule.medal_item_id]]){
        if(!item)continue;
        work.push(db.prepare('INSERT OR IGNORE INTO sharika_cosmetic_inventory '+
          "(auth_uid,item_id,source,request_id) VALUES(?,?,'admin_grant',?)")
          .bind(member,item,key+':'+kind));
      }
    }
  }
  if(issuer!=='system')work.push(db.prepare('INSERT INTO sharika_admin_audit '+
    '(actor_id,action,details_json) VALUES(?,?,?)').bind(issuer,
    'cp_weekly_rewards_settled',JSON.stringify({week_start_ms:last,winner_count:winners.length})));
  try{await db.batch(work);}catch(error){
    // A parallel settlement may have finished first. Only its committed
    // receipt allows a duplicate response; unrelated SQL errors still fail.
    const committed=await db.prepare('SELECT winner_count FROM sharika_cp_reward_batches '+
      'WHERE week_start_ms=?').bind(last).first();
    if(committed)return {duplicate:true,week_start_ms:last,
      winner_count:Number(committed.winner_count)};
    throw error;
  }
  return {awarded:true,week_start_ms:last,winner_count:winners.length,
    recipients:winners.length*2};
}

export async function handleCpRewardAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='bonds/rewards'&&operation!=='bonds/rewards/settle')return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='bonds/rewards'&&request.method==='GET'){
    const [board,assets,history]=await Promise.all([
      readCpRewardBoard(db),
      db.prepare("SELECT id,kind,name FROM sharika_cosmetics_catalog WHERE active=1 "+
        "AND kind IN ('frame_style','medal_style') ORDER BY kind,name").all(),
      db.prepare('SELECT b.week_start_ms,b.awarded_at_ms,b.winner_count,'+
        "CASE WHEN b.issued_by='system' THEN 'Automatic' "+
        "ELSE COALESCE(printf('%08d',u.public_no),'Administrator') END AS issued_by "+
        'FROM sharika_cp_reward_batches b LEFT JOIN sharika_users u ON u.auth_uid=b.issued_by '+
        'ORDER BY b.week_start_ms DESC LIMIT 12').all()
    ]);
    return reply({...board,assets:rows(assets),history:rows(history),
      read_only:actor.role!=='super'},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='bonds/rewards/settle'&&request.method==='POST'){
    let body;
    try{body=await boundedBody(request,256);}
    catch(_){return fail('invalid_cp_reward_request',400,cors);}
    if(body?.confirm!==true)return fail('cp_reward_confirmation_required',400,cors);
    try{return reply(await settleLastCpWeek(db,Date.now(),uid,false),200,cors);}
    catch(error){return fail('cp_reward_settlement_failed',409,cors);}
  }
  if(operation==='bonds/rewards'&&request.method==='PATCH'){
    let body;
    try{body=await boundedBody(request,4096);}
    catch(_){return fail('invalid_cp_reward_request',400,cors);}
    if(typeof body?.enabled!=='boolean'||typeof body.auto_award!=='boolean'||
      !Array.isArray(body.rules)||body.rules.length!==7)
      return fail('invalid_cp_reward_rules',400,cors);
    const all=new Set();
    for(const rule of body.rules){
      if(!Number.isSafeInteger(rule?.rank)||rule.rank<1||rule.rank>7||all.has(rule.rank)||
        !Number.isSafeInteger(rule.coins_each)||rule.coins_each<0||rule.coins_each>1_000_000||
        ![rule.frame_item_id,rule.medal_item_id].every(x=>x===null||x===undefined||
          typeof x==='string'&&x.length<80))return fail('invalid_cp_reward_rules',400,cors);
      all.add(rule.rank);
      for(const [kind,id] of [['frame_style',rule.frame_item_id],['medal_style',rule.medal_item_id]]){
        if(!id)continue;
        const item=await db.prepare('SELECT id FROM sharika_cosmetics_catalog '+
          'WHERE id=? AND kind=? AND active=1').bind(id,kind).first();
        if(!item)return fail('invalid_cp_reward_item',400,cors);
      }
    }
    if(body.enabled&&!body.rules.some(r=>r.coins_each>0||r.frame_item_id||r.medal_item_id))
      return fail('cp_rewards_empty',400,cors);
    const current=cpWeekStart(Date.now());
    const previous=await db.prepare("SELECT enabled,auto_award,auto_start_week_ms FROM sharika_cp_reward_policy WHERE key='weekly'").first();
    // Activating automatic settlement takes effect NEXT full Monday week.
    const autoStart=body.auto_award&&(!previous?.auto_award||!previous?.enabled)?current+WEEK:
      (body.auto_award?Number(previous?.auto_start_week_ms||current+WEEK):0);
    const work=[db.prepare("UPDATE sharika_cp_reward_policy SET enabled=?,auto_award=?,"+
      "auto_start_week_ms=?,updated_by=?,updated_at=datetime('now') WHERE key='weekly'")
      .bind(Number(body.enabled),Number(body.auto_award),autoStart,uid)];
    for(const rule of body.rules)work.push(db.prepare('UPDATE sharika_cp_reward_rules '+
      "SET coins_each=?,frame_item_id=?,medal_item_id=?,updated_at=datetime('now') WHERE rank=?")
      .bind(rule.coins_each,rule.frame_item_id||null,rule.medal_item_id||null,rule.rank));
    work.push(db.prepare('INSERT INTO sharika_admin_audit (actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'cp_reward_rules_updated',JSON.stringify({enabled:body.enabled,
        auto_award:body.auto_award,rules:body.rules})));
    await db.batch(work);
    return reply({saved:true,...await policyAndRules(db)},200,cors);
  }
  return fail('cp_reward_method_not_allowed',405,cors);
}
