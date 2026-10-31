// Verified, consent-based CP and Friendship links. Coins are held at the
// invitation step, then either settled on acceptance or refunded exactly once.
const PUBLIC_ID=/^[0-9]{8}$/;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
const MS_HOUR=3_600_000;
const TYPES=['cp','friendship'];
const rows=result=>result?.results||[];
const pid=value=>String(value).padStart(8,'0');
const validPositive=value=>Number.isSafeInteger(value)&&value>0&&value<=1_000_000_000;
const equipped=(alias,kind)=>'COALESCE((SELECT CASE WHEN x.item_id IS NULL THEN '+
  "'' ELSE substr(x.item_id,instr(x.item_id,':')+1) END "+
  'FROM sharika_cosmetic_equipped x WHERE x.auth_uid='+alias+'.auth_uid '+
  "AND x.kind='"+kind+"'),"+alias+'.'+kind+",'')";

async function readPayload(request){
  const raw=await request.text();
  if(raw.length>4096)throw Error('bond_body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_bond_body');
  return body;
}
async function configuration(db){
  const policy=await db.prepare("SELECT * FROM sharika_bond_policy WHERE key='standard'").first();
  const gifts=rows(await db.prepare('SELECT id,type,name,emoji,price_coins,active,sort_order '+
    'FROM sharika_bond_gifts ORDER BY sort_order,id').all());
  if(!policy)throw Error('bond_policy_unavailable');
  return {policy:{cp_enabled:!!policy.cp_enabled,
    friendship_enabled:!!policy.friendship_enabled,expiry_hours:Number(policy.expiry_hours)},
    gifts:gifts.map(g=>({...g,active:!!g.active}))};
}
function inviteView(row){
  return {id:Number(row.id),type:row.type,gift_id:Number(row.gift_id),
    gift_name:row.gift_name,emoji:row.emoji,held_coins:Number(row.held_coins),
    sender_id:pid(row.sender_no),sender_name:row.sender_name,
    recipient_id:pid(row.recipient_no),recipient_name:row.recipient_name,
    status:row.status,created_at_ms:Number(row.created_at_ms),
    expires_at_ms:Number(row.expires_at_ms)};
}
function bondView(row,viewerUid){
  const mine=row.uid_a===viewerUid;
  return {id:Number(row.id),type:row.type,created_at_ms:Number(row.created_at_ms),
    partner:{id:pid(mine?row.b_no:row.a_no),name:mine?row.b_name:row.a_name,
      pic:mine?row.b_pic:row.a_pic,
      frame_style:mine?row.b_frame:row.a_frame,
      medal_style:mine?row.b_medal:row.a_medal}};
}
const BOND_SELECT='SELECT b.id,b.type,b.uid_a,b.uid_b,b.created_at_ms,'+
  'a.public_no AS a_no,a.name AS a_name,a.pic AS a_pic,'+
  equipped('a','frame_style')+' AS a_frame,'+equipped('a','medal_style')+' AS a_medal,'+
  'c.public_no AS b_no,c.name AS b_name,c.pic AS b_pic,'+
  equipped('c','frame_style')+' AS b_frame,'+equipped('c','medal_style')+' AS b_medal '+
  'FROM sharika_bonds b JOIN sharika_users a ON a.auth_uid=b.uid_a '+
  'JOIN sharika_users c ON c.auth_uid=b.uid_b ';

