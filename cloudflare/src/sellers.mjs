import { rechargeReferralStatements } from './invites.mjs';
import { firstRechargeBonusStatements } from './first-recharge.mjs';
import {readInviteRules} from './invite-rules.mjs';
// Sharika staging: approved coin sellers with a separate audited stock ledger.
// No seller may mint coins, spend another seller's stock, or grant admin roles.
const PUBLIC_ID=/^[0-9]{8}$/;
const REQUEST_ID=/^[a-zA-Z0-9:_-]{12,80}$/;
const MAX_TRANSFER=1_000_000;
const MAX_STOCK=1_000_000_000;
const MAX_USER_BALANCE=1_000_000_000_000;
const showId=n=>String(n).padStart(8,'0');
const resultRows=r=>r.results||[];
const finance=new Set(['super','finance']);
const input=async request=>{
  const raw=await request.text();
  if(raw.length>4096)throw new Error('body_too_large');
  const value=JSON.parse(raw||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('invalid_body');
  return value;
};
function jsonFailure(fail,cors,error){return fail(error==='body_too_large'?'body_too_large':'invalid_json',400,cors);}
function sellerView(row){
  return {public_id:showId(row.public_no),name:row.name,pic:row.pic||null,
    active:!!row.active,unlimited_stock:!!row.unlimited_stock,
    available_coins:Number(row.available_coins)||0};
}
// The public seller directory contains identity only, never private stock.
function publicSellerView(row){
  return {public_id:showId(row.public_no),name:row.name,pic:row.pic||null};
}
export async function handleSellerApp({request,env,uid,path,cors,reply,fail}){
  if(!path.startsWith('/api/v1/sellers'))return null;
  const actor=await env.DB.prepare(
    "SELECT auth_uid,minor,public_no FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!actor)return fail('profile_unavailable',403,cors);
  if(path==='/api/v1/sellers'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      "SELECT u.public_no,u.name,u.pic "+
      "FROM sharika_coin_sellers s JOIN sharika_users u ON u.auth_uid=s.seller_uid "+
      "WHERE s.active=1 AND u.status='active' ORDER BY u.public_no LIMIT 100"
    ).all());
    return reply({sellers:rows.map(publicSellerView),read_only:true},200,cors);
  }
  if(path==='/api/v1/sellers/me'&&request.method==='GET'){
    const row=await env.DB.prepare(
      'SELECT u.public_no,u.name,u.pic,s.active,s.available_coins,s.unlimited_stock '+
      'FROM sharika_coin_sellers s JOIN sharika_users u ON u.auth_uid=s.seller_uid '+
      'WHERE s.seller_uid=?'
    ).bind(uid).first();
    return reply({seller:row?sellerView(row):null},200,cors);
  }
  // A seller can inspect only their own immutable stock movements.
  // Sender/recipient are verified public IDs, never client-supplied labels.
  if(path==='/api/v1/sellers/transfers'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      'SELECT t.id,su.public_no AS sender_no,ru.public_no AS recipient_no,'+
      't.amount,t.stock_after,t.created_at FROM sharika_coin_seller_transfers t '+
      'JOIN sharika_users su ON su.auth_uid=t.seller_uid '+
      'JOIN sharika_users ru ON ru.auth_uid=t.target_uid '+
      'WHERE t.seller_uid=? ORDER BY t.id DESC LIMIT 100'
    ).bind(uid).all());
    return reply({transfers:rows.map(t=>({
      id:t.id,sender_public_id:showId(t.sender_no),
      recipient_public_id:showId(t.recipient_no),coins:t.amount,
      stock_after:t.stock_after,created_at:t.created_at
    })),read_only:true},200,cors);
  }
  if(path==='/api/v1/sellers/allocations'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      'SELECT a.id,au.public_no AS sender_no,su.public_no AS seller_no,'+
      'a.amount,a.stock_after,a.created_at FROM sharika_coin_seller_allocations a '+
      'JOIN sharika_users au ON au.auth_uid=a.actor_uid '+
      'JOIN sharika_users su ON su.auth_uid=a.seller_uid '+
      'WHERE a.seller_uid=? ORDER BY a.id DESC LIMIT 100'
    ).bind(uid).all());
    return reply({allocations:rows.map(a=>({
      id:a.id,sender_public_id:showId(a.sender_no),
      seller_public_id:showId(a.seller_no),coins:a.amount,
      stock_after:a.stock_after,created_at:a.created_at
    })),read_only:true},200,cors);
  }
  if(path==='/api/v1/sellers/transfer'&&request.method==='POST'){
    let body;
    try{body=await input(request);}catch(error){return jsonFailure(fail,cors,error.message);}
    const amount=body.coins,publicId=body.target_public_id,requestId=body.request_id;
    if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_TRANSFER||
      typeof publicId!=='string'||!PUBLIC_ID.test(publicId)||
      typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_seller_transfer',400,cors);
    if(actor.minor)return fail('seller_adult_only',403,cors);
    const seller=await env.DB.prepare(
      'SELECT available_coins,active,unlimited_stock FROM sharika_coin_sellers WHERE seller_uid=?'
    ).bind(uid).first();
    if(!seller||!seller.active)return fail('seller_not_approved',403,cors);
    const recipient=await env.DB.prepare(
      "SELECT auth_uid,coins,status FROM sharika_users WHERE public_no=?"
    ).bind(Number(publicId)).first();
    if(!recipient||recipient.status!=='active')return fail('recipient_unavailable',404,cors);
    // Seller stock may be credited to the seller's own verified wallet.
    // It is still debited atomically and recorded in the same immutable ledger.
    const selfRecharge=recipient.auth_uid===uid;
    const existing=await env.DB.prepare(
      'SELECT t.amount,t.target_uid,t.id FROM sharika_coin_seller_transfers t '+
      'WHERE t.seller_uid=? AND t.request_id=?'
    ).bind(uid,requestId).first();
    if(existing){
      if(Number(existing.amount)!==amount||existing.target_uid!==recipient.auth_uid)
        return fail('idempotency_conflict',409,cors);
      const stock=await env.DB.prepare(
        'SELECT available_coins,unlimited_stock FROM sharika_coin_sellers WHERE seller_uid=?'
      ).bind(uid).first();
      return reply({duplicate:true,transfer_id:existing.id,
        available_coins:stock?.available_coins??0,unlimited_stock:!!stock?.unlimited_stock,
        recipient_public_id:publicId,
        sender_public_id:showId(actor.public_no),coins:amount,
        self_recharge:selfRecharge},200,cors);
    }
    if(!seller.unlimited_stock&&Number(seller.available_coins)<amount)
      return fail('seller_stock_insufficient',409,cors);
    if(Number(recipient.coins)>MAX_USER_BALANCE-amount)
      return fail('recipient_balance_limit',409,cors);
    const creditId='seller-credit:'+uid+':'+requestId;
    let referralCredit,firstRecharge;
    try{
      const rules=await readInviteRules(env.DB);
      // Do not mint a referral commission from a seller's own stock recharge.
      referralCredit=selfRecharge?{bonus:0,statements:[]}:
        await rechargeReferralStatements({
          db:env.DB,recipientUid:recipient.auth_uid,sellerUid:uid,requestId,amount,rules
        });
      firstRecharge=selfRecharge?{bonus:0,statements:[]}:
        await firstRechargeBonusStatements({
          db:env.DB,recipientUid:recipient.auth_uid,kind:'seller',
          reference:uid+':'+requestId,coins:amount,balance:recipient.coins,rules
        });
    }catch(error){
      if(error.message==='inviter_balance_limit')
        return fail('inviter_balance_limit',409,cors);
      if(error.message==='recipient_balance_limit')
        return fail('recipient_balance_limit',409,cors);
      throw error;
    }
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sharika_coin_sellers SET available_coins='+
        'CASE WHEN active=1 AND unlimited_stock=1 THEN available_coins '+
        'WHEN active=1 AND available_coins>=? THEN available_coins-? ELSE -1 END,'+
        "updated_at=datetime('now') WHERE seller_uid=?"
      ).bind(amount,amount,uid),
      env.DB.prepare(
        'UPDATE sharika_users SET coins=CASE WHEN status=\'active\' AND coins<=? '+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(MAX_USER_BALANCE-amount,amount,recipient.auth_uid),
      env.DB.prepare(
        'INSERT INTO sharika_coin_seller_transfers(seller_uid,target_uid,amount,'+
        'stock_after,request_id) VALUES(?,?,?,(SELECT available_coins FROM '+
        'sharika_coin_sellers WHERE seller_uid=?),?)'
      ).bind(uid,recipient.auth_uid,amount,uid,requestId),
      env.DB.prepare(
        'INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'seller_recharge',?)"
      ).bind(recipient.auth_uid,amount,recipient.auth_uid,creditId),
      ...firstRecharge.statements,
      ...referralCredit.statements
    ]);
    const saved=await env.DB.prepare(
      'SELECT id,stock_after FROM sharika_coin_seller_transfers '+
      'WHERE seller_uid=? AND request_id=?'
    ).bind(uid,requestId).first();
    return reply({duplicate:false,transfer_id:saved.id,coins:amount,
      recipient_public_id:publicId,
      sender_public_id:showId(actor.public_no),
      available_coins:saved.stock_after,unlimited_stock:!!seller.unlimited_stock,
      self_recharge:selfRecharge,
      referral_bonus_coins:referralCredit.bonus,
      first_recharge_bonus_coins:firstRecharge.bonus},201,cors);
  }
  return fail('seller_method_not_allowed',405,cors);
}

