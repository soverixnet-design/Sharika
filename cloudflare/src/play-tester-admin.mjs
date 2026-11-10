// Isolated Play closed-test administration. Public IDs are database-local;
// no write ever crosses from a Play tester into the staging wallet or profile.
// Staging's Firebase-verified Super Admin role gates every operation.
import { recordUserEvent } from './transaction-notices.mjs';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const publicId = number => String(number).padStart(8, '0');
const PLAY_ID = /^[0-9]{8}$/;
const RECEIPT = /^[a-zA-Z0-9:_-]{12,80}$/;
const MAX_CREDIT = 1_000_000;
const MAX_BALANCE = 1_000_000_000_000;

async function superActor(request, env) {
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(bearer)) return { error: response({ error: 'not_authenticated' }, 401) };
  if (!env.SHARIKA_API || !env.PLAY_DB || !env.STAGING_DB)
    return { error: response({ error: 'play_testers_unavailable' }, 503) };
  try {
    // This private service checks the JWT and canonical staging D1 admin role.
    const checked = await env.SHARIKA_API.fetch(new Request(
      'https://sharika-api-staging.soverixnet.workers.dev/api/v1/admin/status',
      { method: 'GET', headers: { authorization: bearer } }
    ));
    if (checked.status === 401 || checked.status === 403)
      return { error: response({ error: 'admin_forbidden' }, 403) };
    if (!checked.ok) return { error: response({ error: 'admin_verification_unavailable' }, 503) };
    const actor = await checked.json();
    if (actor.role !== 'super' || !PLAY_ID.test(actor.public_id || ''))
      return { error: response({ error: 'super_admin_required' }, 403) };
    return { actorId: 'staging-super:' + actor.public_id };
  } catch (_) {
    return { error: response({ error: 'admin_verification_unavailable' }, 503) };
  }
}

