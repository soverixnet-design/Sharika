import { verifyFirebaseToken } from './auth.mjs';
import { handleVoiceOperation } from './sfu.mjs';
import { handleAdminOperation } from './admin.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const PUBLIC_ID = /^[0-9]{8}$/;
const MAX_BODY = 20_000;
const enc = new TextEncoder();

function reply(payload, status = 200, cors = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...cors } });
}
function fail(code, status, cors) { return reply({ error: code }, status, cors); }
function txt(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function publicId(n) { return String(n).padStart(8, '0'); }
function showProfile(user) {
  if (!user) return null;
  return {
    user_id: user.auth_uid, public_id: publicId(user.public_no),
    name: user.name, country: user.country, birthdate: user.birthdate,
    minor: !!user.minor, pic: user.pic, cover: user.cover, bio: user.bio,
    coins: user.coins, diamonds: user.diamonds, xp: user.xp,
    wealth_level: user.wealth_level, charm_level: user.charm_level, status: user.status
  };
}
function ageFromDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== raw) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  if (today.getUTCMonth() < date.getUTCMonth() ||
      (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())) age--;
  return age >= 13 && age <= 120 ? age : null;
}
async function readBody(request) {
  const body = await request.text();
  if (body.length > MAX_BODY) throw new Error('body_too_large');
  const parsed = body ? JSON.parse(body) : {};
  if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) throw new Error('invalid_body');
  return parsed;
}
function corsFor(request, env) {
  const origin = request.headers.get('origin');
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (origin && !list.includes(origin)) return null;
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin, 'vary': 'Origin',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,idempotency-key',
  };
}
async function me(db, uid) {
  return db.prepare('SELECT * FROM sharika_users WHERE auth_uid = ?').bind(uid).first();
}
async function assertActive(db, uid) {
  const user = await me(db, uid);
  if (!user) throw new Error('profile_not_found');
  if (user.status !== 'active') throw new Error('profile_unavailable');
  return user;
}
async function roomAndMember(db, roomId, uid) {
  const room = await db.prepare('SELECT * FROM sharika_rooms WHERE id=?').bind(roomId).first();
  if (!room) throw new Error('room_not_found');
  const member = await db.prepare('SELECT * FROM sharika_room_members WHERE room_id=? AND user_id=?')
    .bind(roomId, uid).first();
  return { room, member };
}
function b64url(input) {
  const data = input instanceof Uint8Array ? input : enc.encode(input);
  let binary = ''; for (const n of data) binary += String.fromCharCode(n);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function createVoiceToken(env, uid, room, publish, owner) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.LIVEKIT_API_KEY, sub: 'sharika:' + uid,
    iat: now, nbf: now - 5, exp: now + 600,
    video: { room: 'sharika:' + room, roomJoin: true, canPublish: publish, canSubscribe: true,
      canPublishData: true, ...(publish ? { canPublishSources: ['microphone'] } : {}),
      ...(owner ? { roomAdmin: true } : {}) }
  };
  const data = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(claims));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.LIVEKIT_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sign = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + b64url(new Uint8Array(sign));
}

