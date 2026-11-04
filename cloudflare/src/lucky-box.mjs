// Server-authoritative free Lucky Box. Independent of paid Lucky Gifts.
const COOLDOWN_MS=2*60*60*1000;
const DURATION_MS=24*60*60*1000;
const REQUEST_ID=/^[a-zA-Z0-9:_-]{12,80}$/;
const REWARD_TYPES=new Set(['coins','frame','entry','empty']);
const poolRows=r=>r?.results||[];

function secureIndex(max){
  if(!Number.isSafeInteger(max)||max<1)throw Error('invalid_draw_range');
  const ceiling=Math.floor(4294967296/max)*max;
  const bucket=new Uint32Array(1);
  do{crypto.getRandomValues(bucket);}while(bucket[0]>=ceiling);
  return bucket[0]%max;
}
export function luckyBoxOutcome(settings,draw=secureIndex){
  const weights=[
    ['coins',Number(settings.coin_weight)],
    ['frame',Number(settings.frame_weight)],
    ['entry',Number(settings.entry_weight)],
    ['empty',Number(settings.empty_weight)]
  ];
  const total=weights.reduce((n,[,w])=>n+w,0);
  if(total!==100||weights.some(([,w])=>!Number.isSafeInteger(w)||w<0))
    throw Error('invalid_lucky_box_weights');
  let number=draw(total);
  for(const [kind,weight] of weights){if(number<weight)return kind;number-=weight;}
  return 'empty';
}
async function settings(db){
  return db.prepare('SELECT * FROM sharika_lucky_box_settings WHERE id=1').first();
}
function claimResponse(claim,nextOpen,duplicate=false){
  return {
    opened:true,duplicate,reward:claim.outcome,
    coins:claim.coins_awarded,item_id:claim.item_id,
    item_name:claim.item_name||null,expires_at_ms:claim.expires_at_ms,
    opened_at_ms:claim.opened_at_ms,next_open_at_ms:nextOpen,
    cooldown_ms:COOLDOWN_MS
  };
}
export async function handleLuckyBoxApp({request,db,uid,path,readBody,reply,fail,cors}){
  if(path!=='/api/v1/lucky-box'&&path!=='/api/v1/lucky-box/open')return null;
  const policy=await settings(db);
  if(!policy||!policy.enabled)return fail('lucky_box_disabled',503,cors);
  const now=Date.now();
  if(path==='/api/v1/lucky-box'&&request.method==='GET'){
    const state=await db.prepare('SELECT next_open_at_ms FROM sharika_lucky_box_state WHERE auth_uid=?')
      .bind(uid).first();
    const previous=poolRows(await db.prepare(
      'SELECT request_id,outcome,coins_awarded,item_id,item_name,expires_at_ms,opened_at_ms '+
      'FROM sharika_lucky_box_claims WHERE auth_uid=? ORDER BY opened_at_ms DESC LIMIT 12'
    ).bind(uid).all());
    return reply({enabled:true,ready:now>=Number(state?.next_open_at_ms||0),
      next_open_at_ms:Number(state?.next_open_at_ms||0),
      cooldown_ms:COOLDOWN_MS,temporary_item_ms:DURATION_MS,
      coin_reward:Number(policy.coin_reward),history:previous},200,cors);
  }
  if(path!=='/api/v1/lucky-box/open'||request.method!=='POST')
    return fail('lucky_box_method_not_allowed',405,cors);
  const body=await readBody(request);
  const requestId=body.request_id;
  if(typeof requestId!=='string'||!REQUEST_ID.test(requestId))
    return fail('invalid_lucky_box_request',400,cors);
  const previous=await db.prepare(
    'SELECT * FROM sharika_lucky_box_claims WHERE request_id=?'
  ).bind(requestId).first();
  if(previous)return previous.auth_uid===uid
    ?reply(claimResponse(previous,Number(previous.opened_at_ms)+COOLDOWN_MS,true),200,cors)
    :fail('idempotency_conflict',409,cors);
  const state=await db.prepare(
    'SELECT next_open_at_ms FROM sharika_lucky_box_state WHERE auth_uid=?'
  ).bind(uid).first();
  if(Number(state?.next_open_at_ms||0)>now)
    return reply({error:'lucky_box_cooldown',next_open_at_ms:Number(state.next_open_at_ms),
      remaining_ms:Number(state.next_open_at_ms)-now},429,cors);

  let outcome=luckyBoxOutcome(policy);
  let item=null;
  if(outcome==='frame'||outcome==='entry'){
    const available=poolRows(await db.prepare(
      'SELECT c.id,c.kind,c.name FROM sharika_lucky_box_pool p '+
      'JOIN sharika_cosmetics_catalog c ON c.id=p.item_id '+
      "WHERE p.active=1 AND c.active=1 AND c.kind=? AND c.art_key NOT LIKE 'role-frame-%' "+
      "AND c.art_key NOT LIKE 'svip-%' AND c.art_key NOT IN "+
      "('cs-royal-wings','coin-seller-royal','noble-gold-microphone') ORDER BY c.id"
    ).bind(outcome==='frame'?'frame_style':'entry_style').all());
    if(available.length)item=available[secureIndex(available.length)];
    else outcome='empty';
  }
  const coinAmount=outcome==='coins'?Number(policy.coin_reward):0;
  const expires=outcome==='frame'||outcome==='entry'?now+DURATION_MS:null;
  const nextOpen=now+COOLDOWN_MS;
  const sql=[
    db.prepare("INSERT OR IGNORE INTO sharika_lucky_box_state(auth_uid,next_open_at_ms,last_request_id) VALUES(?,0,'')")
      .bind(uid),
    db.prepare('UPDATE sharika_lucky_box_state SET next_open_at_ms=?,last_request_id=? '+
      'WHERE auth_uid=? AND next_open_at_ms<=?')
      .bind(nextOpen,requestId,uid,now),
    db.prepare('INSERT INTO sharika_lucky_box_claims '+
      '(request_id,auth_uid,outcome,item_id,item_name,coins_awarded,expires_at_ms,opened_at_ms) '+
      'SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sharika_lucky_box_state '+
      'WHERE auth_uid=? AND last_request_id=?)')
      .bind(requestId,uid,outcome,item?.id||null,item?.name||null,
        coinAmount,expires,now,uid,requestId)
  ];
  if(outcome==='coins'){
    sql.push(db.prepare("UPDATE sharika_users SET coins=coins+?,updated_at=datetime('now') "+
      "WHERE auth_uid=? AND status='active' AND EXISTS(SELECT 1 FROM sharika_lucky_box_claims "+
      "WHERE request_id=? AND auth_uid=? AND outcome='coins')")
      .bind(coinAmount,uid,requestId,uid));
    sql.push(db.prepare("INSERT INTO sharika_wallet_ledger "+
      "(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "SELECT u.auth_uid,'coins',?,u.coins,'lucky_box',? FROM sharika_users u "+
      "JOIN sharika_lucky_box_claims c ON c.auth_uid=u.auth_uid "+
      "WHERE u.auth_uid=? AND c.request_id=? AND c.outcome='coins'")
      .bind(coinAmount,'lucky-box:'+requestId,uid,requestId));
  }else if(item){
    // Existing permanent purchases/grants remain permanent. A previous
    // expiring grant may be extended, never shortened.
    sql.push(db.prepare(
      'INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id,expires_at_ms) '+
      "SELECT ?,?,'admin_grant',?,? WHERE EXISTS(SELECT 1 FROM sharika_lucky_box_claims "+
      'WHERE request_id=? AND auth_uid=?) '+
      'ON CONFLICT(auth_uid,item_id) DO UPDATE SET expires_at_ms=CASE '+
      'WHEN sharika_cosmetic_inventory.expires_at_ms IS NULL THEN NULL '+
      'ELSE max(sharika_cosmetic_inventory.expires_at_ms,excluded.expires_at_ms) END')
      .bind(uid,item.id,'lucky-box:'+requestId,expires,requestId,uid));
  }
  try{await db.batch(sql);}
  catch(error){
    if(/constraint|unique/i.test(String(error?.message||error))){
      const retry=await db.prepare('SELECT * FROM sharika_lucky_box_claims WHERE request_id=?')
        .bind(requestId).first();
      if(retry&&retry.auth_uid===uid)
        return reply(claimResponse(retry,Number(retry.opened_at_ms)+COOLDOWN_MS,true),200,cors);
      return fail('lucky_box_claim_conflict',409,cors);
    }
    throw error;
  }
  const result=await db.prepare('SELECT * FROM sharika_lucky_box_claims WHERE request_id=? AND auth_uid=?')
    .bind(requestId,uid).first();
  if(!result){
    const current=await db.prepare('SELECT next_open_at_ms FROM sharika_lucky_box_state WHERE auth_uid=?')
      .bind(uid).first();
    return reply({error:'lucky_box_cooldown',next_open_at_ms:Number(current?.next_open_at_ms||nextOpen)},429,cors);
  }
  return reply(claimResponse(result,nextOpen),201,cors);
}
export async function handleLuckyBoxAdmin({request,db,uid,role,path,readBody,reply,fail,cors}){
  if(path!=='/api/v1/admin/lucky-box')return null;
  if(role!=='super')return fail('admin_permission_denied',403,cors);
  if(request.method==='GET'){
    const policy=await settings(db);
    const items=poolRows(await db.prepare(
      "SELECT c.id,c.name,c.kind,c.art_key,c.active,COALESCE(p.active,0) AS in_box "+
      "FROM sharika_cosmetics_catalog c LEFT JOIN sharika_lucky_box_pool p ON p.item_id=c.id "+
      "WHERE c.kind IN ('frame_style','entry_style') AND c.art_key NOT LIKE 'role-frame-%' "+
      "AND c.art_key NOT LIKE 'svip-%' AND c.art_key NOT IN "+
      "('cs-royal-wings','coin-seller-royal','noble-gold-microphone') ORDER BY c.kind,c.name"
    ).all());
    return reply({settings:policy,items},200,cors);
  }
  if(request.method!=='POST')return fail('lucky_box_method_not_allowed',405,cors);
  const body=await readBody(request);
  const weights=['coin_weight','frame_weight','entry_weight','empty_weight']
    .map(key=>Number(body[key]));
  if(weights.some(x=>!Number.isSafeInteger(x)||x<0||x>100)||
     weights.reduce((a,b)=>a+b,0)!==100||
     !Number.isSafeInteger(body.coin_reward)||body.coin_reward<1||body.coin_reward>1000000||
     typeof body.enabled!=='boolean'||
     !Array.isArray(body.item_ids)||body.item_ids.length>100||
     body.item_ids.some(x=>typeof x!=='string'||x.length>70)||
     new Set(body.item_ids).size!==body.item_ids.length)
    return fail('invalid_lucky_box_settings',400,cors);
  const valid=poolRows(await db.prepare(
    "SELECT id FROM sharika_cosmetics_catalog WHERE active=1 AND "+
    "kind IN ('frame_style','entry_style') AND art_key NOT LIKE 'role-frame-%' "+
    "AND art_key NOT LIKE 'svip-%' AND art_key NOT IN "+
    "('cs-royal-wings','coin-seller-royal','noble-gold-microphone')").all());
  const legal=new Set(valid.map(x=>x.id));
  if(body.item_ids.some(x=>!legal.has(x)))
    return fail('invalid_lucky_box_pool_item',400,cors);
  const batch=[
    db.prepare('UPDATE sharika_lucky_box_settings SET enabled=?,coin_reward=?,coin_weight=?,frame_weight=?,'+
      'entry_weight=?,empty_weight=?,updated_at=datetime(\'now\') WHERE id=1')
      .bind(body.enabled?1:0,body.coin_reward,...weights),
    db.prepare('UPDATE sharika_lucky_box_pool SET active=0'),
    ...body.item_ids.map(id=>db.prepare(
      'INSERT INTO sharika_lucky_box_pool(item_id,active) VALUES(?,1) '+
      'ON CONFLICT(item_id) DO UPDATE SET active=1').bind(id)),
    db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
      .bind(uid,'lucky_box_settings',JSON.stringify({
        item_ids:body.item_ids,coin_reward:body.coin_reward,weights,enabled:body.enabled
      }))
  ];
  await db.batch(batch);
  return reply({saved:true,item_count:body.item_ids.length},200,cors);
}