async function inputJson(request) {
  const body = await request.text();
  if (body.length > 4096) throw new Error('invalid_play_grant_body');
  const parsed = JSON.parse(body || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('invalid_play_grant_body');
  return parsed;
}

async function playUser(db, id) {
  return db.prepare('SELECT auth_uid,public_no,status,coins FROM sharika_users WHERE public_no=?')
    .bind(Number(id)).first();
}

async function playCredit(request, env, actorId) {
  let body;
  try { body = await inputJson(request); }
  catch (_) { return response({ error: 'invalid_play_grant_body' }, 400); }
  const { target_public_id: targetId, coins: amount, request_id: requestId } = body;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (typeof targetId !== 'string' || !PLAY_ID.test(targetId) ||
      !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_CREDIT ||
      typeof requestId !== 'string' || !RECEIPT.test(requestId) ||
      reason.length < 8 || reason.length > 200)
    return response({ error: 'invalid_play_virtual_credit' }, 400);
  const db = env.PLAY_DB;
  const target = await playUser(db, targetId);
  if (!target) return response({ error: 'play_user_not_found' }, 404);
  const existing = await db.prepare(
    'SELECT recipient_uid,coins,reason,id,balance_after FROM sharika_admin_direct_recharges '+
    'WHERE actor_uid=? AND request_id=?'
  ).bind(actorId, requestId).first();
  if (existing) {
    if (existing.recipient_uid !== target.auth_uid || Number(existing.coins) !== amount ||
        existing.reason !== reason)
      return response({ error: 'idempotency_conflict' }, 409);
    return response({ duplicate: true, transaction_id: existing.id, recipient_id: targetId,
      coins: amount, balance_after: existing.balance_after, environment: 'play_virtual' });
  }
  if (target.status !== 'active') return response({ error: 'play_user_inactive' }, 409);
  if (Number(target.coins) > MAX_BALANCE - amount)
    return response({ error: 'play_wallet_limit' }, 409);
  try {
    await db.batch([
      db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
        .bind(MAX_BALANCE - amount, amount, target.auth_uid),
      db.prepare('INSERT INTO sharika_admin_direct_recharges'+
        '(actor_uid,recipient_uid,coins,reason,request_id,balance_after) '+
        'VALUES(?,?,?,?,?,(SELECT coins FROM sharika_users WHERE auth_uid=?))')
        .bind(actorId,target.auth_uid,amount,reason,requestId,target.auth_uid),
      db.prepare('INSERT INTO sharika_wallet_ledger'+
        '(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
        "'play_virtual_admin_credit',?)")
        .bind(target.auth_uid,amount,target.auth_uid,'play-admin:'+actorId+':'+requestId)
    ]);
  } catch (error) {
    // An uncertain network response must not cause a second grant on retry.
    const saved = await db.prepare('SELECT recipient_uid,coins,reason,id,balance_after '+
      'FROM sharika_admin_direct_recharges WHERE actor_uid=? AND request_id=?')
      .bind(actorId,requestId).first();
    if (saved && saved.recipient_uid === target.auth_uid && Number(saved.coins) === amount &&
        saved.reason === reason)
      return response({ duplicate: true, transaction_id: saved.id, recipient_id: targetId,
        coins: amount, balance_after: saved.balance_after, environment: 'play_virtual' });
    if (saved) return response({ error: 'idempotency_conflict' }, 409);
    if (/CHECK constraint|play_wallet_limit/.test(String(error?.message || error)))
      return response({ error: 'play_wallet_limit' }, 409);
    throw error;
  }
  const saved = await db.prepare('SELECT id,balance_after FROM sharika_admin_direct_recharges '+
    'WHERE actor_uid=? AND request_id=?').bind(actorId,requestId).first();
  if (!saved) return response({ error: 'play_credit_unconfirmed' }, 503);
  await recordUserEvent({ db, recipientUid: target.auth_uid, kind: 'reward',
    title: 'Play-test coins received',
    body: amount.toLocaleString('en-US') + ' non-redeemable test coins were added by an administrator.',
    dedupeKey: 'play_virtual_admin_credit:' + actorId + ':' + requestId });
  return response({ duplicate: false, transaction_id: saved.id, recipient_id: targetId,
    coins: amount, balance_after: saved.balance_after, environment: 'play_virtual' }, 201);
}

async function playCosmetic(request, env, actorId) {
  let body;
  try { body = await inputJson(request); }
  catch (_) { return response({ error: 'invalid_play_grant_body' }, 400); }
  const { target_public_id: targetId, item_id: itemId, request_id: requestId } = body;
  if (typeof targetId !== 'string' || !PLAY_ID.test(targetId) ||
      typeof itemId !== 'string' || !/^[a-z_]+:[a-z0-9-]{3,55}$/.test(itemId) ||
      typeof requestId !== 'string' || !RECEIPT.test(requestId))
    return response({ error: 'invalid_play_cosmetic_grant' }, 400);
  const db = env.PLAY_DB;
  const target = await playUser(db, targetId);
  if (!target || target.status !== 'active')
    return response({ error: 'play_user_unavailable' }, 404);
  const item = await db.prepare('SELECT id,kind,name FROM sharika_cosmetics_catalog WHERE id=?')
    .bind(itemId).first();
  if (!item) return response({ error: 'play_item_unavailable' }, 404);
  const previous = await db.prepare('SELECT recipient_uid,item_id,id FROM sharika_play_admin_item_grants '+
    'WHERE actor_id=? AND request_id=?').bind(actorId,requestId).first();
  if (previous) {
    if (previous.recipient_uid !== target.auth_uid || previous.item_id !== itemId)
      return response({ error: 'idempotency_conflict' }, 409);
    return response({ duplicate: true, equipped: true, item_id: itemId,
      recipient_id: targetId, transaction_id: previous.id, environment: 'play_virtual' });
  }
  const owned = await db.prepare('SELECT 1 AS owned FROM sharika_cosmetic_inventory '+
    'WHERE auth_uid=? AND item_id=?').bind(target.auth_uid,itemId).first();
  try {
    await db.batch([
      db.prepare('INSERT INTO sharika_play_admin_item_grants'+
        '(actor_id,recipient_uid,item_id,request_id) VALUES(?,?,?,?)')
        .bind(actorId,target.auth_uid,itemId,requestId),
      db.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id) "+
        "VALUES(?,?,'admin_grant',?) ON CONFLICT(auth_uid,item_id) DO NOTHING")
        .bind(target.auth_uid,itemId,'play-admin:'+requestId),
      db.prepare('INSERT INTO sharika_cosmetic_equipped(auth_uid,kind,item_id) VALUES(?,?,?) '+
        "ON CONFLICT(auth_uid,kind) DO UPDATE SET item_id=excluded.item_id,equipped_at=datetime('now')")
        .bind(target.auth_uid,item.kind,itemId)
    ]);
  } catch (error) {
    const saved = await db.prepare('SELECT recipient_uid,item_id,id FROM sharika_play_admin_item_grants '+
      'WHERE actor_id=? AND request_id=?').bind(actorId,requestId).first();
    if (saved?.recipient_uid === target.auth_uid && saved.item_id === itemId)
      return response({ duplicate: true, equipped: true, item_id: itemId,
        recipient_id: targetId, transaction_id: saved.id, environment: 'play_virtual' });
    if (saved) return response({ error: 'idempotency_conflict' }, 409);
    throw error;
  }
  const saved = await db.prepare('SELECT id FROM sharika_play_admin_item_grants '+
    'WHERE actor_id=? AND request_id=?').bind(actorId,requestId).first();
  if (!saved) return response({ error: 'play_grant_unconfirmed' }, 503);
  await recordUserEvent({ db, recipientUid: target.auth_uid, kind: 'reward',
    title: 'Play-test item received',
    body: 'Your ' + String(item.name).slice(0,80) + ' was ' +
      (owned ? 'equipped again.' : 'granted and equipped. Open My Backpack.'),
    dedupeKey: 'play_virtual_item_grant:' + actorId + ':' + requestId });
  return response({ duplicate: false, equipped: true, item_id: itemId,
    recipient_id: targetId, transaction_id: saved.id, environment: 'play_virtual' }, 201);
}

