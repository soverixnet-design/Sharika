// Sharika staging admin: verified D1 reads plus restricted user moderation and gift catalog edits.
// Every request is authenticated by the outer Worker with a verified Firebase JWT.
// No account-creation, wallet-mutation, gameplay, or admin-seeding route.
const ADMIN_PREFIX = '/api/v1/admin/';
const PUBLIC_ID = /^[0-9]{8}$/;
const FINANCE_ROLES = new Set(['super', 'finance']);
const ROOM_ROLES = new Set(['super', 'support']);
function id(value) { return String(value).padStart(8, '0'); }
function values(result) { return result.results || []; }
function allowed(role, roles, fail, cors) {
  return roles.has(role) ? null : fail('admin_permission_denied', 403, cors);
}

export async function handleAdminOperation({ request, env, uid, path, cors, reply, fail }) {
  if (!path.startsWith(ADMIN_PREFIX)) return null;
  const actor = await env.DB.prepare(
    "SELECT a.role,u.public_no,u.name FROM sharika_admin_roles a " +
    "JOIN sharika_users u ON u.auth_uid=a.auth_uid " +
    "WHERE a.auth_uid=? AND u.status='active' " +
    "AND a.role IN ('super','support','finance')"
  ).bind(uid).first();
  if (!actor) return fail('admin_forbidden', 403, cors);
  const operation = path.slice(ADMIN_PREFIX.length);
  const url = new URL(request.url);

  // Mutations are deliberately small and restricted to verified Super Admin.
  // No balance, recharge, reward, or other financial mutation is exposed.
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

  if (operation === 'status') {
    return reply({ role:actor.role, name:actor.name, public_id:id(actor.public_no),
      environment:'staging', read_only:actor.role!=='super',
      write_scopes:actor.role==='super'?['user_status','gift_catalog']:[] }, 200, cors);
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
    return reply({ ...totals, online_users:null, live_rooms:null,
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
    return reply({ ...totals, read_only:true, live_presence_tracked:false },200,cors);
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
    return reply({ rooms:rows.map(r => ({ ...r, owner_public_id:r.owner_public_no == null ?
      null : id(r.owner_public_no), owner_public_no:undefined })), read_only:true }, 200, cors);
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