export async function handleRequest(request, env) {
  const cors = corsFor(request, env);
  if (!cors) return fail('origin_forbidden', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/health' && request.method === 'GET') {
    // A database-only diagnostic for staging. Authentication remains unavailable
    // until FIREBASE_PROJECT_ID is explicitly configured for protected endpoints.
    if (!env.DB) return fail('database_unavailable', 503, cors);
    try {
      await env.DB.prepare('SELECT 1 AS ok').first();
      return reply({ ok: true, service: 'sharika-cloudflare-staging', environment: 'staging',
        auth_configured: !!env.FIREBASE_PROJECT_ID }, 200, cors);
    } catch (_) { return fail('database_unavailable', 503, cors); }
  }
  if (!env.DB || !env.FIREBASE_PROJECT_ID) return fail('not_configured', 503, cors);
  let actor;
  try { actor = await verifyFirebaseToken(request.headers.get('authorization'), env.FIREBASE_PROJECT_ID); }
  catch (_) { return fail('identity_provider_unavailable', 503, cors); }
  if (!actor || !actor.verified) return fail('not_authenticated', 401, cors);

  const uid = actor.uid;
  const parts = path.split('/').filter(Boolean);
  try {
    if (path.startsWith('/api/v1/admin/')) return await handleAdminOperation({
      request, env, uid, path, cors, reply, fail
    });
    if (path === '/api/v1/me') {
      if (request.method === 'GET') {
        const user = await me(env.DB, uid);
        return user ? reply(showProfile(user), 200, cors) : fail('profile_not_found', 404, cors);
      }
      if (request.method === 'POST') {
        const already = await me(env.DB, uid);
        if (already) return fail('profile_exists', 409, cors);
        const body = await readBody(request);
        const name = txt(body.name, 80);
        const age = ageFromDate(body.birthdate);
        if (!name || age === null) return fail('invalid_profile', 400, cors);
        const country = txt(body.country, 16);
        const pic = txt(body.pic, 2048) || null;
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,country,pic,coins)
            VALUES((SELECT COALESCE(MAX(public_no),10000000)+1 FROM sharika_users),?,?,?,?,?,?,2000)`)
            .bind(uid, name, body.birthdate, age < 18 ? 1 : 0, country, pic),
          env.DB.prepare(`INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
            VALUES(?,'coins',2000,2000,'signup_welcome',?)`)
            .bind(uid, 'signup:' + uid),
        ]);
        return reply(showProfile(await me(env.DB, uid)), 201, cors);
      }
      if (request.method === 'PATCH') {
        await assertActive(env.DB, uid);
        const body = await readBody(request);
        if (body.birthdate !== undefined || body.coins !== undefined || body.status !== undefined || body.diamonds !== undefined) return fail('protected_field', 403, cors);
        const changes = {};
        for (const [key, limit] of Object.entries({ name: 80, country: 16, pic: 2048, cover: 2048, bio: 500 })) {
          if (body[key] !== undefined) changes[key] = txt(body[key], limit) || (key === 'name' ? null : '');
        }
        if (!Object.keys(changes).length || changes.name === null) return fail('invalid_profile', 400, cors);
        const keys = Object.keys(changes);
        await env.DB.prepare('UPDATE sharika_users SET ' + keys.map(x => x + '=?').join(',') + `,updated_at=datetime('now') WHERE auth_uid=?`)
          .bind(...keys.map(k => changes[k]), uid).run();
        return reply(showProfile(await me(env.DB, uid)), 200, cors);
      }
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'users' && PUBLIC_ID.test(parts[3] || '') &&
        parts.length === 4 && request.method === 'GET') {
      await assertActive(env.DB, uid);
      const user = await env.DB.prepare('SELECT * FROM sharika_users WHERE public_no=?').bind(Number(parts[3])).first();
      return user ? reply({ id: publicId(user.public_no), name: user.name, pic: user.pic, country: user.country,
        wealth_level: user.wealth_level, charm_level: user.charm_level }, 200, cors)
        : fail('not_found', 404, cors);
    }
    if (path === '/api/v1/gifts' && request.method === 'GET') {
      await assertActive(env.DB, uid);
      const result = await env.DB.prepare(
        'SELECT id,name,emoji,tab,price_coins,image_url,animation_url ' +
        'FROM sharika_gifts WHERE active=1 ORDER BY id LIMIT 100'
      ).all();
      return reply({ gifts:result.results || [], read_only:true }, 200, cors);
    }
    if (path === '/api/v1/wallet' && request.method === 'GET') {
      const user = await assertActive(env.DB, uid);
      const rows = await env.DB.prepare(`SELECT id,currency,delta,balance_after,reason,created_at
        FROM sharika_wallet_ledger WHERE auth_uid=? ORDER BY id DESC LIMIT 40`).bind(uid).all();
      return reply({ coins: user.coins, diamonds: user.diamonds, xp: user.xp, ledger: rows.results || [] }, 200, cors);
    }
    if (path === '/api/v1/rooms') {
      await assertActive(env.DB, uid);
      if (request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM sharika_rooms ORDER BY created_at DESC LIMIT 100').all();
        return reply({ rooms: (rows.results || []).map(r => ({ ...r })) }, 200, cors);
      }
      if (request.method === 'POST') {
        const prior = await env.DB.prepare('SELECT * FROM sharika_rooms WHERE owner_id=?').bind(uid).first();
        if (prior) return reply(prior, 200, cors);
        const user = await assertActive(env.DB, uid);
        const data = await readBody(request);
        const name = txt(data.name, 100);
        if (!name) return fail('invalid_room_name', 400, cors);
        const seatCount = Number.isInteger(data.seat_count) && data.seat_count >= 1 && data.seat_count <= 20 ? data.seat_count : 12;
        const roomId = publicId(user.public_no);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO sharika_rooms(id,owner_id,name,emoji,theme,seat_count) VALUES(?,?,?,?,?,?)')
            .bind(roomId, uid, name, txt(data.emoji, 16) || '🎙️', txt(data.theme, 32) || 'mid', seatCount),
          env.DB.prepare(`INSERT INTO sharika_room_members(room_id,user_id,role) VALUES(?,?,'owner')`)
            .bind(roomId, uid),
        ]);
        return reply(await env.DB.prepare('SELECT * FROM sharika_rooms WHERE id=?').bind(roomId).first(), 201, cors);
      }
    }
    if (parts.length >= 5 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'rooms' && PUBLIC_ID.test(parts[3])) {
      await assertActive(env.DB, uid);
      const roomId = parts[3];
      const action = parts[4];
      const { room, member } = await roomAndMember(env.DB, roomId, uid);
      if (parts.length === 5 && action === 'join' && request.method === 'POST') {
        if (!member) {
          await env.DB.prepare(`INSERT OR IGNORE INTO sharika_room_members(room_id,user_id,role) VALUES(?,?,'member')`)
            .bind(roomId, uid).run();
        }
        const saved = await env.DB.prepare('SELECT * FROM sharika_room_members WHERE room_id=? AND user_id=?').bind(roomId,uid).first();
        return reply({ member: saved, owner: room.owner_id === uid }, 200, cors);
      }
      if (parts.length === 5 && action === 'leave' && request.method === 'POST') {
        if (room.owner_id === uid) {
          await env.DB.prepare('UPDATE sharika_room_members SET seat_no=NULL WHERE room_id=? AND user_id=?')
            .bind(roomId, uid).run();
        } else {
          await env.DB.prepare('DELETE FROM sharika_room_members WHERE room_id=? AND user_id=?').bind(roomId, uid).run();
        }
        return reply({ left: true, owner: room.owner_id === uid }, 200, cors);
      }
      if (!member) return fail('join_room_first', 403, cors);
      if (parts.length === 6 && action === 'voice')
        return await handleVoiceOperation({
          request, env, room, member, uid, roomId, operation:parts[5],
          reply, fail, cors, readBody
        });
      if (parts.length === 5 && action === 'seat' && request.method === 'PUT') {
        const body = await readBody(request);
        const seat = body.seat_no === null ? null : Number(body.seat_no);
        if (seat !== null && (!Number.isInteger(seat) || seat < 1 || seat > room.seat_count)) return fail('invalid_seat', 400, cors);
        await env.DB.prepare('UPDATE sharika_room_members SET seat_no=? WHERE room_id=? AND user_id=?').bind(seat,roomId,uid).run();
        const saved = await env.DB.prepare('SELECT * FROM sharika_room_members WHERE room_id=? AND user_id=?').bind(roomId,uid).first();
        return reply({ member: saved }, 200, cors);
      }
      if (parts.length === 5 && action === 'members' && request.method === 'GET') {
        const result = await env.DB.prepare(`SELECT m.room_id,m.user_id,m.role,m.seat_no,m.muted,
          u.public_no,u.name,u.pic,u.wealth_level FROM sharika_room_members m
          JOIN sharika_users u ON u.auth_uid=m.user_id WHERE m.room_id=? ORDER BY m.joined_at LIMIT 100`).bind(roomId).all();
        return reply({ room: roomId, members: (result.results || []).map(x => ({
          room_id: x.room_id, user_id: x.user_id, role: x.role, seat_no: x.seat_no, muted: !!x.muted,
          sharika_users: { public_id: publicId(x.public_no), name: x.name, pic: x.pic, wealth_level: x.wealth_level }
        })) }, 200, cors);
      }
      if (parts.length === 5 && action === 'voice-token' && request.method === 'POST') {
        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !/^wss:\/\//.test(env.LIVEKIT_URL || '')) {
          return fail('voice_not_configured', 503, cors);
        }
        const publish = member.seat_no !== null || room.owner_id === uid;
        const token = await createVoiceToken(env, uid, roomId, publish, room.owner_id === uid);
        return reply({ token, url: env.LIVEKIT_URL, room: 'sharika:' + roomId, publish }, 200, cors);
      }
    }
    // All financial, gift, game and admin mutations remain locked until ledger and role
    // migration is fully tested. Never pretend that a debit or payout succeeded.
    if (path.startsWith('/api/v1/')) return fail('migration_pending', 501, cors);
    return fail('not_found', 404, cors);
  } catch (error) {
    if (error instanceof SyntaxError) return fail('invalid_json', 400, cors);
    if (error.message === 'body_too_large' || error.message === 'invalid_body') return fail(error.message, 400, cors);
    if (error.message === 'profile_not_found' || error.message === 'room_not_found') return fail(error.message, 404, cors);
    if (error.message === 'profile_unavailable') return fail(error.message, 403, cors);
    if (error.message === 'sfu_upstream_unavailable' || error.message === 'sfu_track_unavailable')
      return fail(error.message, 502, cors);
    if (/SQLITE_CONSTRAINT|UNIQUE constraint|constraint failed/i.test(error.message || '')) return fail('conflict', 409, cors);
    console.error('sharika_stage_error', error.message);
    return fail('internal_error', 500, cors);
  }
}

export default { fetch: handleRequest };
export { publicId, ageFromDate };
