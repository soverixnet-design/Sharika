// Sharika staging admin: verified D1 reads plus restricted user moderation and gift catalog edits.
// Every request is authenticated by the outer Worker with a verified Firebase JWT.
// Only explicitly audited seller inventory and verified grants may credit wallets.
import { handleSellerAdmin } from './sellers.mjs';
import { handleBannerAdmin } from './banners.mjs';
import { handleDailyAdmin } from './daily.mjs';
import { handlePremiumAdmin } from './premium.mjs';
import { handleBondAdmin } from './bonds.mjs';
import { handleEventAdmin } from './events.mjs';
import { handleInviteAdmin } from './invites.mjs';
import { handleRechargeAdmin } from './recharges.mjs';
import { handleAdminExchangeRate } from './exchange-rate.mjs';
import { handleCosmeticAdmin,publicAppearanceSelect } from './cosmetics.mjs';
import { lookupStaffActor, staffProxyRole, handleStaffAdmin } from './staff.mjs';
import { handleSpecialAdmin } from './special-ids.mjs';
import { handleOperationalRead } from './admin-operations.mjs';
const ADMIN_PREFIX = '/api/v1/admin/';
const PUBLIC_ID = /^[0-9]{8}$/;
const FINANCE_ROLES = new Set(['super', 'finance']);
const ROOM_ROLES = new Set(['super', 'support']);
function id(value) { return String(value).padStart(8, '0'); }
function values(result) { return result.results || []; }
function allowed(role, roles, fail, cors) {
  return roles.has(role) ? null : fail('admin_permission_denied', 403, cors);
}


// Public rankings use only verified gift events or approved recharge ledger
// credits, never demo users, payment references or client-reported balances.
// UTC boundaries are half-open so each transaction belongs to one period.
export async function readGiftRankings(db, period, kind) {
  if (!['daily','weekly','monthly'].includes(period) ||
      !['lucky','rich','charm','room','recharge'].includes(kind)) return null;
  const now=new Date(), year=now.getUTCFullYear(), month=now.getUTCMonth();
  let start;
  if (period==='daily') {
    start=new Date(Date.UTC(year,month,now.getUTCDate()));
  } else if (period==='weekly') {
    const mondayOffset=(now.getUTCDay()+6)%7;
    start=new Date(Date.UTC(year,month,now.getUTCDate()-mondayOffset));
  } else {
    start=new Date(Date.UTC(year,month,1));
  }
  const end=new Date(start.getTime());
  if (period==='daily') end.setUTCDate(end.getUTCDate()+1);
  else if (period==='weekly') end.setUTCDate(end.getUTCDate()+7);
  else end.setUTCMonth(end.getUTCMonth()+1);
  const stamp=date=>date.toISOString().slice(0,19).replace('T',' ');
  const startAt=stamp(start),endAt=stamp(end);
  const value='SUM(CAST(e.quantity AS INTEGER)*CAST(e.price_coins AS INTEGER))';
  // A leaderboard profile must display the user's actually equipped
  // cosmetics, not a locally fabricated frame/medal. Correlated lookups use
  // the unique (auth_uid,kind) index and keep the one-query pagination shape.
  const appearance=publicAppearanceSelect()+',';
  let sql;
  if(kind==='room') {
    sql='SELECT r.id AS room_id,r.name,r.emoji,'+value+' AS total '+
      'FROM sharika_gift_events e JOIN sharika_rooms r ON r.id=e.room_id '+
      'WHERE e.created_at>=? AND e.created_at<? '+
      'GROUP BY e.room_id ORDER BY total DESC,r.id ASC LIMIT 50';
  } else if(kind==='lucky') {
    sql='SELECT u.public_no,u.name,u.pic,u.wealth_level,u.charm_level,'+appearance+
      'SUM(o.payout_coins) AS total FROM sharika_lucky_gift_outcomes o '+
      'JOIN sharika_users u ON u.auth_uid=o.sender_uid '+
      'WHERE o.created_at>=? AND o.created_at<? AND o.payout_coins>0 '+
      'GROUP BY o.sender_uid ORDER BY total DESC,u.public_no ASC LIMIT 50';
  } else if(kind==='recharge') {
    // Seller transfers and finance-approved receipts are the only recharge
    // sources. Do not count welcome coins, referral bonuses or game payouts.
    sql='SELECT u.public_no,u.name,u.pic,u.wealth_level,u.charm_level,'+appearance+
      'SUM(l.delta) AS total FROM sharika_wallet_ledger l '+
      'JOIN sharika_users u ON u.auth_uid=l.auth_uid '+
      "WHERE l.created_at>=? AND l.created_at<? AND l.currency='coins' "+
      "AND l.delta>0 AND l.reason IN ('seller_recharge','manual_recharge') "+
      'GROUP BY l.auth_uid ORDER BY total DESC,u.public_no ASC LIMIT 50';
  } else {
    const participant=kind==='rich'?'e.sender_uid':'e.recipient_uid';
    sql='SELECT u.public_no,u.name,u.pic,u.wealth_level,u.charm_level,'+appearance+value+' AS total '+
      'FROM sharika_gift_events e JOIN sharika_users u ON u.auth_uid='+participant+' '+
      'WHERE e.created_at>=? AND e.created_at<? '+
      'GROUP BY '+participant+' ORDER BY total DESC,u.public_no ASC LIMIT 50';
  }
  const rows=(await db.prepare(sql).bind(startAt,endAt).all()).results||[];
  const leaders=rows.map((row,i)=>kind==='room'
    ? {rank:i+1,room_id:row.room_id,name:row.name,emoji:row.emoji||'🎙️',
       total:Number(row.total)||0}
    : {rank:i+1,public_id:id(row.public_no),name:row.name,pic:row.pic||null,
       total:Number(row.total)||0,wealth_level:row.wealth_level,
       charm_level:row.charm_level,
       frame_style:row.equipped_frame_style??row.frame_style??'',
       medal_style:row.equipped_medal_style??row.medal_style??'',
       name_tag_style:row.equipped_name_tag_style??row.name_tag_style??''});
  return {period,kind,start_at:start.toISOString(),end_at:end.toISOString(),
    leaders,read_only:true,source:kind==='recharge'?'verified_recharge_ledger':
      kind==='lucky'?'verified_lucky_gift_payouts':'settled_gift_events'};
}

