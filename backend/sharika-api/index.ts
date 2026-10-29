// Sharika API foundation for Supabase Edge Functions (Deno runtime).
// Additive: accesses only sharika_* tables; never modifies sovera_* or Earnbd data.
// No API secrets belong in the browser or in this source file.

const PROJECT_URL = Deno.env.get('SUPABASE_URL');
const SERVER_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const LK_KEY = Deno.env.get('SHARIKA_LIVEKIT_API_KEY');
const LK_SECRET = Deno.env.get('SHARIKA_LIVEKIT_API_SECRET');
const LK_URL = Deno.env.get('SHARIKA_LIVEKIT_URL');
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, idempotency-key',
  'cache-control': 'no-store',
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  });
}
function failure(code, status = 400) { return response({ error: code }, status); }
function requireText(x, max) {
  return typeof x === 'string' ? x.trim().slice(0, max) : '';
}
function uuid(x) {
  return typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function eightDigit(x) { return typeof x === 'string' && /^\d{8}$/.test(x); }
const safeDbMessages = new Set([
  'invalid_wallet_request', 'user_unavailable', 'insufficient_balance_or_overflow',
  'invalid_gift_request', 'sender_unavailable', 'invalid_recipients',
  'recipient_unavailable', 'gift_unavailable', 'gift_cost_overflow',
  'insufficient_coins', 'room_not_found', 'sender_not_in_room',
  'recipient_not_in_room', 'lucky_gifts_disabled_for_minors',
  'lucky_gifts_disabled', 'too_many_lucky_draws', 'invalid_lucky_configuration',
  'lucky_payout_overflow', 'xp_overflow', 'balance_overflow',
  'invalid_claim', 'not_room_owner', 'owner_unavailable', 'no_room_reward',
  'room_rewards_disabled', 'invalid_reward_configuration', 'claim_not_ready',
  'invalid_daily_request', 'invalid_exchange', 'insufficient_diamonds',
  'invalid_recharge', 'recharge_not_found', 'admin_forbidden',
]);

async function requestDb(table, method = 'GET', params = '', body, preference = 'return=representation') {
  const target = new URL(`${PROJECT_URL}/rest/v1/${table}`);
  if (params) target.search = params;
  const r = await fetch(target, {
    method,
    headers: {
      apikey: SERVER_KEY,
      authorization: `Bearer ${SERVER_KEY}`,
      'content-type': 'application/json',
      prefer: preference,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* ignored */ }
  if (!r.ok) {
    console.error(`Sharika database ${table}: ${r.status} ${data?.code || ''}`);
    if (safeDbMessages.has(data?.message)) throw new Error(data.message);
    throw new Error(r.status === 409 ? 'conflict' : 'database_unavailable');
  }
  return data;
}

async function getIdentity(req) {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const jwt = header.slice(7).trim();
  if (!jwt || jwt === SERVER_KEY) return null;
  const r = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: SERVER_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return uuid(u.id) ? u : null;
}

async function getMe(userId) {
  const rows = await requestDb('sharika_users', 'GET', `user_id=eq.${userId}&select=*`);
  return rows?.[0] || null;
}

function profilePublic(x) {
  if (!x) return null;
  return {
    id: x.public_id, name: x.name, pic: x.pic, cover: x.cover,
    bio: x.bio, country: x.country, wealth_level: x.wealth_level,
    charm_level: x.charm_level, frame: x.frame, frame_img: x.frame_img,
    svip_until: x.svip_until,
  };
}

function accountData(body, isNew = false) {
  const out = {};
  if (body.name !== undefined) {
    const name = requireText(body.name, 80);
    if (!name) throw new Error('invalid_name');
    out.name = name;
  }
  for (const key of ['pic', 'cover', 'bio', 'country']) {
    if (body[key] !== undefined) out[key] = body[key] === null ? null : requireText(body[key], key === 'bio' ? 500 : 2048);
  }
  if (body.birthdate !== undefined) {
    if (!isNew) throw new Error('birthdate_locked');
    const s = requireText(body.birthdate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error('invalid_birthdate');
    const d = new Date(`${s}T00:00:00Z`);
    const now = new Date();
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
    if (age < 13 || age > 120) throw new Error('invalid_birthdate');
    out.birthdate = s;
    out.minor = age < 18;
  }
  if (isNew && !out.name) out.name = 'Sharika User';
  return out;
}

function base64Url(raw) {
  const bytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(raw);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function liveKitToken(userId, roomId, canPublish, isOwner) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = {
    iss: LK_KEY, sub: `sharika:${userId}`, iat: now, nbf: now - 5, exp: now + 600,
    video: {
      room: `sharika:${roomId}`, roomJoin: true,
      canPublish: !!canPublish, canSubscribe: true, canPublishData: true,
      ...(canPublish ? { canPublishSources: ['microphone'] } : {}),
      ...(isOwner ? { roomAdmin: true } : {}),
    },
  };
  const body = base64Url(JSON.stringify(claims));
  const encoded = `${head}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(LK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64Url(new Uint8Array(signature))}`;
}

async function parseBody(req) {
  const text = await req.text();
  if (text.length > 20000) throw new Error('body_too_large');
  if (!text) return {};
  const data = JSON.parse(text);
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('invalid_body');
  return data;
}

async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!PROJECT_URL || !SERVER_KEY) return failure('server_not_configured', 503);
  const actor = await getIdentity(req);
  if (!actor) return failure('not_authenticated', 401);
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*?\/sharika-api/, '') || '/';
  const parts = route.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && route === '/health') return response({ ok: true, service: 'sharika-api' });

    if (route === '/me') {
      if (req.method === 'GET') {
        const me = await getMe(actor.id);
        return me ? response(me) : failure('profile_not_found', 404);
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const input = accountData(await parseBody(req), req.method === 'POST');
        const found = await getMe(actor.id);
        if (req.method === 'POST' && !found) {
          if (!input.birthdate) return failure('birthdate_required');
          const profile = await requestDb('rpc/sharika_register_profile', 'POST', '', {
            p_user_id: actor.id, p_name: input.name,
            p_birthdate: input.birthdate, p_country: input.country || '',
            p_pic: input.pic || null,
          });
          return response(profile, 201);
        }
        if (req.method === 'POST') return failure('profile_exists', 409);
        if (!found) return failure('profile_not_found', 404);
        const rows = await requestDb('sharika_users', 'PATCH', `user_id=eq.${actor.id}`, input);
        return response(rows?.[0]);
      }
    }

    if (req.method === 'GET' && parts[0] === 'users' && parts.length === 2 && eightDigit(parts[1])) {
      const rows = await requestDb('sharika_users', 'GET', `public_id=eq.${parts[1]}&select=*`);
      return rows?.length ? response(profilePublic(rows[0])) : failure('not_found', 404);
    }

    if (parts[0] === 'rooms' && parts.length === 1) {
      if (req.method === 'GET') {
        const rooms = await requestDb('sharika_rooms', 'GET', 'select=*&order=created_at.desc&limit=100');
        return response({ rooms });
      }
      if (req.method === 'POST') {
        const me = await getMe(actor.id);
        if (!me || me.status !== 'active') return failure('profile_unavailable', 403);
        const old = await requestDb('sharika_rooms', 'GET', `owner_id=eq.${actor.id}&select=*`);
        if (old?.length) return response(old[0]);
        const body = await parseBody(req);
        const name = requireText(body.name, 100);
        if (!name) return failure('invalid_room_name');
        const room = await requestDb('sharika_rooms', 'POST', '', {
          id: me.public_id, owner_id: actor.id, name,
          emoji: requireText(body.emoji, 16) || '🎙️',
          theme: requireText(body.theme, 32) || 'mid',
          seat_count: Number.isInteger(body.seat_count) && body.seat_count >= 1 && body.seat_count <= 20 ? body.seat_count : 12,
        });
        await requestDb('sharika_room_members', 'POST', '?on_conflict=room_id,user_id', {
          room_id: me.public_id, user_id: actor.id, role: 'owner', seat_no: null,
        }, 'resolution=merge-duplicates,return=representation');
        return response(room?.[0], 201);
      }
    }

    if (parts[0] === 'rooms' && eightDigit(parts[1]) && parts.length >= 3) {
      const roomId = parts[1];
      const rooms = await requestDb('sharika_rooms', 'GET', `id=eq.${roomId}&select=*`);
      const room = rooms?.[0];
      if (!room) return failure('room_not_found', 404);
      const memberQuery = `room_id=eq.${roomId}&user_id=eq.${actor.id}&select=*`;
      let members = await requestDb('sharika_room_members', 'GET', memberQuery);
      let member = members?.[0];
      if (parts[2] === 'join' && req.method === 'POST') {
        const me = await getMe(actor.id);
        if (!me || me.status !== 'active') return failure('profile_unavailable', 403);
        const expectedRole = room.owner_id === actor.id ? 'owner' : 'member';
        if (!member) {
          const rows = await requestDb('sharika_room_members', 'POST', '', {
            room_id: roomId, user_id: actor.id, role: expectedRole,
          });
          member = rows?.[0];
        }
        return response({ member, owner: room.owner_id === actor.id });
      }
      // Leaving a room must release the caller's membership and microphone seat.
      // The owner keeps the room's permanent owner record and seat zero.
      if (parts[2] === 'leave' && parts.length === 3 && req.method === 'POST') {
        if (!member) return response({ left: true, owner: room.owner_id === actor.id });
        if (room.owner_id === actor.id) {
          if (member.seat_no !== null) {
            await requestDb('sharika_room_members', 'PATCH',
              `room_id=eq.${roomId}&user_id=eq.${actor.id}`, { seat_no: null });
          }
        } else {
          await requestDb('sharika_room_members', 'DELETE',
            `room_id=eq.${roomId}&user_id=eq.${actor.id}`);
        }
        return response({ left: true, owner: room.owner_id === actor.id });
      }
      if (parts[2] === 'seat' && req.method === 'PUT') {
        if (!member) return failure('join_room_first', 403);
        const data = await parseBody(req);
        const seat = data.seat_no === null ? null : Number(data.seat_no);
        if (seat !== null && (!Number.isInteger(seat) || seat < 1 || seat > room.seat_count)) return failure('invalid_seat');
        const rows = await requestDb('sharika_room_members', 'PATCH', `room_id=eq.${roomId}&user_id=eq.${actor.id}`, { seat_no: seat });
        return response({ member: rows?.[0] });
      }
      if (parts[2] === 'members' && req.method === 'GET') {
        if (!member) return failure('join_room_first', 403);
        const all = await requestDb('sharika_room_members', 'GET', `room_id=eq.${roomId}&select=role,seat_no,muted,user_id,sharika_users(public_id,name,pic,wealth_level)`);
        return response({ room: roomId, members: all });
      }
      if (parts[2] === 'gift' && parts.length === 3 && req.method === 'POST') {
        if (!member) return failure('join_room_first', 403);
        const body = await parseBody(req);
        const requestId = body.request_id || req.headers.get('idempotency-key');
        const recipientIds = body.recipient_ids;
        if (!uuid(requestId) || !Array.isArray(recipientIds) || !recipientIds.length || recipientIds.length > 20 ||
          !recipientIds.every(eightDigit) || new Set(recipientIds).size !== recipientIds.length ||
          !Number.isSafeInteger(body.gift_id) || body.gift_id < 1 ||
          !Number.isSafeInteger(body.qty) || body.qty < 1 || body.qty > 10000) {
          return failure('invalid_gift_request');
        }
        const profiles = await requestDb('sharika_users', 'GET', `public_id=in.(${recipientIds.join(',')})&select=public_id,user_id`);
        if (profiles.length !== recipientIds.length) return failure('recipient_unavailable', 404);
        const result = await requestDb('rpc/sharika_send_gift', 'POST', '', {
          p_sender: actor.id, p_recipients: profiles.map(x => x.user_id),
          p_gift_id: body.gift_id, p_qty: body.qty,
          p_room_id: roomId, p_request_id: requestId,
        });
        return response(result);
      }
      if (parts[2] === 'reward' && parts.length === 3 && req.method === 'GET') {
        if (room.owner_id !== actor.id) return failure('not_room_owner', 403);
        const [states,configRows] = await Promise.all([
          requestDb('sharika_room_rewards','GET',`room_id=eq.${roomId}&select=gift_volume_since_claim,last_claim_at`),
          requestDb('sharika_admin_kv','GET','key=eq.rr&select=value'),
        ]);
        const cfg = configRows?.[0]?.value || {};
        const pct = Number.isFinite(Number(cfg.pct)) ? Number(cfg.pct) : 10;
        const days = Number.isInteger(Number(cfg.days)) && Number(cfg.days) > 0 ? Number(cfg.days) : 7;
        const minimum = Number.isFinite(Number(cfg.minp)) ? Number(cfg.minp) : 0;
        const volume = Number(states?.[0]?.gift_volume_since_claim || 0);
        const lastClaim = states?.[0]?.last_claim_at || null;
        const reward = Math.floor(volume * pct / 100);
        return response({ volume, last_claim_at: lastClaim, pct, days, minimum,
          reward, claimable: cfg.on !== false && reward > 0 && reward >= minimum &&
            (!lastClaim || Date.now() >= new Date(lastClaim).getTime() + days * 86400000),
        });
      }
      if (parts[2] === 'reward' && parts[3] === 'claim' && parts.length === 4 && req.method === 'POST') {
        if (room.owner_id !== actor.id) return failure('not_room_owner', 403);
        const body = await parseBody(req);
        const requestId = body.request_id || req.headers.get('idempotency-key');
        if (!uuid(requestId)) return failure('invalid_claim');
        const result = await requestDb('rpc/sharika_claim_room_reward', 'POST', '', {
          p_owner: actor.id, p_room_id: roomId, p_request_id: requestId,
        });
        return response(result);
      }
      if (parts[2] === 'voice-token' && req.method === 'POST') {
        if (!member) return failure('join_room_first', 403);
        if (!LK_KEY || !LK_SECRET || !LK_URL) return failure('voice_not_configured', 503);
        const me = await getMe(actor.id);
        if (!me || me.status !== 'active') return failure('profile_unavailable', 403);
        const canPublish = member.seat_no !== null || room.owner_id === actor.id;
        const token = await liveKitToken(actor.id, roomId, canPublish, room.owner_id === actor.id);
        return response({ token, url: LK_URL, room: `sharika:${roomId}`, publish: canPublish });
      }
    }

    if (req.method === 'GET' && route === '/wallet') {
      const me = await getMe(actor.id);
      if (!me) return failure('profile_not_found', 404);
      const ledger = await requestDb('sharika_wallet_ledger', 'GET', `user_id=eq.${actor.id}&select=id,currency,delta,balance_after,reason,created_at&order=created_at.desc&limit=40`);
      return response({ coins: me.coins, diamonds: me.diamonds, xp: me.xp, ledger });
    }

    if (route === '/daily') {
      if (req.method === 'GET') {
        const rows = await requestDb('sharika_daily_claims', 'GET', `user_id=eq.${actor.id}&select=claim_day,streak,coins,claimed_at&order=claim_day.desc&limit=1`);
        return response({ last: rows?.[0] || null });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const requestId = body.request_id || req.headers.get('idempotency-key');
        if (!uuid(requestId)) return failure('invalid_daily_request');
        const result = await requestDb('rpc/sharika_daily_checkin','POST','',{
          p_user_id: actor.id, p_request_id: requestId,
        });
        return response(result);
      }
    }
    if (route === '/exchange' && req.method === 'POST') {
      const body = await parseBody(req);
      const requestId = body.request_id || req.headers.get('idempotency-key');
      if (!uuid(requestId) || ![500,1000,5000,20000].includes(body.diamonds)) return failure('invalid_exchange');
      const result = await requestDb('rpc/sharika_exchange_diamonds','POST','',{
        p_user_id: actor.id, p_diamonds: body.diamonds, p_request_id: requestId,
      });
      return response(result);
    }
    if (route === '/recharge-requests') {
      if (req.method === 'GET') {
        const requests = await requestDb('sharika_recharge_requests','GET',`user_id=eq.${actor.id}&select=id,coins,status,created_at,reviewed_at&order=created_at.desc&limit=40`);
        return response({ requests });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const requestId = body.request_id || req.headers.get('idempotency-key');
        if (!uuid(requestId) || !Number.isSafeInteger(body.coins) || body.coins < 1 || body.coins > 1000000000) return failure('invalid_recharge');
        const result = await requestDb('rpc/sharika_recharge_request','POST','',{
          p_user_id: actor.id, p_coins: body.coins, p_request_id: requestId,
        });
        return response(result, 202);
      }
    }

    if (req.method === 'GET' && route === '/config') {
      const safeKeys = ['rk','flags','winb','room','weekly','store','levels','lucky','rr'];
      const kv = await requestDb('sharika_admin_kv', 'GET', `key=in.(${safeKeys.join(',')})&select=key,value`);
      const config = Object.fromEntries((kv || []).map(x => [x.key, x.value]));
      const [gifts,frames,medals] = await Promise.all([
        requestDb('sharika_gifts','GET','active=eq.true&select=id,name,emoji,tab,price_coins,image_url,animation_url&order=id.asc'),
        requestDb('sharika_frames','GET','active=eq.true&select=id,name,style,img,price'),
        requestDb('sharika_medals','GET','active=eq.true&select=id,name,description,image_url'),
      ]);
      return response({ kv: config, gifts, frames, medals });
    }

    if (req.method === 'GET' && route === '/rewards/weekly') {
      const claims = await requestDb('sharika_weekly_claims','GET',`user_id=eq.${actor.id}&select=*&order=week_start.desc&limit=12`);
      return response({ claims });
    }
    if (req.method === 'GET' && route === '/rank') {
      const cat = url.searchParams.get('category') || 'recharge';
      if (!['recharge','couple','room'].includes(cat)) return failure('invalid_category');
      const rows = await requestDb('sharika_weekly_rankings','GET',`category=eq.${cat}&select=*&order=week_start.desc,rank.asc&limit=50`);
      return response({ rankings: rows });
    }

    if (parts[0] === 'admin') {
      const roles = await requestDb('sharika_admin_users', 'GET', `user_id=eq.${actor.id}&select=role`);
      const role = roles?.[0]?.role;
      if (!role) return failure('admin_forbidden', 403);
      if (req.method === 'GET' && route === '/admin/status') return response({ role });
      if (req.method === 'GET' && route === '/admin/users') {
        const users = await requestDb('sharika_users','GET','select=user_id,public_id,name,country,coins,diamonds,wealth_level,status,minor&order=created_at.desc&limit=300');
        return response({ users });
      }
      if (req.method === 'GET' && route === '/admin/rooms') {
        const rooms = await requestDb('sharika_rooms','GET','select=*&order=created_at.desc&limit=300');
        return response({ rooms });
      }
      if (route === '/admin/gifts') {
        if (req.method === 'GET') {
          const gifts = await requestDb('sharika_gifts','GET','select=id,name,emoji,tab,price_coins,image_url,animation_url,active&order=id.asc&limit=200');
          return response({ gifts });
        }
        if (req.method === 'POST') {
          if (role !== 'super') return failure('admin_forbidden', 403);
          const data = await parseBody(req);
          const name = requireText(data.name,80);
          const emoji = requireText(data.emoji,8) || '🎁';
          if (!name || !Number.isSafeInteger(data.price_coins) || data.price_coins < 1 || data.price_coins > 1000000000 ||
            ![0,1,2].includes(data.tab)) return failure('invalid_gift');
          const rows = await requestDb('sharika_gifts','POST','',{
            name,emoji,tab:data.tab,price_coins:data.price_coins,active:true,
          });
          await requestDb('sharika_admin_audit','POST','',{
            actor_id:actor.id,action:'gift_create',details:{id:rows?.[0]?.id,name},
          },'return=minimal');
          return response(rows?.[0],201);
        }
      }
      if (parts[1] === 'gifts' && parts.length === 3 && req.method === 'PATCH') {
        if (role !== 'super') return failure('admin_forbidden', 403);
        const id = Number(parts[2]);
        const data = await parseBody(req);
        if (!Number.isSafeInteger(id) || id < 1) return failure('invalid_gift');
        const changes = {};
        if (typeof data.active === 'boolean') changes.active = data.active;
        if (Number.isSafeInteger(data.price_coins) && data.price_coins > 0 && data.price_coins <= 1000000000) changes.price_coins = data.price_coins;
        if (!Object.keys(changes).length) return failure('invalid_gift');
        const rows = await requestDb('sharika_gifts','PATCH',`id=eq.${id}`,changes);
        if (!rows?.length) return failure('gift_unavailable',404);
        await requestDb('sharika_admin_audit','POST','',{
          actor_id:actor.id,action:'gift_update',details:{id,changes},
        },'return=minimal');
        return response(rows[0]);
      }
      if (req.method === 'GET' && route === '/admin/audit') {
        if (role !== 'super') return failure('admin_forbidden', 403);
        const audit = await requestDb('sharika_admin_audit','GET','select=actor_id,action,details,created_at&order=created_at.desc&limit=100');
        return response({ audit });
      }
      if (parts[1] === 'users' && parts.length === 4 && eightDigit(parts[2]) && req.method === 'POST' && parts[3] === 'wallet') {
        if (!['super','finance'].includes(role)) return failure('admin_forbidden', 403);
        const data = await parseBody(req);
        const delta = data.delta;
        const reason = requireText(data.reason, 140);
        const requestId = data.request_id || req.headers.get('idempotency-key');
        if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000 || reason.length < 4 || !uuid(requestId)) {
          return failure('invalid_wallet_adjustment');
        }
        const targets = await requestDb('sharika_users','GET',`public_id=eq.${parts[2]}&select=user_id`);
        if (!targets?.length) return failure('user_not_found', 404);
        const balance = await requestDb('rpc/sharika_wallet_delta','POST','',{
          p_user_id: targets[0].user_id,p_currency: 'coins',p_delta:delta,
          p_reason:`admin:${reason}`,p_ref_id:actor.id,p_request_id:requestId,
        });
        await requestDb('sharika_admin_audit','POST','',{
          actor_id: actor.id,action:'wallet_adjust',
          details: { target:parts[2],delta,reason,request_id:requestId },
        },'return=minimal');
        return response({ balance });
      }
      if (parts[1] === 'users' && parts.length === 4 && eightDigit(parts[2]) && req.method === 'PATCH' && parts[3] === 'status') {
        if (!['super','support'].includes(role)) return failure('admin_forbidden', 403);
        const data = await parseBody(req);
        const reason = requireText(data.reason, 140);
        if (!['active','blocked'].includes(data.status) || reason.length < 4) return failure('invalid_user_status');
        const targets = await requestDb('sharika_users','GET',`public_id=eq.${parts[2]}&select=user_id`);
        if (!targets?.length) return failure('user_not_found', 404);
        if (targets[0].user_id === actor.id) return failure('cannot_block_self', 403);
        const rows = await requestDb('sharika_users','PATCH',`user_id=eq.${targets[0].user_id}`,{status:data.status,updated_at:new Date().toISOString()});
        await requestDb('sharika_admin_audit','POST','',{
          actor_id:actor.id,action:'user_status',details:{target:parts[2],status:data.status,reason},
        },'return=minimal');
        return response({ user: rows?.[0]?.public_id, status:data.status });
      }
      if (req.method === 'GET' && route === '/admin/recharge-requests') {
        if (!['super','finance'].includes(role)) return failure('admin_forbidden', 403);
        const rows = await requestDb('sharika_recharge_requests','GET','status=eq.pending&select=id,user_id,coins,created_at&order=created_at.asc&limit=100');
        return response({ requests: rows });
      }
      if (req.method === 'POST' && parts[1] === 'recharge-requests' && parts.length === 4 && parts[3] === 'review') {
        if (!['super','finance'].includes(role)) return failure('admin_forbidden', 403);
        const rechargeId = Number(parts[2]);
        const body = await parseBody(req);
        if (!Number.isSafeInteger(rechargeId) || rechargeId < 1 || typeof body.approve !== 'boolean') return failure('invalid_recharge');
        const result = await requestDb('rpc/sharika_review_recharge','POST','',{
          p_actor: actor.id, p_recharge_id: rechargeId, p_approve: body.approve,
        });
        return response(result);
      }
      if (req.method === 'GET' && route === '/admin/config') {
        const rows = await requestDb('sharika_admin_kv','GET','select=key,value&order=key.asc');
        return response({ role, kv: Object.fromEntries((rows || []).map(x => [x.key,x.value])) });
      }
      if (req.method === 'PUT' && parts[1] === 'kv' && parts.length === 3) {
        if (role !== 'super') return failure('admin_forbidden', 403);
        const key = parts[2];
        if (!/^[a-z][a-z0-9_]{0,40}$/i.test(key)) return failure('invalid_key');
        const data = await parseBody(req);
        if (!Object.hasOwn(data,'value')) return failure('value_required');
        await requestDb('sharika_admin_kv','POST','on_conflict=key',{key,value:data.value,updated_at:new Date().toISOString()},'resolution=merge-duplicates,return=representation');
        await requestDb('sharika_admin_audit','POST','',{actor_id:actor.id,action:`kv:${key}`,details:{key}},'return=minimal');
        return response({ saved: true });
      }
    }
    return failure('not_found', 404);
  } catch (e) {
    if (['invalid_name','invalid_birthdate','birthdate_locked','body_too_large','invalid_body'].includes(e.message)) return failure(e.message);
    if (safeDbMessages.has(e.message)) {
      const status = ['insufficient_coins','insufficient_balance_or_overflow','claim_not_ready','insufficient_diamonds'].includes(e.message) ? 409 :
        ['not_room_owner','sender_not_in_room','recipient_not_in_room','lucky_gifts_disabled_for_minors'].includes(e.message) ? 403 : 400;
      return failure(e.message, status);
    }
    if (e.message === 'conflict') return failure('conflict', 409);
    if (e instanceof SyntaxError) return failure('invalid_json');
    console.error('Sharika request failed:', e.message);
    return failure('internal_error', 500);
  }
}

Deno.serve(handler);