export async function readBondProfile(db,targetUid){
  const [links,counts,visitors,received,sent,bondReceived,bondSent]=await Promise.all([
    db.prepare(BOND_SELECT+'WHERE b.ended_at_ms IS NULL AND (b.uid_a=? OR b.uid_b=?) '+
      'ORDER BY CASE b.type WHEN \'cp\' THEN 0 ELSE 1 END,b.created_at_ms DESC LIMIT 100')
      .bind(targetUid,targetUid).all(),
    db.prepare('SELECT '+
      '(SELECT COUNT(*) FROM sharika_follows WHERE followed_uid=?) AS followers,'+
      '(SELECT COUNT(*) FROM sharika_follows WHERE follower_uid=?) AS following')
      .bind(targetUid,targetUid).first(),
    db.prepare('SELECT COUNT(*) AS n FROM sharika_profile_visits WHERE visited_uid=?')
      .bind(targetUid).first(),
    db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(quantity*price_coins),0) AS total '+
      'FROM sharika_gift_events WHERE recipient_uid=?').bind(targetUid).first(),
    db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(quantity*price_coins),0) AS total '+
      'FROM sharika_gift_events WHERE sender_uid=?').bind(targetUid).first(),
    db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(value_coins),0) AS total '+
      'FROM sharika_bond_gift_events WHERE recipient_uid=?').bind(targetUid).first(),
    db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(value_coins),0) AS total '+
      'FROM sharika_bond_gift_events WHERE sender_uid=?').bind(targetUid).first()
  ]);
  const bonds=rows(links).map(row=>bondView(row,targetUid));
  return {cp:bonds.find(b=>b.type==='cp')||null,
    friendships:bonds.filter(b=>b.type==='friendship'),
    followers:Number(counts?.followers||0),following:Number(counts?.following||0),
    visitors:Number(visitors?.n||0),
    gifts_received:Number(received?.n||0)+Number(bondReceived?.n||0),
    gift_value_received:Number(received?.total||0)+Number(bondReceived?.total||0),
    gifts_sent:Number(sent?.n||0)+Number(bondSent?.n||0),
    gift_value_sent:Number(sent?.total||0)+Number(bondSent?.total||0)};
}

async function readBondSocialActivity(db,targetUid){
  const followerSql='SELECT u.public_no,u.name,u.pic,'+
    equipped('u','frame_style')+' AS frame_style,'+
    equipped('u','medal_style')+' AS medal_style '+
    'FROM sharika_follows f JOIN sharika_users u ON u.auth_uid=';
  const [followers,following,gifters]=await Promise.all([
    db.prepare(followerSql+'f.follower_uid WHERE f.followed_uid=? '+
      "AND u.status='active' ORDER BY f.created_at DESC LIMIT 12").bind(targetUid).all(),
    db.prepare(followerSql+'f.followed_uid WHERE f.follower_uid=? '+
      "AND u.status='active' ORDER BY f.created_at DESC LIMIT 12").bind(targetUid).all(),
    db.prepare('SELECT u.public_no,u.name,u.pic,'+
      equipped('u','frame_style')+' AS frame_style,'+
      equipped('u','medal_style')+' AS medal_style,g.gift_name,g.emoji,g.coins '+
      'FROM (SELECT e.sender_uid AS sender_uid,x.name AS gift_name,x.emoji AS emoji,'+
      'e.price_coins*e.quantity AS coins,e.created_at AS at FROM sharika_gift_events e '+
      'JOIN sharika_gifts x ON x.id=e.gift_id WHERE e.recipient_uid=? '+
      'UNION ALL SELECT e.sender_uid,x.name,x.emoji,e.value_coins,'+
      "datetime(e.created_at_ms/1000,'unixepoch') FROM sharika_bond_gift_events e "+
      'JOIN sharika_bond_gifts x ON x.id=e.gift_id WHERE e.recipient_uid=? '+
      ') g JOIN sharika_users u ON u.auth_uid=g.sender_uid '+
      "WHERE u.status='active' ORDER BY g.at DESC LIMIT 20")
      .bind(targetUid,targetUid).all()
  ]);
  const userView=u=>({id:pid(u.public_no),name:u.name,pic:u.pic,
    frame_style:u.frame_style||'',medal_style:u.medal_style||''});
  return {followers_preview:rows(followers).map(userView),
    following_preview:rows(following).map(userView),
    recent_gifters:rows(gifters).map(row=>({...userView(row),gift_name:row.gift_name,
      emoji:row.emoji,coins:Number(row.coins)}))};
}