export async function handleAdminOperation({ request, env, uid, path, cors, reply, fail }) {
  if (!path.startsWith(ADMIN_PREFIX)) return null;
  let actor = await env.DB.prepare(
    "SELECT a.role,u.public_no,u.name FROM sharika_admin_roles a " +
    "JOIN sharika_users u ON u.auth_uid=a.auth_uid " +
    "WHERE a.auth_uid=? AND u.status='active' " +
    "AND a.role IN ('super','support','finance')"
  ).bind(uid).first();
  if (!actor) actor=await lookupStaffActor(env.DB,uid);
  if (!actor) return fail('admin_forbidden', 403, cors);
  const operation = path.slice(ADMIN_PREFIX.length);
  const url = new URL(request.url);
  // Staff identity retains its true role on status and restricted writes.
  // The only routes delegated to legacy handlers are exact allow-listed
  // read/reply operations, and they can never acquire Super-Admin writes.
  const staffAction=await handleStaffAdmin({
    request,env,uid,actor,operation,cors,reply,fail
  });
  if(staffAction)return staffAction;
  if(actor.role==='staff'&&operation!=='status'){
    const proxy=staffProxyRole(actor,request.method,operation);
    if(!proxy)return fail('admin_permission_denied',403,cors);
    actor={...actor,role:proxy};
  }

  const operational=await handleOperationalRead({request,env,actor,operation,cors,reply,fail});
  if(operational)return operational;
  if(operation.startsWith('special-ids'))
    return await handleSpecialAdmin({request,env,uid,actor,operation,cors,reply,fail});
  if(operation==='events'||/^events\/[1-9][0-9]*(?:\/award)?$/.test(operation))
    return await handleEventAdmin({request,env,uid,actor,operation,cors,reply,fail});
  if(operation==='cosmetics'||operation==='cosmetics/grant')
    return await handleCosmeticAdmin({
      request,db:env.DB,uid,role:actor.role,path,
      readBody:async req=>{const raw=await req.text();
        if(raw.length>8192)throw Error('body_too_large');return JSON.parse(raw||'{}');},
      reply,fail,cors
    });
  if(operation==='exchange-rate')return await handleAdminExchangeRate({
    request,db:env.DB,uid,role:actor.role,reply,fail,cors
  });
  if (operation.startsWith('recharges')) return await handleRechargeAdmin({
    request, env, uid, actor, operation, cors, reply, fail
  });
  if (operation==='invites') return await handleInviteAdmin({
    request, env, uid, actor, operation, cors, reply, fail
  });
  if (operation==='daily') return await handleDailyAdmin({
    request, env, uid, actor, operation, cors, reply, fail
  });
  if(operation==='premium'||operation==='premium/grant')
    return await handlePremiumAdmin({
      request,env,uid,actor,operation,cors,reply,fail
    });
  if(operation==='bonds'||/^bonds\/gifts\/[1-9][0-9]{0,9}$/.test(operation))
    return await handleBondAdmin({request,env,uid,actor,operation,cors,reply,fail});
  if (operation.startsWith('sellers')) return await handleSellerAdmin({
    request, env, uid, actor, operation, cors, reply, fail
  });
  if(operation==='banners'||/^banners\/[1-9][0-9]{0,8}$/.test(operation))
    return await handleBannerAdmin({
      request,env,uid,role:actor.role,operation,cors,reply,fail
    });

  // Support agents may reply to real user conversations, with explicit scope.
  const supportReply=/^support\/([0-9]{8})\/reply$/.exec(operation);
  if (supportReply && request.method==='POST') {
    const denied=allowed(actor.role,new Set(['super','support']),fail,cors);
    if(denied)return denied;
    let payload;
    try {
      const raw=await request.text();
      if(raw.length>4096)return fail('support_body_too_large',413,cors);
      payload=JSON.parse(raw||'{}');
    }catch(_){return fail('invalid_support_json',400,cors);}
    const message=typeof payload?.body==='string'?payload.body.trim():'';
    const requestId=typeof payload?.request_id==='string'?payload.request_id.trim():'';
    if(message.length<1||message.length>1000||
       !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
      return fail('invalid_support_reply',400,cors);
    const target=await env.DB.prepare(
      'SELECT auth_uid,public_no,name FROM sharika_users WHERE public_no=?'
    ).bind(Number(supportReply[1])).first();
    if(!target)return fail('user_not_found',404,cors);
    const existing=await env.DB.prepare(
      'SELECT id,body,created_at FROM sharika_support_messages '+
      'WHERE request_id=? AND user_id=? AND sender_uid=?'
    ).bind(requestId,target.auth_uid,uid).first();
    if(existing)return reply({message:existing,duplicate:true},200,cors);
    const recent=await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sharika_support_messages WHERE sender_uid=? "+
      "AND sender_role='admin' AND created_at>=datetime('now','-1 minute')"
    ).bind(uid).first();
    if(Number(recent?.n||0)>=30)return fail('support_rate_limited',429,cors);
    const inserted=await env.DB.prepare(
      "INSERT OR IGNORE INTO sharika_support_messages(user_id,sender_uid,sender_role,body,request_id) "+
      "VALUES(?,?,'admin',?,?)"
    ).bind(target.auth_uid,uid,message,requestId).run();
    const saved=await env.DB.prepare(
      'SELECT id,sender_role,body,created_at FROM sharika_support_messages '+
      'WHERE request_id=? AND user_id=? AND sender_uid=?'
    ).bind(requestId,target.auth_uid,uid).first();
    if(!saved)return fail('support_request_conflict',409,cors);
    if(inserted.meta?.changes)await env.DB.prepare(
      'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
    ).bind(uid,'support_reply',JSON.stringify({
      user_id:supportReply[1],message_id:saved.id
    })).run();
    return reply({message:saved},201,cors);
  }

  // Mutations are deliberately small and restricted to verified Super Admin.
  // Other wallet and reward mutations remain disabled outside the audited seller flow.
  if (request.method !== 'GET') {
    const denied = allowed(actor.role, new Set(['super']), fail, cors);
    if (denied) return denied;
    if (!['POST','PATCH'].includes(request.method))
      return fail('admin_method_not_allowed', 405, cors);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return fail('admin_body_too_large', 413, cors);
      body = JSON.parse(raw || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return fail('invalid_admin_body', 400, cors);
    } catch (_) { return fail('invalid_admin_json', 400, cors); }

    const statusRoute = /^users\/([0-9]{8})\/status$/.exec(operation);
    if (statusRoute && request.method === 'PATCH') {
      const targetNo = Number(statusRoute[1]);
      const next = body.status;
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0,200) : '';
      if (!['active','blocked'].includes(next) || reason.length < 3)
        return fail('invalid_status_or_reason', 400, cors);
      const target = await env.DB.prepare(
        'SELECT u.auth_uid,u.status,u.name,a.role AS admin_role FROM sharika_users u ' +
        'LEFT JOIN sharika_admin_roles a ON a.auth_uid=u.auth_uid WHERE u.public_no=?'
      ).bind(targetNo).first();
      if (!target) return fail('user_not_found', 404, cors);
      if (target.auth_uid === uid || target.admin_role)
        return fail('protected_admin_account', 403, cors);
      if (target.status === 'deleted') return fail('deleted_user_immutable', 403, cors);
      if (target.status === next) return reply({ updated:false, status:next }, 200, cors);
      await env.DB.batch([
        env.DB.prepare("UPDATE sharika_users SET status=?,updated_at=datetime('now') WHERE auth_uid=? AND status=?")
          .bind(next,target.auth_uid,target.status),
        env.DB.prepare(
          'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
        ).bind(uid,'user_status',JSON.stringify({user_id:statusRoute[1],from:target.status,to:next,reason}))
      ]);
      return reply({ updated:true, public_id:statusRoute[1], status:next }, 200, cors);
    }

    if (operation === 'gifts' && request.method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0,80) : '';
      const emoji = typeof body.emoji === 'string' ? body.emoji.trim().slice(0,16) : '🎁';
      const price = body.price_coins;
      const tab = body.tab === undefined ? 0 : body.tab;
      if (!name || !Number.isSafeInteger(price) || price < 1 || price > 1000000000 ||
          !Number.isInteger(tab) || tab < 0 || tab > 2)
        return fail('invalid_gift', 400, cors);
      const active=body.active===true ? 1 : 0;
      const result=await env.DB.batch([
        env.DB.prepare('INSERT INTO sharika_gifts(name,emoji,tab,price_coins,active) VALUES(?,?,?,?,?)')
          .bind(name,emoji||'🎁',tab,price,active),
        env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'gift_create',JSON.stringify({name,tab,price,active}))
      ]);
      return reply({ created:true, id:result[0]?.meta?.last_row_id || null }, 201, cors);
    }
    const giftRoute=/^gifts\/([1-9][0-9]{0,9})$/.exec(operation);
    if (giftRoute && request.method === 'PATCH') {
      const giftId=Number(giftRoute[1]);
      const old=await env.DB.prepare('SELECT * FROM sharika_gifts WHERE id=?').bind(giftId).first();
      if(!old)return fail('gift_not_found',404,cors);
      const update={};
      if (body.active!==undefined) {
        if(typeof body.active!=='boolean')return fail('invalid_gift_active',400,cors);
        update.active=body.active?1:0;
      }
      if (body.price_coins!==undefined) {
        if(!Number.isSafeInteger(body.price_coins)||body.price_coins<1||body.price_coins>1000000000)
          return fail('invalid_gift_price',400,cors);
        update.price_coins=body.price_coins;
      }
      if(body.name!==undefined) {
        if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80)
          return fail('invalid_gift_name',400,cors);
        update.name=body.name.trim();
      }
      if(body.tab!==undefined) {
        if(!Number.isInteger(body.tab)||body.tab<0||body.tab>2)return fail('invalid_gift_tab',400,cors);
        update.tab=body.tab;
      }
      if(body.emoji!==undefined) {
        if(typeof body.emoji!=='string'||body.emoji.trim().length>16)return fail('invalid_gift_emoji',400,cors);
        update.emoji=body.emoji.trim()||'🎁';
      }
      if(!Object.keys(update).length)return fail('no_gift_changes',400,cors);
      const keys=Object.keys(update);
      await env.DB.batch([
        env.DB.prepare('UPDATE sharika_gifts SET '+keys.map(x=>x+'=?').join(',')+' WHERE id=?')
          .bind(...keys.map(x=>update[x]),giftId),
        env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
          .bind(uid,'gift_update',JSON.stringify({gift_id:giftId,changes:update}))
      ]);
      return reply({ updated:true,id:giftId },200,cors);
    }
    return fail('admin_write_not_enabled',405,cors);
  }

  // Authenticated user reports use the verified Support Inbox.
  // Moderators get read-only triage; audited Super Admin blocks stay separate.
  if(operation==='reports' && request.method==='GET'){
    const denied=allowed(actor.role,new Set(['super','support']),fail,cors);
    if(denied)return denied;
    const rows=values(await env.DB.prepare(
      'SELECT m.id,m.body,m.created_at,u.public_no AS reporter_no '+
      'FROM sharika_support_messages m '+
      'JOIN sharika_users u ON u.auth_uid=m.user_id '+
      "WHERE m.sender_role='user' AND m.body LIKE '[Sharika report]%' "+
      'ORDER BY m.id DESC LIMIT 100'
    ).all());
    return reply({reports:rows.map(row=>({
      id:row.id,reporter_public_id:id(row.reporter_no),
      body:row.body,created_at:row.created_at
    })),read_only:true,limited_to:100},200,cors);
  }
  if(operation==='support') {
    const denied=allowed(actor.role,new Set(['super','support']),fail,cors);
    if(denied)return denied;
    const rows=values(await env.DB.prepare(
      'SELECT u.public_no,u.name,COUNT(*) AS message_count,MAX(m.id) AS last_id,'+
      '(SELECT body FROM sharika_support_messages x WHERE x.user_id=m.user_id '+
      'ORDER BY x.id DESC LIMIT 1) AS last_body '+
      'FROM sharika_support_messages m JOIN sharika_users u ON u.auth_uid=m.user_id '+
      'GROUP BY m.user_id ORDER BY last_id DESC LIMIT 100'
    ).all());
    return reply({conversations:rows.map(x=>({...x,public_id:id(x.public_no),
      public_no:undefined})),limited_to:100},200,cors);
  }
  const supportRoute=/^support\/([0-9]{8})$/.exec(operation);
  if(supportRoute) {
    const denied=allowed(actor.role,new Set(['super','support']),fail,cors);
    if(denied)return denied;
    const target=await env.DB.prepare(
      'SELECT auth_uid,public_no,name FROM sharika_users WHERE public_no=?'
    ).bind(Number(supportRoute[1])).first();
    if(!target)return fail('user_not_found',404,cors);
    const messages=values(await env.DB.prepare(
      'SELECT id,sender_role,body,created_at FROM sharika_support_messages '+
      'WHERE user_id=? ORDER BY id DESC LIMIT 100'
    ).bind(target.auth_uid).all()).reverse();
    return reply({user:{public_id:id(target.public_no),name:target.name},
      messages},200,cors);
  }
  if (operation === 'status') {
    const staff=actor.role==='staff';
    return reply({ role:actor.role,name:actor.name,
      public_id:staff?null:id(actor.public_no),
      environment:'staging',
      permissions:staff?actor.permissions:null,
      daily_coin_limit:staff?actor.daily_coin_limit:null,
      read_only:staff?!actor.permissions.some(p=>['coin_recharge','support_reply'].includes(p)):actor.role!=='super',
      write_scopes:staff?actor.permissions.filter(p=>['coin_recharge','support_reply'].includes(p)):
        actor.role==='super'?['user_status','gift_catalog','support_reply','seller_approval',
          'seller_stock_allocation','daily_reward_config','premium_membership_config',
          'premium_membership_grant','coin_recharge','staff_manage']:
          actor.role==='support'?['support_reply']:[] }, 200, cors);
  }
  if (operation === 'rankings' && request.method === 'GET') {
    const denied=allowed(actor.role,FINANCE_ROLES,fail,cors);
    if(denied)return denied;
    const period=url.searchParams.get('period')||'weekly';
    const kind=url.searchParams.get('kind')||'rich';
    const result=await readGiftRankings(env.DB,period,kind);
    return result?reply(result,200,cors):fail('invalid_ranking_filter',400,cors);
  }
  // Read only verified Android activity. The dedicated Durable Object expires
  // stale entries automatically; never infer online counts from saved members.
  async function presence() {
    if(!env.VOICE_ROOMS)return null;
    try {
      const result=await env.VOICE_ROOMS
        .getByName('sharika:presence:staging').presenceStats();
      if(!Number.isSafeInteger(result?.online_users) ||
         !Number.isSafeInteger(result?.live_rooms))return null;
      return result;
    } catch(error) {
      console.warn('sharika_presence_unavailable',error?.message);
      return null;
    }
  }
  if (operation === 'dashboard') {
    const totals = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM sharika_users) AS users, ' +
      '(SELECT COUNT(*) FROM sharika_rooms) AS rooms, ' +
      '(SELECT COUNT(*) FROM sharika_gifts WHERE active=1) AS active_gifts, ' +
      '(SELECT COUNT(*) FROM sharika_wallet_ledger) AS ledger_entries, ' +
      '(SELECT COALESCE(SUM(coins),0) FROM sharika_users) AS coins_total, ' +
      '(SELECT COALESCE(SUM(diamonds),0) FROM sharika_users) AS diamonds_total'
    ).first();
    const tracking=await presence();
    return reply({ ...totals, online_users:tracking?.online_users??null,
      live_rooms:tracking?.live_rooms??null, presence_window_seconds:tracking?.window_seconds??null,
      coins_total:FINANCE_ROLES.has(actor.role) ? totals.coins_total : null,
      diamonds_total:FINANCE_ROLES.has(actor.role) ? totals.diamonds_total : null,
      read_only:true }, 200, cors);
  }
  if (operation === 'analytics') {
    const totals=await env.DB.prepare(
      'SELECT '+
      '(SELECT COUNT(*) FROM sharika_users WHERE status=\'active\') AS active_users,'+
      '(SELECT COUNT(*) FROM sharika_users WHERE status=\'blocked\') AS blocked_users,'+
      '(SELECT COUNT(*) FROM sharika_rooms) AS total_rooms,'+
      '(SELECT COUNT(*) FROM sharika_room_members WHERE seat_no IS NOT NULL) AS occupied_seats,'+
      '(SELECT COUNT(*) FROM sharika_room_members) AS room_memberships,'+
      '(SELECT COUNT(*) FROM sharika_gifts) AS catalog_gifts,'+
      '(SELECT COUNT(*) FROM sharika_gifts WHERE active=1) AS active_gifts,'+
      '(SELECT COUNT(*) FROM sharika_admin_roles) AS admins'
    ).first();
    const tracking=await presence();
    return reply({ ...totals,read_only:true,live_presence_tracked:!!tracking,
      online_users:tracking?.online_users??null,live_rooms:tracking?.live_rooms??null },200,cors);
  }
  const membersRoute=/^rooms\/([0-9]{8})\/members$/.exec(operation);
  if (membersRoute) {
    const blocked=allowed(actor.role, ROOM_ROLES, fail, cors);
    if(blocked)return blocked;
    const room=await env.DB.prepare('SELECT id,name FROM sharika_rooms WHERE id=?')
      .bind(membersRoute[1]).first();
    if(!room)return fail('room_not_found',404,cors);
    const rows=values(await env.DB.prepare(
      'SELECT u.public_no,u.name,m.role,m.seat_no,m.muted,m.joined_at '+
      'FROM sharika_room_members m JOIN sharika_users u ON u.auth_uid=m.user_id '+
      'WHERE m.room_id=? ORDER BY m.role DESC,m.seat_no,m.joined_at LIMIT 100'
    ).bind(membersRoute[1]).all());
    return reply({room, members:rows.map(m=>({...m,public_id:id(m.public_no),
      public_no:undefined})), live_presence_tracked:false, read_only:true},200,cors);
  }
  if (operation === 'users') {
    const search = (url.searchParams.get('q') || '').trim().slice(0, 80);
    const columns = 'SELECT public_no,name,country,coins,diamonds,wealth_level,charm_level,status,created_at FROM sharika_users';
    let stmt = env.DB.prepare(columns + (search ?
      ' WHERE lower(name) LIKE ? OR CAST(public_no AS TEXT) LIKE ?' : '') +
      ' ORDER BY created_at DESC, public_no DESC LIMIT 100');
    if (search) stmt = stmt.bind('%' + search.toLowerCase() + '%', '%' + search + '%');
    const rows = values(await stmt.all());
    return reply({ users:rows.map(u => ({ ...u, public_id:id(u.public_no),
      public_no:undefined })), limited_to:100, read_only:true }, 200, cors);
  }
  if (operation === 'rooms') {
    const blocked = allowed(actor.role, ROOM_ROLES, fail, cors);
    if (blocked) return blocked;
    const rows = values(await env.DB.prepare(
      'SELECT r.id,r.name,r.emoji,r.theme,r.seat_count,r.created_at,' +
      'u.public_no AS owner_public_no,' +
      '(SELECT COUNT(*) FROM sharika_room_members m WHERE m.room_id=r.id) AS members ' +
      'FROM sharika_rooms r LEFT JOIN sharika_users u ON u.auth_uid=r.owner_id ' +
      'ORDER BY r.created_at DESC LIMIT 100'
    ).all());
    let onlineCounts=null;
    if(env.VOICE_ROOMS){
      try{
        const result=await env.VOICE_ROOMS
          .getByName('sharika:presence:staging').presenceRoomCounts();
        if(result&&typeof result==='object'&&!Array.isArray(result))onlineCounts=result;
      }catch(error){console.warn('sharika_room_presence_unavailable',error?.message);}
    }
    return reply({rooms:rows.map(r=>({...r,
      owner_public_id:r.owner_public_no==null?null:id(r.owner_public_no),
      owner_public_no:undefined,
      online_count:onlineCounts===null?null:
        Math.max(0,Number(onlineCounts[r.id])||0)
    })),live_presence_tracked:onlineCounts!==null,
      presence_window_seconds:onlineCounts===null?null:90,read_only:true},200,cors);
  }
  if (operation === 'ledger') {
    const blocked = allowed(actor.role, FINANCE_ROLES, fail, cors);
    if (blocked) return blocked;
    const publicId = (url.searchParams.get('public_id') || '').trim();
    if (publicId && !PUBLIC_ID.test(publicId)) return fail('invalid_public_id', 400, cors);
    let stmt = env.DB.prepare(
      'SELECT l.id,u.public_no,l.currency,l.delta,l.balance_after,l.reason,l.created_at ' +
      'FROM sharika_wallet_ledger l JOIN sharika_users u ON u.auth_uid=l.auth_uid ' +
      (publicId ? 'WHERE u.public_no=? ' : '') + 'ORDER BY l.id DESC LIMIT 100'
    );
    if (publicId) stmt = stmt.bind(Number(publicId));
    const rows = values(await stmt.all());
    return reply({ ledger:rows.map(l => ({ ...l, public_id:id(l.public_no), public_no:undefined })),
      limited_to:100, read_only:true }, 200, cors);
  }
  // A transaction-level audit view, including fractional room and recipient
  // entitlements. Each source is 0-or-1 row per transaction except the
  // recipient aggregate, so multiple recipients cannot multiply the spend.
  if (operation === 'gift-settlements' && request.method === 'GET') {
    const denied=allowed(actor.role,FINANCE_ROLES,fail,cors);
    if(denied)return denied;
    const rows=values(await env.DB.prepare(
      'SELECT t.id,t.room_id,t.quantity,t.total_coins,t.created_at,'+
      's.public_no AS sender_no,g.name,g.emoji,g.tab,'+
      'o.payout_coins,o.max_multiplier,'+
      'lr.reward_hundredths AS lucky_room_hundredths,'+
      'rr.reward_hundredths AS regular_room_hundredths,'+
      '(SELECT COALESCE(SUM(x.earned_hundredths),0) '+
      'FROM sharika_lucky_recipient_rewards x WHERE x.transaction_id=t.id) '+
      'AS recipient_hundredths,'+
      '(SELECT COUNT(*) FROM sharika_gift_events e WHERE e.transaction_id=t.id) '+
      'AS recipient_count '+
      'FROM sharika_gift_transactions t '+
      'JOIN sharika_users s ON s.auth_uid=t.sender_uid '+
      'JOIN sharika_gifts g ON g.id=t.gift_id '+
      'LEFT JOIN sharika_lucky_gift_outcomes o ON o.transaction_id=t.id '+
      'LEFT JOIN sharika_lucky_room_rewards lr ON lr.transaction_id=t.id '+
      'LEFT JOIN sharika_regular_room_rewards rr ON rr.transaction_id=t.id '+
      'ORDER BY t.id DESC LIMIT 100'
    ).all());
    return reply({settlements:rows.map(row=>({
      transaction_id:row.id,created_at:row.created_at,room_id:row.room_id,
      sender_id:id(row.sender_no),gift:row.name,emoji:row.emoji,
      kind:row.tab===2?'lucky':'regular',quantity:Number(row.quantity),
      recipient_count:Number(row.recipient_count),
      spent_coins:Number(row.total_coins),
      lucky_payout_coins:row.payout_coins==null?null:Number(row.payout_coins),
      lucky_max_multiplier:row.max_multiplier==null?null:Number(row.max_multiplier),
      recipient_diamond_hundredths:Number(row.recipient_hundredths),
      room_reward_hundredths:Number(row.lucky_room_hundredths??row.regular_room_hundredths??0),
      room_reward_status:'room_accrued_not_owner_paid'
    })),limited_to:100,read_only:true,
      note:'Fractional diamond accrual is not the same as whole diamonds credited to a wallet. Room shares are room-only, not automatically paid to a user.'},200,cors);
  }
  if (operation === 'gift-events' && request.method === 'GET') {
    const denied=allowed(actor.role,FINANCE_ROLES,fail,cors);
    if(denied)return denied;
    const rows=values(await env.DB.prepare(
      'SELECT e.id,e.room_id,e.quantity,e.price_coins,e.created_at,'+
      's.public_no AS sender_no,r.public_no AS recipient_no,g.name,g.emoji '+
      'FROM sharika_gift_events e '+
      'JOIN sharika_users s ON s.auth_uid=e.sender_uid '+
      'JOIN sharika_users r ON r.auth_uid=e.recipient_uid '+
      'JOIN sharika_gifts g ON g.id=e.gift_id '+
      'ORDER BY e.id DESC LIMIT 100'
    ).all());
    return reply({events:rows.map(e=>({
      id:e.id,room_id:e.room_id,sender_id:id(e.sender_no),
      recipient_id:id(e.recipient_no),gift:e.name,emoji:e.emoji,
      quantity:e.quantity,coins:e.quantity*e.price_coins,
      created_at:e.created_at
    })),read_only:true},200,cors);
  }
  if (operation === 'gifts') {
    const rows = values(await env.DB.prepare(
      'SELECT id,name,emoji,tab,price_coins,active,image_url,animation_url FROM sharika_gifts ORDER BY id LIMIT 100'
    ).all());
    return reply({ gifts:rows, read_only:true }, 200, cors);
  }
  if (operation === 'audit') {
    const blocked = allowed(actor.role, new Set(['super']), fail, cors);
    if (blocked) return blocked;
    const rows = values(await env.DB.prepare(
      'SELECT a.id,u.public_no AS actor_public_no,a.action,a.details_json,a.created_at ' +
      'FROM sharika_admin_audit a LEFT JOIN sharika_users u ON u.auth_uid=a.actor_id ' +
      'ORDER BY a.id DESC LIMIT 100'
    ).all());
    return reply({ audit:rows.map(a => ({ ...a, actor_public_id:a.actor_public_no == null ?
      null : id(a.actor_public_no), actor_public_no:undefined })), read_only:true }, 200, cors);
  }
  if (operation === 'roles') {
    const blocked = allowed(actor.role, new Set(['super']), fail, cors);
    if (blocked) return blocked;
    const rows = values(await env.DB.prepare(
      'SELECT u.public_no,u.name,a.role,a.assigned_at FROM sharika_admin_roles a ' +
      'JOIN sharika_users u ON u.auth_uid=a.auth_uid ORDER BY a.assigned_at DESC LIMIT 100'
    ).all());
    return reply({ admins:rows.map(a => ({ ...a, public_id:id(a.public_no), public_no:undefined })),
      read_only:true }, 200, cors);
  }
  if (operation === 'config') {
    return reply({ kv:{}, editable:false, read_only:true }, 200, cors);
  }
  return fail('admin_module_not_ready', 501, cors);
}