export async function handleSellerAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(!operation.startsWith('sellers'))return null;
  if(!finance.has(actor.role))return fail('admin_permission_denied',403,cors);
  if(operation==='sellers'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      'SELECT u.public_no,u.name,u.pic,s.active,s.available_coins,s.unlimited_stock,s.updated_at '+
      'FROM sharika_coin_sellers s JOIN sharika_users u ON u.auth_uid=s.seller_uid '+
      'ORDER BY s.updated_at DESC LIMIT 100'
    ).all());
    return reply({sellers:rows.map(r=>({...sellerView(r),updated_at:r.updated_at})),
      read_only:actor.role!=='super'},200,cors);
  }
  if(operation==='sellers/transfers'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      'SELECT t.id,su.public_no AS seller_no,ru.public_no AS recipient_no,'+
      't.amount,t.stock_after,t.created_at FROM sharika_coin_seller_transfers t '+
      'JOIN sharika_users su ON su.auth_uid=t.seller_uid '+
      'JOIN sharika_users ru ON ru.auth_uid=t.target_uid '+
      'ORDER BY t.id DESC LIMIT 100'
    ).all());
    return reply({transfers:rows.map(t=>({
      id:t.id,seller_public_id:showId(t.seller_no),
      sender_public_id:showId(t.seller_no),
      recipient_public_id:showId(t.recipient_no),
      coins:t.amount,stock_after:t.stock_after,created_at:t.created_at
    })),read_only:true},200,cors);
  }
  if(operation==='sellers/allocations'&&request.method==='GET'){
    const rows=resultRows(await env.DB.prepare(
      'SELECT a.id,au.public_no AS sender_no,su.public_no AS seller_no,'+
      'a.amount,a.stock_after,a.created_at FROM sharika_coin_seller_allocations a '+
      'JOIN sharika_users au ON au.auth_uid=a.actor_uid '+
      'JOIN sharika_users su ON su.auth_uid=a.seller_uid '+
      'ORDER BY a.id DESC LIMIT 100'
    ).all());
    return reply({allocations:rows.map(a=>({
      id:a.id,sender_public_id:showId(a.sender_no),
      seller_public_id:showId(a.seller_no),coins:a.amount,
      stock_after:a.stock_after,created_at:a.created_at
    })),read_only:true},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  // Only Super Admin may grant/revoke non-depleting seller inventory.
  // Each change is retained in a separate immutable audit table.
  if(operation==='sellers/stock-mode'&&request.method==='POST'){
    let body;
    try{body=await input(request);}catch(error){return jsonFailure(fail,cors,error.message);}
    const id=body.seller_public_id;
    const reason=typeof body.reason==='string'?body.reason.trim():'';
    if(typeof id!=='string'||!PUBLIC_ID.test(id)||
      typeof body.unlimited_stock!=='boolean'||reason.length<8||reason.length>200)
      return fail('invalid_seller_stock_mode',400,cors);
    const seller=await env.DB.prepare(
      'SELECT s.seller_uid,s.active FROM sharika_coin_sellers s '+
      'JOIN sharika_users u ON u.auth_uid=s.seller_uid '+
      "WHERE u.public_no=? AND u.status='active'"
    ).bind(Number(id)).first();
    if(!seller||!seller.active)return fail('seller_not_approved',404,cors);
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sharika_coin_sellers SET unlimited_stock=?,updated_at=datetime(\'now\') '+
        'WHERE seller_uid=? AND active=1'
      ).bind(body.unlimited_stock?1:0,seller.seller_uid),
      env.DB.prepare(
        'INSERT INTO sharika_coin_seller_stock_mode_audit '+
        '(actor_uid,seller_uid,unlimited_stock,reason) VALUES(?,?,?,?)'
      ).bind(uid,seller.seller_uid,body.unlimited_stock?1:0,reason)
    ]);
    return reply({seller_public_id:id,unlimited_stock:body.unlimited_stock},200,cors);
  }
  if(operation==='sellers'&&request.method==='POST'){
    let body;
    try{body=await input(request);}catch(error){return jsonFailure(fail,cors,error.message);}
    if(typeof body.target_public_id!=='string'||!PUBLIC_ID.test(body.target_public_id)||
      typeof body.active!=='boolean')return fail('invalid_seller_approval',400,cors);
    const target=await env.DB.prepare(
      'SELECT auth_uid,status,minor FROM sharika_users WHERE public_no=?'
    ).bind(Number(body.target_public_id)).first();
    if(!target||target.status!=='active')return fail('user_not_found',404,cors);
    if(target.minor)return fail('seller_adult_only',403,cors);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_coin_sellers(seller_uid,active) VALUES(?,?) '+
        "ON CONFLICT(seller_uid) DO UPDATE SET active=excluded.active,updated_at=datetime('now')"
      ).bind(target.auth_uid,body.active?1:0),
      env.DB.prepare(
        'INSERT INTO sharika_coin_seller_admin_audit(actor_uid,seller_uid,action,amount) '+
        "VALUES(?,?,?,0)"
      ).bind(uid,target.auth_uid,body.active?'approve':'suspend')
    ]);
    return reply({public_id:body.target_public_id,active:body.active},200,cors);
  }
  if(operation==='sellers/allocate'&&request.method==='POST'){
    let body;
    try{body=await input(request);}catch(error){return jsonFailure(fail,cors,error.message);}
    const id=body.seller_public_id,amount=body.coins,requestId=body.request_id;
    if(typeof id!=='string'||!PUBLIC_ID.test(id)||
      !Number.isSafeInteger(amount)||amount<1||amount>MAX_TRANSFER||
      typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_seller_allocation',400,cors);
    const seller=await env.DB.prepare(
      'SELECT s.seller_uid,s.available_coins,s.active FROM sharika_coin_sellers s '+
      'JOIN sharika_users u ON u.auth_uid=s.seller_uid WHERE u.public_no=? '+
      "AND u.status='active'"
    ).bind(Number(id)).first();
    if(!seller||!seller.active)return fail('seller_not_approved',404,cors);
    const existing=await env.DB.prepare(
      'SELECT id,amount,stock_after,seller_uid FROM sharika_coin_seller_allocations '+
      'WHERE request_id=? AND actor_uid=?'
    ).bind(requestId,uid).first();
    if(existing){
      if(Number(existing.amount)!==amount||existing.seller_uid!==seller.seller_uid)
        return fail('idempotency_conflict',409,cors);
      return reply({duplicate:true,allocation_id:existing.id,available_coins:existing.stock_after,
        seller_public_id:id,coins:amount},200,cors);
    }
    if(Number(seller.available_coins)>MAX_STOCK-amount)
      return fail('seller_stock_limit',409,cors);
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sharika_coin_sellers SET available_coins='+
        'CASE WHEN active=1 AND available_coins<=? THEN available_coins+? ELSE -1 END,'+
        "updated_at=datetime('now') WHERE seller_uid=?"
      ).bind(MAX_STOCK-amount,amount,seller.seller_uid),
      env.DB.prepare(
        'INSERT INTO sharika_coin_seller_allocations(actor_uid,seller_uid,amount,'+
        'stock_after,request_id) VALUES(?,?,?,(SELECT available_coins FROM '+
        'sharika_coin_sellers WHERE seller_uid=?),?)'
      ).bind(uid,seller.seller_uid,amount,seller.seller_uid,requestId),
      env.DB.prepare(
        'INSERT INTO sharika_coin_seller_admin_audit(actor_uid,seller_uid,action,amount) '+
        "VALUES(?,?,'allocate',?)"
      ).bind(uid,seller.seller_uid,amount)
    ]);
    const result=await env.DB.prepare(
      'SELECT id,stock_after FROM sharika_coin_seller_allocations '+
      'WHERE request_id=? AND actor_uid=?'
    ).bind(requestId,uid).first();
    return reply({duplicate:false,allocation_id:result.id,coins:amount,
      available_coins:result.stock_after,seller_public_id:id},201,cors);
  }
  return fail('seller_admin_route_not_found',404,cors);
}