export async function handlePlayTestAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const root = '/api/v1/admin/play-testers';
  const route = path === root ? '' : path.startsWith(root + '/') ? path.slice(root.length + 1) : null;
  if (route === null) return response({ error: 'not_found' }, 404);
  const method = request.method;
  const permissions = route === '' || route === 'catalog' || route === 'credits' ? ['GET'] :
    route === 'coins' || route === 'cosmetics/grant' ? ['POST'] : [];
  if (!permissions.length) return response({ error: 'not_found' }, 404);
  if (!permissions.includes(method)) return response({ error: 'method_not_allowed' }, 405);
  if ((route !== '' && url.search) || (route === '' && [...url.searchParams.keys()].some(k => k !== 'q')))
    return response({ error: 'invalid_query' }, 400);
  const verified = await superActor(request, env);
  if (verified.error) return verified.error;
  if (route === 'coins') return playCredit(request, env, verified.actorId);
  if (route === 'cosmetics/grant') return playCosmetic(request, env, verified.actorId);
  if (route === 'catalog') {
    const items = (await env.PLAY_DB.prepare('SELECT id,kind,name,active '+
      'FROM sharika_cosmetics_catalog ORDER BY kind,name LIMIT 200').all()).results || [];
    return response({ items, environment: 'play_virtual', read_only: true });
  }
  if (route === 'credits') {
    const grants = (await env.PLAY_DB.prepare('SELECT g.id,u.public_no,g.coins,g.reason,'+
      'g.balance_after,g.created_at FROM sharika_admin_direct_recharges g '+
      'JOIN sharika_users u ON u.auth_uid=g.recipient_uid '+
      'WHERE g.actor_uid LIKE ? ORDER BY g.id DESC LIMIT 50')
      .bind('staging-super:%').all()).results || [];
    return response({ grants: grants.map(g => ({ ...g, recipient_id: publicId(g.public_no),
      public_no: undefined })), environment: 'play_virtual', read_only: true });
  }

  if ([...url.searchParams.keys()].some(key => key !== 'q'))
    return response({ error: 'invalid_query' }, 400);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length > 80) return response({ error: 'invalid_query' }, 400);
  try {
    let query = env.PLAY_DB.prepare(
      'SELECT auth_uid,public_no,name,country,status,coins,diamonds,created_at FROM sharika_users ' +
      (q ? 'WHERE lower(name) LIKE ? OR CAST(public_no AS TEXT) LIKE ? ' : '') +
      'ORDER BY created_at DESC, public_no DESC LIMIT 100'
    );
    if (q) query = query.bind('%' + q.toLowerCase() + '%', '%' + q + '%');
    const play = (await query.all()).results || [];

    // Compare immutable Firebase identities, not overlapping public numbers.
    // All private UIDs stay within this Worker and are never sent to the UI.
    const uids = [...new Set(play.map(user => user.auth_uid).filter(Boolean))];
    const previous = new Map();
    if (uids.length) {
      const slots = uids.map(() => '?').join(',');
      const sql = 'SELECT auth_uid,public_no FROM sharika_users WHERE auth_uid IN (' + slots + ')';
      const old = (await env.STAGING_DB.prepare(sql).bind(...uids).all()).results || [];
      for (const person of old) previous.set(person.auth_uid, publicId(person.public_no));
    }
    return response({
      users: play.map(person => ({
        public_id: publicId(person.public_no),
        previous_staging_id: previous.get(person.auth_uid) || null,
        name: person.name, country: person.country, status: person.status,
        coins: person.coins, diamonds: person.diamonds,
        created_at: person.created_at
      })),
      environment: 'play_virtual', read_only: true, limited_to: 100,
      identity_match: 'firebase_uid'
    });
  } catch (_) {
    return response({ error: 'play_testers_unavailable' }, 503);
  }
}

// Keep the legacy read-only API exported for older integration consumers.
export async function readPlayTesters(request, env) {
  return handlePlayTestAdmin(request, env);
}
