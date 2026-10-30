// Sharika staging admin: read-only endpoints over the same D1 user/room/wallet tables.
// Every request is authenticated by the outer Worker with a verified Firebase JWT.
// This module deliberately has no account-creation, wallet-mutation or admin-seeding route.
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
  if (request.method !== 'GET') return fail('admin_write_not_enabled', 405, cors);
  const operation = path.slice(ADMIN_PREFIX.length);
  const url = new URL(request.url);

  if (operation === 'status') {
    return reply({ role:actor.role, name:actor.name, public_id:id(actor.public_no),
      environment:'staging', read_only:true }, 200, cors);
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