export async function roomBondPairs(db,roomId){
  const list=await db.prepare('SELECT b.id,b.type,ua.public_no AS a_id,ub.public_no AS b_id '+
    'FROM sharika_bonds b '+
    'JOIN sharika_room_members ma ON ma.user_id=b.uid_a AND ma.room_id=? '+
    'JOIN sharika_room_members mb ON mb.user_id=b.uid_b AND mb.room_id=? '+
    'JOIN sharika_users ua ON ua.auth_uid=b.uid_a '+
    'JOIN sharika_users ub ON ub.auth_uid=b.uid_b '+
    "WHERE b.ended_at_ms IS NULL AND (ma.seat_no IS NOT NULL OR ma.role='owner') "+
    "AND (mb.seat_no IS NOT NULL OR mb.role='owner') "+
    'ORDER BY CASE b.type WHEN \'cp\' THEN 0 ELSE 1 END,b.id DESC LIMIT 24')
    .bind(roomId,roomId).all();
  return rows(list).map(row=>({id:Number(row.id),type:row.type,
    a_id:pid(row.a_id),b_id:pid(row.b_id)}));
}

export async function readBondRanking(db,type,period,nowMs=Date.now()){
  if(!TYPES.includes(type)||!['daily','weekly','monthly'].includes(period))return null;
  const now=new Date(nowMs),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),
    period==='monthly'?1:now.getUTCDate()));
  if(period==='weekly')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start.getTime());
  if(period==='daily')end.setUTCDate(end.getUTCDate()+1);
  if(period==='weekly')end.setUTCDate(end.getUTCDate()+7);
  if(period==='monthly')end.setUTCMonth(end.getUTCMonth()+1);
  const list=await db.prepare('SELECT b.id AS bond_id,ua.public_no AS a_id,ua.name AS a_name,'+
    'ua.pic AS a_pic,'+equipped('ua','frame_style')+' AS a_frame,'+
    equipped('ua','medal_style')+' AS a_medal,'+
    'ub.public_no AS b_id,ub.name AS b_name,ub.pic AS b_pic,'+
    equipped('ub','frame_style')+' AS b_frame,'+
    equipped('ub','medal_style')+' AS b_medal,'+
    'SUM(e.value_coins) AS total FROM sharika_bond_gift_events e '+
    'JOIN sharika_bonds b ON b.id=e.bond_id '+
    'JOIN sharika_users ua ON ua.auth_uid=b.uid_a '+
    'JOIN sharika_users ub ON ub.auth_uid=b.uid_b '+
    'WHERE b.type=? AND b.ended_at_ms IS NULL AND e.created_at_ms>=? '+
    'AND e.created_at_ms<? GROUP BY b.id ORDER BY total DESC,b.id ASC LIMIT 50')
    .bind(type,start.getTime(),end.getTime()).all();
  return {type,period,source:'verified_accepted_bond_gifts',read_only:true,
    leaders:rows(list).map((r,i)=>({rank:i+1,bond_id:Number(r.bond_id),
      total:Number(r.total),a:{id:pid(r.a_id),name:r.a_name,pic:r.a_pic,
        frame_style:r.a_frame,medal_style:r.a_medal},
      b:{id:pid(r.b_id),name:r.b_name,pic:r.b_pic,
        frame_style:r.b_frame,medal_style:r.b_medal}}))};
}

// Status transition + unique immutable wallet ledger in one D1 batch makes
// refunds all-or-nothing even when two clients or cron race to refund.
export async function expireBondInvites(db,nowMs=Date.now(),limit=30){
  const expired=rows(await db.prepare('SELECT id,sender_uid,held_coins FROM sharika_bond_invites '+
    "WHERE status='pending' AND expires_at_ms<=? ORDER BY expires_at_ms LIMIT ?")
    .bind(nowMs,Math.max(1,Math.min(100,limit))).all());
  let resolved=0;
  for(const invite of expired){
    try{
      await refundInvite(db,invite,'expired',nowMs,invite.sender_uid);
      resolved++;
    }catch(error){
      // A parallel request may have refunded it. Only an unresolved error is
      // surfaced; never apply a second credit outside the ledger transaction.
      const row=await db.prepare('SELECT status FROM sharika_bond_invites WHERE id=?')
        .bind(invite.id).first();
      if(row?.status==='pending')throw error;
    }
  }
  return resolved;
}
async function refundInvite(db,invite,status,nowMs,actorUid){
  const ledgerId='bond:refund:'+invite.id;
  await db.batch([
    db.prepare("UPDATE sharika_bond_invites SET status=?,resolved_at_ms=?,refunded_at_ms=? "+
      "WHERE id=? AND status='pending'").bind(status,nowMs,nowMs,invite.id),
    db.prepare("UPDATE sharika_users SET coins=CASE WHEN EXISTS("+
      'SELECT 1 FROM sharika_bond_invites WHERE id=? AND status=? AND refunded_at_ms=?'+
      ") THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
      .bind(invite.id,status,nowMs,invite.held_coins,invite.sender_uid),
    db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'bond_invite_refund',?)")
      .bind(invite.sender_uid,invite.held_coins,invite.sender_uid,ledgerId),
    db.prepare('INSERT INTO sharika_bond_audit(actor_uid,action,invite_id,details_json,created_at_ms) '+
      'VALUES(?,?,?,?,?)').bind(actorUid,status,invite.id,'{}',nowMs)
  ]);
}

export async function handleBondApp({request,env,uid,path,cors,reply,fail,nowMs=Date.now()}){
  if(!path.startsWith('/api/v1/bonds'))return null;
  const db=env.DB;
  const actor=await db.prepare('SELECT auth_uid,public_no,status,coins FROM sharika_users WHERE auth_uid=?')
    .bind(uid).first();
  if(!actor||actor.status!=='active')return fail('profile_unavailable',403,cors);
  const url=new URL(request.url);
  if(path==='/api/v1/bonds/catalog'&&request.method==='GET')
    return reply(await configuration(db),200,cors);
  if(path==='/api/v1/bonds/room'&&request.method==='GET')
    return fail('room_id_required',400,cors);
  const roomMatch=/^\/api\/v1\/bonds\/room\/([0-9]{8})$/.exec(path);
  if(roomMatch&&request.method==='GET'){
    const member=await db.prepare('SELECT 1 AS ok FROM sharika_room_members '+
      'WHERE room_id=? AND user_id=?').bind(roomMatch[1],uid).first();
    if(!member)return fail('join_room_first',403,cors);
    return reply({pairs:await roomBondPairs(db,roomMatch[1])},200,cors);
  }
  const profileMatch=/^\/api\/v1\/bonds\/profile\/([0-9]{8})$/.exec(path);
  if(profileMatch&&request.method==='GET'){
    const target=await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(profileMatch[1])).first();
    if(!target)return fail('user_not_found',404,cors);
    const [summary,activity]=await Promise.all([
      readBondProfile(db,target.auth_uid),readBondSocialActivity(db,target.auth_uid)
    ]);
    return reply({public_id:profileMatch[1],...summary,...activity},200,cors);
  }
  const visitMatch=/^\/api\/v1\/bonds\/visits\/([0-9]{8})$/.exec(path);
  if(visitMatch&&request.method==='POST'){
    const target=await db.prepare("SELECT auth_uid FROM sharika_users WHERE public_no=? AND status='active'")
      .bind(Number(visitMatch[1])).first();
    if(!target)return fail('user_not_found',404,cors);
    if(target.auth_uid!==uid)await db.prepare(
      'INSERT INTO sharika_profile_visits(visitor_uid,visited_uid,last_seen_at_ms) VALUES(?,?,?) '+
      'ON CONFLICT(visitor_uid,visited_uid) DO UPDATE SET last_seen_at_ms=excluded.last_seen_at_ms'
    ).bind(uid,target.auth_uid,nowMs).run();
    return reply({recorded:target.auth_uid!==uid},200,cors);
  }
  if(path==='/api/v1/bonds/rankings'&&request.method==='GET'){
    const rank=await readBondRanking(db,url.searchParams.get('type'),url.searchParams.get('period'),nowMs);
    return rank?reply(rank,200,cors):fail('invalid_bond_ranking',400,cors);
  }
  if(path==='/api/v1/bonds/me'&&request.method==='GET'){
    await expireBondInvites(db,nowMs);
    const result=await db.prepare('SELECT i.*,s.public_no AS sender_no,s.name AS sender_name,'+
      'r.public_no AS recipient_no,r.name AS recipient_name,g.name AS gift_name,g.emoji '+
      'FROM sharika_bond_invites i '+
      'JOIN sharika_users s ON s.auth_uid=i.sender_uid '+
      'JOIN sharika_users r ON r.auth_uid=i.recipient_uid '+
      'JOIN sharika_bond_gifts g ON g.id=i.gift_id '+
      "WHERE (i.sender_uid=? OR i.recipient_uid=?) AND i.status='pending' "+
      'ORDER BY i.id DESC LIMIT 60').bind(uid,uid).all();
    const invites=rows(result).map(inviteView);
    return reply({public_id:pid(actor.public_no),profile:await readBondProfile(db,uid),
      received:invites.filter(i=>i.recipient_id===pid(actor.public_no)),
      sent:invites.filter(i=>i.sender_id===pid(actor.public_no))},200,cors);
  }
  // Subsequent CP/Friendship gifts boost an already consenting pair's rank;
  // the relationship is not re-created and coins are charged only once.
  if(path==='/api/v1/bonds/gift'&&request.method==='POST'){
    let body;
    try{body=await readPayload(request);}catch(_){return fail('invalid_bond_body',400,cors);}
    const giftId=body.gift_id,requestId=body.request_id,targetId=body.recipient_public_id;
    if(!Number.isSafeInteger(giftId)||giftId<1||!PUBLIC_ID.test(targetId)||
      typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_bond_gift',400,cors);
    const previous=await db.prepare('SELECT e.id,e.gift_id,e.value_coins,r.public_no AS recipient_no '+
      'FROM sharika_bond_gift_events e JOIN sharika_users r ON r.auth_uid=e.recipient_uid '+
      'WHERE e.sender_uid=? AND e.request_id=?').bind(uid,requestId).first();
    if(previous){
      if(Number(previous.gift_id)!==giftId||pid(previous.recipient_no)!==targetId)
        return fail('bond_request_conflict',409,cors);
      return reply({duplicate:true,spent_coins:Number(previous.value_coins),
        gift_event_id:Number(previous.id)},200,cors);
    }
    const [target,gift,config]=await Promise.all([
      db.prepare("SELECT auth_uid,status FROM sharika_users WHERE public_no=?")
        .bind(Number(targetId)).first(),
      db.prepare('SELECT * FROM sharika_bond_gifts WHERE id=?').bind(giftId).first(),
      configuration(db)
    ]);
    if(!target||target.status!=='active')return fail('user_not_found',404,cors);
    if(target.auth_uid===uid)return fail('bond_self_not_allowed',400,cors);
    if(!gift||!gift.active||!config.policy[gift.type+'_enabled'])
      return fail('bond_gift_unavailable',403,cors);
    const bond=await db.prepare('SELECT id FROM sharika_bonds WHERE type=? AND ended_at_ms IS NULL '+
      'AND ((uid_a=? AND uid_b=?) OR (uid_a=? AND uid_b=?))')
      .bind(gift.type,uid,target.auth_uid,target.auth_uid,uid).first();
    if(!bond)return fail('bond_not_active',409,cors);
    if(Number(actor.coins)<Number(gift.price_coins))return fail('wallet_insufficient',409,cors);
    await db.batch([
      db.prepare('INSERT INTO sharika_bond_gift_events(bond_id,invite_id,gift_id,request_id,'+
        'sender_uid,recipient_uid,type,value_coins,created_at_ms) VALUES(?,NULL,?,?,?,?,?,?,?)')
        .bind(bond.id,giftId,requestId,uid,target.auth_uid,gift.type,gift.price_coins,nowMs),
      db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins>=? "+
        "THEN coins-? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
        .bind(gift.price_coins,gift.price_coins,uid),
      db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'bond_pair_gift',?)")
        .bind(uid,-gift.price_coins,uid,'bond:gift:'+requestId),
      db.prepare('INSERT INTO sharika_bond_audit(actor_uid,action,bond_id,details_json,created_at_ms) '+
        "VALUES(?,'pair_gift',?,?,?)").bind(uid,bond.id,
          JSON.stringify({gift_id:giftId,coins:gift.price_coins}),nowMs)
    ]);
    return reply({duplicate:false,bond_id:Number(bond.id),
      spent_coins:Number(gift.price_coins)},201,cors);
  }
  if(path==='/api/v1/bonds/invite'&&request.method==='POST'){
    let body;
    try{body=await readPayload(request);}catch(_){return fail('invalid_bond_body',400,cors);}
    const giftId=body.gift_id,requestId=body.request_id,recipientId=body.recipient_public_id;
    if(!Number.isSafeInteger(giftId)||giftId<1||!PUBLIC_ID.test(recipientId)||
       typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_bond_invite',400,cors);
    const prior=await db.prepare('SELECT i.*,r.public_no AS recipient_no FROM sharika_bond_invites i '+
      'JOIN sharika_users r ON r.auth_uid=i.recipient_uid WHERE i.sender_uid=? AND i.request_id=?')
      .bind(uid,requestId).first();
    if(prior){
      if(pid(prior.recipient_no)!==recipientId||Number(prior.gift_id)!==giftId)
        return fail('bond_request_conflict',409,cors);
      return reply({duplicate:true,invite_id:Number(prior.id),status:prior.status,
        held_coins:Number(prior.held_coins)},200,cors);
    }
    const [config,target,gift]=await Promise.all([
      configuration(db),
      db.prepare('SELECT auth_uid,status FROM sharika_users WHERE public_no=?')
        .bind(Number(recipientId)).first(),
      db.prepare('SELECT * FROM sharika_bond_gifts WHERE id=?').bind(giftId).first()
    ]);
    if(!target||target.status!=='active')return fail('user_not_found',404,cors);
    if(target.auth_uid===uid)return fail('bond_self_not_allowed',400,cors);
    if(!gift||!gift.active||!config.policy[gift.type+'_enabled'])
      return fail('bond_gift_unavailable',403,cors);
    if(!validPositive(Number(gift.price_coins)))return fail('invalid_bond_gift_price',409,cors);
    if(gift.type==='cp'){
      const existing=await db.prepare('SELECT auth_uid FROM sharika_active_cp_slots '+
        'WHERE auth_uid=? OR auth_uid=? LIMIT 1').bind(uid,target.auth_uid).first();
      if(existing)return fail('cp_already_bound',409,cors);
    }
    const pair=[uid,target.auth_uid].sort();
    const bound=await db.prepare('SELECT id FROM sharika_bonds WHERE type=? AND pair_key=? '+
      'AND ended_at_ms IS NULL').bind(gift.type,pair.join(':')).first();
    if(bound)return fail('bond_already_active',409,cors);
    if(Number(actor.coins)<Number(gift.price_coins))return fail('wallet_insufficient',409,cors);
    const expires=nowMs+config.policy.expiry_hours*MS_HOUR;
    // The first insert allocates the invite ID; the following statements
    // read it by the unique request key within the same atomic D1 batch.
    await db.batch([
      db.prepare('INSERT INTO sharika_bond_invites(sender_uid,recipient_uid,type,gift_id,held_coins,'+
        'request_id,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?,?)')
        .bind(uid,target.auth_uid,gift.type,giftId,gift.price_coins,requestId,nowMs,expires),
      db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins>=? "+
        "THEN coins-? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
        .bind(gift.price_coins,gift.price_coins,uid),
      db.prepare('INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'bond_invite_hold',?)")
        .bind(uid,-gift.price_coins,uid,'bond:hold:'+requestId),
      db.prepare('INSERT INTO sharika_bond_audit(actor_uid,action,invite_id,details_json,created_at_ms) '+
        "VALUES(?,'invited',(SELECT id FROM sharika_bond_invites WHERE sender_uid=? AND request_id=?),?,?)")
        .bind(uid,uid,requestId,JSON.stringify({type:gift.type,gift_id:giftId}),nowMs)
    ]);
    const created=await db.prepare('SELECT id FROM sharika_bond_invites WHERE sender_uid=? AND request_id=?')
      .bind(uid,requestId).first();
    return reply({duplicate:false,invite_id:Number(created.id),type:gift.type,
      status:'pending',held_coins:Number(gift.price_coins),expires_at_ms:expires},201,cors);
  }
  const respondMatch=/^\/api\/v1\/bonds\/invites\/([1-9][0-9]{0,11})\/respond$/.exec(path);
  if(respondMatch&&request.method==='POST'){
    let body;
    try{body=await readPayload(request);}catch(_){return fail('invalid_bond_body',400,cors);}
    if(typeof body.accept!=='boolean')return fail('invalid_bond_response',400,cors);
    const invite=await db.prepare('SELECT * FROM sharika_bond_invites WHERE id=?')
      .bind(Number(respondMatch[1])).first();
    if(!invite)return fail('bond_invite_not_found',404,cors);
    if(invite.recipient_uid!==uid)return fail('bond_invite_recipient_only',403,cors);
    if(invite.status!=='pending')return reply({status:invite.status,duplicate:true},200,cors);
    if(invite.expires_at_ms<=nowMs){
      await expireBondInvites(db,nowMs);
      return fail('bond_invite_expired',409,cors);
    }
    if(!body.accept){
      await refundInvite(db,invite,'declined',nowMs,uid);
      return reply({status:'declined',refunded_coins:Number(invite.held_coins)},200,cors);
    }
    const from=await db.prepare("SELECT status FROM sharika_users WHERE auth_uid=?")
      .bind(invite.sender_uid).first();
    if(from?.status!=='active')return fail('bond_sender_unavailable',409,cors);
    const config=await configuration(db);
    if(!config.policy[invite.type+'_enabled'])return fail('bond_type_disabled',403,cors);
    const [a,b]=[invite.sender_uid,uid].sort();
    const bondId=Number(invite.id);
    const statements=[
      db.prepare('INSERT INTO sharika_bonds(id,type,uid_a,uid_b,pair_key,created_at_ms) '+
        'SELECT id,type,?,?,?,? FROM sharika_bond_invites '+
        "WHERE id=? AND status='pending' AND expires_at_ms>?")
        .bind(a,b,a+':'+b,nowMs,bondId,nowMs)
    ];
    if(invite.type==='cp')statements.push(
      db.prepare('INSERT INTO sharika_active_cp_slots(auth_uid,bond_id) VALUES(?,?)').bind(a,bondId),
      db.prepare('INSERT INTO sharika_active_cp_slots(auth_uid,bond_id) VALUES(?,?)').bind(b,bondId)
    );
    statements.push(
      db.prepare("UPDATE sharika_bond_invites SET status='accepted',resolved_at_ms=? "+
        "WHERE id=? AND status='pending' AND expires_at_ms>?").bind(nowMs,bondId,nowMs),
      db.prepare('INSERT INTO sharika_bond_gift_events(bond_id,invite_id,gift_id,sender_uid,recipient_uid,'+
        'type,value_coins,created_at_ms) VALUES(?,?,?,?,?,?,?,?)')
        .bind(bondId,bondId,invite.gift_id,invite.sender_uid,uid,invite.type,invite.held_coins,nowMs),
      db.prepare('INSERT INTO sharika_bond_audit(actor_uid,action,invite_id,bond_id,details_json,created_at_ms) '+
        "VALUES(?,'accepted',?,?,?,?)").bind(uid,bondId,bondId,'{}',nowMs)
    );
    await db.batch(statements);
    return reply({status:'accepted',bond_id:bondId,type:invite.type},201,cors);
  }
  const unbindMatch=/^\/api\/v1\/bonds\/([1-9][0-9]{0,11})\/unbind$/.exec(path);
  if(unbindMatch&&request.method==='POST'){
    const bondId=Number(unbindMatch[1]);
    const bond=await db.prepare('SELECT id,type,uid_a,uid_b,ended_at_ms '+
      'FROM sharika_bonds WHERE id=?').bind(bondId).first();
    if(!bond)return fail('bond_not_found',404,cors);
    if(bond.uid_a!==uid&&bond.uid_b!==uid)return fail('bond_member_only',403,cors);
    if(bond.ended_at_ms)return reply({unbound:true,duplicate:true},200,cors);
    const statements=[db.prepare('UPDATE sharika_bonds SET ended_at_ms=? '+
      'WHERE id=? AND ended_at_ms IS NULL').bind(nowMs,bondId)];
    if(bond.type==='cp')statements.push(db.prepare('DELETE FROM sharika_active_cp_slots '+
      'WHERE bond_id=?').bind(bondId));
    statements.push(db.prepare('INSERT INTO sharika_bond_audit(actor_uid,action,bond_id,'+
      "details_json,created_at_ms) VALUES(?,'unbound',?,'{}',?)").bind(uid,bondId,nowMs));
    await db.batch(statements);
    return reply({unbound:true,bond_id:bondId,type:bond.type},200,cors);
  }
  return fail('bond_route_not_found',404,cors);
}

export async function handleBondAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='bonds'&&!/^bonds\/gifts\/[1-9][0-9]{0,9}$/.test(operation))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB;
  if(operation==='bonds'&&request.method==='GET'){
    const config=await configuration(db);
    const audit=rows(await db.prepare('SELECT a.action,a.invite_id,a.bond_id,a.created_at_ms,'+
      'u.public_no AS actor_id FROM sharika_bond_audit a '+
      'JOIN sharika_users u ON u.auth_uid=a.actor_uid ORDER BY a.id DESC LIMIT 50').all());
    return reply({...config,audit:audit.map(r=>({...r,actor_id:pid(r.actor_id)}))},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  let body;
  try{body=await readPayload(request);}catch(_){return fail('invalid_bond_admin_body',400,cors);}
  if(operation==='bonds'&&request.method==='PATCH'){
    const updates={};
    for(const k of ['cp_enabled','friendship_enabled'])if(k in body){
      if(typeof body[k]!=='boolean')return fail('invalid_bond_policy',400,cors);
      updates[k]=Number(body[k]);
    }
    if('expiry_hours' in body){
      if(!Number.isSafeInteger(body.expiry_hours)||body.expiry_hours<1||body.expiry_hours>168)
        return fail('invalid_bond_policy',400,cors);
      updates.expiry_hours=body.expiry_hours;
    }
    const keys=Object.keys(updates);
    if(!keys.length)return fail('no_bond_policy_changes',400,cors);
    await db.batch([
      db.prepare('UPDATE sharika_bond_policy SET '+keys.map(k=>k+'=?').join(',')+
        ",updated_by=?,updated_at=datetime('now') WHERE key='standard'")
        .bind(...keys.map(k=>updates[k]),uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'bond_policy_update',JSON.stringify(updates))
    ]);
    return reply({updated:true,config:await configuration(db)},200,cors);
  }
  const giftMatch=/^bonds\/gifts\/([1-9][0-9]{0,9})$/.exec(operation);
  if(giftMatch&&request.method==='PATCH'){
    const giftId=Number(giftMatch[1]);
    const old=await db.prepare('SELECT id FROM sharika_bond_gifts WHERE id=?').bind(giftId).first();
    if(!old)return fail('bond_gift_not_found',404,cors);
    const updates={};
    if('active' in body){
      if(typeof body.active!=='boolean')return fail('invalid_bond_gift',400,cors);
      updates.active=Number(body.active);
    }
    if('price_coins' in body){
      if(!validPositive(body.price_coins))return fail('invalid_bond_gift',400,cors);
      updates.price_coins=body.price_coins;
    }
    if('name' in body){
      if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80)
        return fail('invalid_bond_gift',400,cors);
      updates.name=body.name.trim();
    }
    if('emoji' in body){
      if(typeof body.emoji!=='string'||!body.emoji.trim()||body.emoji.trim().length>16)
        return fail('invalid_bond_gift',400,cors);
      updates.emoji=body.emoji.trim();
    }
    const keys=Object.keys(updates);
    if(!keys.length)return fail('no_bond_gift_changes',400,cors);
    await db.batch([
      db.prepare('UPDATE sharika_bond_gifts SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?')
        .bind(...keys.map(k=>updates[k]),giftId),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'bond_gift_update',JSON.stringify({gift_id:giftId,updates}))
    ]);
    return reply({updated:true,gift_id:giftId},200,cors);
  }
  return fail('bond_admin_method_not_allowed',405,cors);
}
