import { verifyFirebaseToken } from './auth.mjs';
import { handleVoiceOperation } from './sfu.mjs';
import { handleRoomModeration } from './moderation.mjs';
import { handleSellerApp } from './sellers.mjs';
import { listPublicBanners } from './banners.mjs';
import { handleDailyApp } from './daily.mjs';
import { handleEventApp } from './events.mjs';
import { handleInviteApp, resolveInviter, signupCoins, signupReferralStatements } from './invites.mjs';
import { handleAdminOperation, readGiftRankings } from './admin.mjs';
import { handleGameRequest, settleDueBets } from './games.mjs';
import {handleOriginalGameRequest,settleOriginalDueBets} from './original-games.mjs';
import {handleGreedyRequest,settleGreedyDueBets} from './greedy-wheel.mjs';
import {readExchangeRate,respondRate,exchangeCredit} from './exchange-rate.mjs';
import {readEquipped,readRoomEquipped,handleCosmeticApp} from './cosmetics.mjs';
import { drawLuckyGift, luckyGiftBenefits, nonRedeemableLuckyEconomy, LUCKY_ODDS } from './lucky-gifts.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const PUBLIC_ID = /^[0-9]{8}$/;
const ROOM_THEMES = new Set(['mid','gold','ocean','rose','forest','sunset','photo']);
const ROOM_SEAT_FRAMES = new Set(['grad','gold','neon','sq']);
const MAX_BODY = 20_000;
const PROFILE_FRAMES = new Set([
  '', 'phoenix-fire', 'ice-wings', 'royal-dragon', 'vip7',
  'royal-gold', 'violet-love', 'ice-admin', 'golden-dragon',
  'ice-dragon', 'violet-phoenix', 'castle-flag',
  'lion-queen', 'phoenix-queen', 'tiger-queen'
]);
const PROFILE_MEDALS = new Set(['', 'bronze', 'silver', 'gold', 'top-host']);
const PROFILE_NAME_TAGS = new Set(['', 'legend']);
const PROFILE_ENTRIES = new Set([
  '', 'phoenix', 'dragon-queen', 'ice-king', 'castle-flag',
  'lion-queen', 'phoenix-queen', 'tiger-queen'
]);
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
    frame_style: user.frame_style || '', entry_style: user.entry_style || '',
    medal_style: user.medal_style || '', name_tag_style: user.name_tag_style || '',
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
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
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
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const coverPath=/^\/api\/v1\/rooms\/([0-9]{8})\/cover$/.exec(path);
  const avatarPath=/^\/api\/v1\/users\/([0-9]{8})\/avatar$/.exec(path);
  // Public image thumbnails support anonymous GET; edits remain authenticated.
  // all mutations continue through strict origin and Firebase checks.
  const cors = (coverPath || avatarPath) && request.method==='GET'
    ? {'access-control-allow-origin':'*'} : corsFor(request, env);
  if (!cors) return fail('origin_forbidden', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // The image is a public room-card asset; mutation is owner-authenticated
  // further below. No Firebase tokens or profile data are exposed here.
  if(coverPath && request.method==='GET') {
    if(!env.DB)return fail('database_unavailable',503,cors);
    const image=await env.DB.prepare(
      'SELECT mime,image_base64,version FROM sharika_room_covers WHERE room_id=?'
    ).bind(coverPath[1]).first();
    if(!image)return fail('room_cover_not_found',404,cors);
    const binary=atob(image.image_base64);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return new Response(bytes,{status:200,headers:{
      'content-type':'image/jpeg','cache-control':'public, max-age=3600',
      'x-content-type-options':'nosniff',...cors
    }});
  }
  if(avatarPath && request.method==='GET') {
    if(!env.DB)return fail('database_unavailable',503,cors);
    const image=await env.DB.prepare(
      'SELECT a.image_base64 FROM sharika_user_avatars a '+
      'JOIN sharika_users u ON u.auth_uid=a.auth_uid WHERE u.public_no=? AND u.status=?'
    ).bind(Number(avatarPath[1]),'active').first();
    if(!image)return fail('avatar_not_found',404,cors);
    const bytes=Uint8Array.from(atob(image.image_base64),c=>c.charCodeAt(0));
    return new Response(bytes,{status:200,headers:{
      'content-type':'image/jpeg','cache-control':'public, max-age=3600',
      'x-content-type-options':'nosniff',...cors
    }});
  }
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
    if(path==='/api/v1/cosmetics'||path.startsWith('/api/v1/cosmetics/')){
      await assertActive(env.DB,uid);
      const result=await handleCosmeticApp({
        request,db:env.DB,uid,path,readBody,reply,fail,cors
      });
      if(result)return result;
      return fail('cosmetic_route_not_found',404,cors);
    }
    if(path==='/api/v1/events') return await handleEventApp({
      request,env,uid,path,cors,reply,fail
    });
    if (path.startsWith('/api/v1/admin/')) return await handleAdminOperation({
      request, env, uid, path, cors, reply, fail
    });
    if (path==='/api/v1/invites') return await handleInviteApp({
      request, env, uid, path, cors, reply, fail
    });
    if (path==='/api/v1/daily' || path==='/api/v1/daily/check-in' ||
        path==='/api/v1/daily/tasks/claim') return await handleDailyApp({
      request, env, uid, path, cors, reply, fail
    });
    if (path.startsWith('/api/v1/sellers')) return await handleSellerApp({
      request, env, uid, path, cors, reply, fail
    });
    // Authenticated presence is independent of microphone permission. This
    // allows the admin panel to count listeners as well as speakers.
    if (path === '/api/v1/presence/heartbeat' && request.method === 'POST') {
      await assertActive(env.DB,uid);
      if(!env.VOICE_ROOMS)return fail('presence_unavailable',503,cors);
      const body=await readBody(request);
      const roomId=body.room_id==null ? null : body.room_id;
      if(roomId!==null) {
        if(typeof roomId!=='string'||!PUBLIC_ID.test(roomId))
          return fail('invalid_presence_room',400,cors);
        const {member}=await roomAndMember(env.DB,roomId,uid);
        if(!member)return fail('join_room_first',403,cors);
      }
      const coordinator=env.VOICE_ROOMS.getByName('sharika:presence:staging');
      await coordinator.presenceTouch(uid,roomId);
      return reply({ok:true,window_seconds:90},200,cors);
    }
    if(path === '/api/v1/me/avatar' && request.method==='PUT') {
      const user=await assertActive(env.DB,uid);
      const len=Number(request.headers.get('content-length')||0);
      if(len>125000)return fail('avatar_too_large',413,cors);
      const raw=await request.text();
      if(raw.length>125000)return fail('avatar_too_large',413,cors);
      let body;
      try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_avatar',400,cors);}
      if(!body||typeof body!=='object'||Array.isArray(body)||
         typeof body.image_data!=='string'||!body.image_data.startsWith('data:image/jpeg;base64,'))
        return fail('invalid_avatar',400,cors);
      const imageBase64=body.image_data.slice('data:image/jpeg;base64,'.length);
      if(imageBase64.length<16||imageBase64.length>120000||
         !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))
        return fail('invalid_avatar',400,cors);
      let binary;
      try{binary=atob(imageBase64);}catch(_){return fail('invalid_avatar',400,cors);}
      if(binary.length<32||binary.length>90000||
         binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216||
         binary.charCodeAt(2)!==255||
         binary.charCodeAt(binary.length-2)!==255||
         binary.charCodeAt(binary.length-1)!==217)
        return fail('invalid_avatar',400,cors);
      // Commit the image and its profile URL together. If either write fails,
      // D1 rolls back the batch, so users do not get an uploaded-but-unsaved photo.
      const picPrefix=url.origin+'/api/v1/users/'+publicId(user.public_no)+'/avatar?v=';
      const writes=await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO sharika_user_avatars(auth_uid,mime,image_base64,image_bytes) '+
          "VALUES(?,'image/jpeg',?,?) ON CONFLICT(auth_uid) DO UPDATE SET "+
          'image_base64=excluded.image_base64,image_bytes=excluded.image_bytes,'+
          "version=MIN(sharika_user_avatars.version+1,1000000000),updated_at=datetime('now') "+
          "WHERE sharika_user_avatars.updated_at<=datetime('now','-20 seconds')"
        ).bind(uid,imageBase64,binary.length),
        env.DB.prepare(
          "UPDATE sharika_users SET pic=? || "+
          "(SELECT CAST(version AS TEXT) FROM sharika_user_avatars WHERE auth_uid=?),"+
          "updated_at=datetime('now') WHERE auth_uid=? AND status='active'"
        ).bind(picPrefix,uid,uid)
      ]);
      if(!writes[0]?.meta?.changes)return fail('avatar_rate_limited',429,cors);
      if(!writes[1]?.meta?.changes)return fail('profile_unavailable',409,cors);
      return reply(showProfile(await me(env.DB,uid)),200,cors);
    }
    if(path==='/api/v1/banners' && request.method==='GET') {
      await assertActive(env.DB,uid);
      return reply({banners:await listPublicBanners(env.DB)},200,cors);
    }
    if (path === '/api/v1/me') {
      if (request.method === 'GET') {
        const user = await me(env.DB, uid);
        return user ? reply({...showProfile(user),...await readEquipped(env.DB,uid)},200,cors) : fail('profile_not_found',404,cors);
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
        // A referral may only be attributed at initial account registration.
        const referral=await resolveInviter({
          db:env.DB,uid,inviteCode:body.invite_code,fail,cors
        });
        if(referral.error)return referral.error;
        const welcomeCoins=signupCoins(!!referral.inviter);
        const registration=[
          env.DB.prepare(`INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,country,pic,coins)
            VALUES((SELECT COALESCE(MAX(public_no),10000000)+1 FROM sharika_users),?,?,?,?,?,?,?)`)
            .bind(uid,name,body.birthdate,age<18?1:0,country,pic,welcomeCoins),
          env.DB.prepare(`INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
            VALUES(?,'coins',?,?,?,?)`)
            .bind(uid,welcomeCoins,welcomeCoins,referral.inviter?'signup_invited':'signup_welcome','signup:'+uid)
        ];
        if(referral.inviter)registration.push(...signupReferralStatements({
          db:env.DB,uid,inviterUid:referral.inviter.auth_uid
        }));
        await env.DB.batch(registration);
        return reply(showProfile(await me(env.DB, uid)), 201, cors);
      }
      if (request.method === 'PATCH') {
        await assertActive(env.DB, uid);
        const body = await readBody(request);
        if (body.birthdate !== undefined || body.coins !== undefined || body.status !== undefined || body.diamonds !== undefined || body.public_no !== undefined || body.auth_uid !== undefined) return fail('protected_field', 403, cors);
        // Cosmetics now require verified inventory; old APKs cannot unlock any
        // style by patching the public profile fields directly.
        if(['frame_style','entry_style','medal_style','name_tag_style'].some(k=>body[k]!==undefined))
          return fail('cosmetic_purchase_or_grant_required',403,cors);
        const changes = {};
        for (const [key, limit] of Object.entries({ name: 80, country: 16, pic: 2048, cover: 2048, bio: 500 })) {
          if (body[key] !== undefined) changes[key] = txt(body[key], limit) || (key === 'name' ? null : '');
        }
        if (body.frame_style !== undefined) {
          if (typeof body.frame_style !== 'string' || !PROFILE_FRAMES.has(body.frame_style))
            return fail('invalid_frame_style', 400, cors);
          changes.frame_style = body.frame_style;
        }
        if (body.entry_style !== undefined) {
          if (typeof body.entry_style !== 'string' || !PROFILE_ENTRIES.has(body.entry_style))
            return fail('invalid_entry_style', 400, cors);
          changes.entry_style = body.entry_style;
        }
        if (body.medal_style !== undefined) {
          if (typeof body.medal_style !== 'string' || !PROFILE_MEDALS.has(body.medal_style))
            return fail('invalid_medal_style', 400, cors);
          changes.medal_style = body.medal_style;
        }
        if (body.name_tag_style !== undefined) {
          if (typeof body.name_tag_style !== 'string' || !PROFILE_NAME_TAGS.has(body.name_tag_style))
            return fail('invalid_name_tag_style', 400, cors);
          changes.name_tag_style = body.name_tag_style;
        }
        if (!Object.keys(changes).length || changes.name === null) return fail('invalid_profile', 400, cors);
        const keys = Object.keys(changes);
        await env.DB.prepare('UPDATE sharika_users SET ' + keys.map(x => x + '=?').join(',') + `,updated_at=datetime('now') WHERE auth_uid=?`)
          .bind(...keys.map(k => changes[k]), uid).run();
        return reply({...showProfile(await me(env.DB,uid)),...await readEquipped(env.DB,uid)},200,cors);
      }
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'users' && PUBLIC_ID.test(parts[3] || '') &&
        parts.length === 4 && request.method === 'GET') {
      await assertActive(env.DB, uid);
      const user = await env.DB.prepare('SELECT * FROM sharika_users WHERE public_no=?').bind(Number(parts[3])).first();
      return user ? reply({ id: publicId(user.public_no), name: user.name, pic: user.pic, country: user.country,
        wealth_level: user.wealth_level, charm_level: user.charm_level,
        frame_style: user.frame_style || '', entry_style: user.entry_style || '',
        medal_style: user.medal_style || '', name_tag_style: user.name_tag_style || '',
        ...await readEquipped(env.DB,user.auth_uid) }, 200, cors)
        : fail('not_found', 404, cors);
    }
    // Real follow graph. Identity always comes from the verified Firebase token.
    if (path === '/api/v1/follows' && request.method === 'GET') {
      await assertActive(env.DB, uid);
      const following=await env.DB.prepare(
        'SELECT u.public_no,u.name,u.pic,'+
        'EXISTS(SELECT 1 FROM sharika_follows x WHERE x.follower_uid=u.auth_uid '+
        'AND x.followed_uid=?) AS follows_me FROM sharika_follows f '+
        'JOIN sharika_users u ON u.auth_uid=f.followed_uid '+
        "WHERE f.follower_uid=? AND u.status='active' ORDER BY f.created_at DESC LIMIT 100"
      ).bind(uid,uid).all();
      const followers=await env.DB.prepare(
        'SELECT u.public_no,u.name,u.pic FROM sharika_follows f '+
        'JOIN sharika_users u ON u.auth_uid=f.follower_uid '+
        "WHERE f.followed_uid=? AND u.status='active' ORDER BY f.created_at DESC LIMIT 100"
      ).bind(uid).all();
      return reply({following:(following.results||[]).map(u=>({...u,
        public_id:publicId(u.public_no),public_no:undefined})),
        followers:(followers.results||[]).map(u=>({...u,
        public_id:publicId(u.public_no),public_no:undefined}))},200,cors);
    }
    if(parts.length===5 && parts[0]==='api' && parts[1]==='v1' &&
       parts[2]==='users' && PUBLIC_ID.test(parts[3]) && parts[4]==='follow') {
      await assertActive(env.DB,uid);
      const target=await env.DB.prepare(
        "SELECT auth_uid,public_no,name,status FROM sharika_users WHERE public_no=?"
      ).bind(Number(parts[3])).first();
      if(!target||target.status!=='active')return fail('user_not_found',404,cors);
      if(target.auth_uid===uid)return fail('cannot_follow_self',400,cors);
      if(request.method==='PUT') {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO sharika_follows(follower_uid,followed_uid) VALUES(?,?)'
        ).bind(uid,target.auth_uid).run();
      } else if(request.method==='DELETE') {
        await env.DB.prepare(
          'DELETE FROM sharika_follows WHERE follower_uid=? AND followed_uid=?'
        ).bind(uid,target.auth_uid).run();
      } else if(request.method!=='GET')return fail('method_not_allowed',405,cors);
      const relations=await env.DB.prepare(
        'SELECT follower_uid,followed_uid FROM sharika_follows '+
        'WHERE (follower_uid=? AND followed_uid=?) OR (follower_uid=? AND followed_uid=?)'
      ).bind(uid,target.auth_uid,target.auth_uid,uid).all();
      const follow=(relations.results||[]);
      const following=follow.some(r=>r.follower_uid===uid);
      const follows_me=follow.some(r=>r.follower_uid===target.auth_uid);
      return reply({public_id:publicId(target.public_no),name:target.name,
        following,follows_me,mutual:following&&follows_me},200,cors);
    }
    if(path==='/api/v1/messages' && request.method==='GET') {
      await assertActive(env.DB,uid);
      const rows=await env.DB.prepare(
        'SELECT m.id,m.body,m.created_at,u.public_no,u.name '+
        'FROM sharika_private_messages m JOIN sharika_users u ON u.auth_uid='+
        'CASE WHEN m.sender_uid=? THEN m.recipient_uid ELSE m.sender_uid END '+
        'WHERE m.sender_uid=? OR m.recipient_uid=? ORDER BY m.id DESC LIMIT 200'
      ).bind(uid,uid,uid).all();
      const seen=new Set(),conversations=[];
      for(const item of rows.results||[]) {
        const other=publicId(item.public_no);
        if(seen.has(other))continue;
        seen.add(other);
        conversations.push({public_id:other,name:item.name,
          last_body:item.body,last_at:item.created_at});
        if(conversations.length>=100)break;
      }
      return reply({conversations},200,cors);
    }
    const messagePath=/^\/api\/v1\/messages\/([0-9]{8})$/.exec(path);
    if(messagePath) {
      await assertActive(env.DB,uid);
      const target=await env.DB.prepare(
        "SELECT auth_uid,public_no,name,status FROM sharika_users WHERE public_no=?"
      ).bind(Number(messagePath[1])).first();
      if(!target||target.status!=='active')return fail('user_not_found',404,cors);
      if(target.auth_uid===uid)return fail('cannot_message_self',400,cors);
      const relations=await env.DB.prepare(
        'SELECT follower_uid FROM sharika_follows '+
        'WHERE (follower_uid=? AND followed_uid=?) OR (follower_uid=? AND followed_uid=?)'
      ).bind(uid,target.auth_uid,target.auth_uid,uid).all();
      const mutual=(relations.results||[]).length===2;
      if(request.method==='GET'){
        const result=await env.DB.prepare(
          'SELECT id,sender_uid,body,created_at FROM sharika_private_messages '+
          'WHERE (sender_uid=? AND recipient_uid=?) OR (sender_uid=? AND recipient_uid=?) '+
          'ORDER BY id DESC LIMIT 100'
        ).bind(uid,target.auth_uid,target.auth_uid,uid).all();
        return reply({user:{public_id:publicId(target.public_no),name:target.name},
          mutual,messages:(result.results||[]).reverse().map(m=>({
            id:m.id,from_me:m.sender_uid===uid,body:m.body,created_at:m.created_at
          }))},200,cors);
      }
      if(request.method==='POST') {
        if(!mutual)return fail('mutual_follow_required',403,cors);
        const payload=await readBody(request);
        const message=typeof payload.body==='string'?payload.body.trim():'';
        const requestId=typeof payload.request_id==='string'?payload.request_id.trim():'';
        if(message.length<1||message.length>1000||
           !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
          return fail('invalid_private_message',400,cors);
        const existing=await env.DB.prepare(
          'SELECT id,body,created_at FROM sharika_private_messages WHERE request_id=? '+
          'AND sender_uid=? AND recipient_uid=?'
        ).bind(requestId,uid,target.auth_uid).first();
        if(existing)return reply({message:existing,duplicate:true},200,cors);
        const rate=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM sharika_private_messages WHERE sender_uid=? "+
          "AND created_at>=datetime('now','-1 minute')"
        ).bind(uid).first();
        if(Number(rate?.n||0)>=15)return fail('message_rate_limited',429,cors);
        await env.DB.prepare(
          'INSERT OR IGNORE INTO sharika_private_messages(sender_uid,recipient_uid,body,request_id) '+
          'VALUES(?,?,?,?)'
        ).bind(uid,target.auth_uid,message,requestId).run();
        const saved=await env.DB.prepare(
          'SELECT id,body,created_at FROM sharika_private_messages '+
          'WHERE request_id=? AND sender_uid=? AND recipient_uid=?'
        ).bind(requestId,uid,target.auth_uid).first();
        if(!saved)return fail('message_request_conflict',409,cors);
        return reply({message:saved},201,cors);
      }
      return fail('method_not_allowed',405,cors);
    }

    // Verified user-to-support chat; never reads another user's conversation.
    if (path === '/api/v1/support/messages') {
      await assertActive(env.DB, uid);
      if (request.method === 'GET') {
        const rows=await env.DB.prepare(
          'SELECT id,sender_role,body,created_at FROM sharika_support_messages '+
          'WHERE user_id=? ORDER BY id DESC LIMIT 100'
        ).bind(uid).all();
        return reply({messages:(rows.results||[]).reverse()},200,cors);
      }
      if (request.method === 'POST') {
        const payload=await readBody(request);
        const message=typeof payload.body==='string'?payload.body.trim():'';
        const requestId=typeof payload.request_id==='string'?payload.request_id.trim():'';
        if(message.length<1||message.length>1000||
            !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
          return fail('invalid_support_message',400,cors);
        const existing=await env.DB.prepare(
          'SELECT id,sender_role,body,created_at FROM sharika_support_messages '+
          'WHERE request_id=? AND user_id=? AND sender_uid=?'
        ).bind(requestId,uid,uid).first();
        if(existing)return reply({message:existing,duplicate:true},200,cors);
        const recent=await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM sharika_support_messages WHERE sender_uid=? "+
          "AND sender_role='user' AND created_at>=datetime('now','-1 minute')"
        ).bind(uid).first();
        if(Number(recent?.n||0)>=6)return fail('support_rate_limited',429,cors);
        await env.DB.prepare(
          "INSERT OR IGNORE INTO sharika_support_messages(user_id,sender_uid,sender_role,body,request_id) "+
          "VALUES(?,?,'user',?,?)"
        ).bind(uid,uid,message,requestId).run();
        const saved=await env.DB.prepare(
          'SELECT id,sender_role,body,created_at FROM sharika_support_messages '+
          'WHERE request_id=? AND user_id=? AND sender_uid=?'
        ).bind(requestId,uid,uid).first();
        if(!saved)return fail('support_request_conflict',409,cors);
        return reply({message:saved},201,cors);
      }
      return fail('method_not_allowed',405,cors);
    }
    // The three uploaded original games have independent, synchronized rounds.
    // Reuse the authenticated user's existing virtual-coin wallet and D1 ledger.
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='original-games'){
      await assertActive(env.DB,uid);
      if(parts.length===3&&request.method==='GET')
        return reply({games:['sovera-food','night-food','jackpot-fruit'],virtual_coins_only:true},200,cors);
      if(parts.length===5)
        return await handleOriginalGameRequest({request,db:env.DB,uid,game:parts[3],
          action:parts[4],reply,fail,cors});
      return fail('original_game_route_not_found',404,cors);
    }
    if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='greedy-wheel'){
      await assertActive(env.DB,uid);
      if(parts.length===4)
        return await handleGreedyRequest({request,db:env.DB,uid,
          action:parts[3],reply,fail,cors});
      return fail('greedy_route_not_found',404,cors);
    }
    // Authenticated UTC-synchronized virtual-coin games. The D1 migration
    // owns the atomic debit/payout triggers and exactly-once settlement.
    if (parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='games') {
      await assertActive(env.DB,uid);
      if(parts.length===3&&request.method==='GET')
        return reply({games:['food-wheel','jackpot-fruit'],round_ms:40000,
          virtual_coins_only:true},200,cors);
      if(parts.length===5)
        return await handleGameRequest({request,db:env.DB,uid,game:parts[3],
          action:parts[4],reply,fail,cors});
      return fail('game_route_not_found',404,cors);
    }
    if (path === '/api/v1/rankings' && request.method === 'GET') {
      await assertActive(env.DB,uid);
      const period=url.searchParams.get('period')||'weekly';
      const kind=url.searchParams.get('kind')||'rich';
      const result=await readGiftRankings(env.DB,period,kind);
      return result?reply(result,200,cors):fail('invalid_ranking_filter',400,cors);
    }
    if (path === '/api/v1/gifts' && request.method === 'GET') {
      const viewer = await assertActive(env.DB, uid);
      const luckyAllowed = env.SHARIKA_LUCKY_GIFTS_ENABLED === 'true' &&
        nonRedeemableLuckyEconomy(env) && !viewer.minor && ageFromDate(viewer.birthdate) >= 18;
      const result = await env.DB.prepare(
        'SELECT id,name,emoji,tab,price_coins,image_url,animation_url ' +
        'FROM sharika_gifts WHERE active=1 AND (tab IN (0,1) OR (tab=2 AND ?=1)) ORDER BY id LIMIT 100'
      ).bind(luckyAllowed ? 1 : 0).all();
      return reply({ gifts:result.results || [], lucky_enabled:luckyAllowed,
        lucky_odds:luckyAllowed ? LUCKY_ODDS.map(x=>({
          multiplier:x.multiplier,probability_percent:x.weight/100
        })) : [],read_only:true }, 200, cors);
    }
    if (path === '/api/v1/wallet' && request.method === 'GET') {
      await assertActive(env.DB, uid);
      await settleDueBets(env.DB,uid);
      await settleOriginalDueBets(env.DB);
      await settleGreedyDueBets(env.DB);
      const user = await me(env.DB,uid);
      const rows = await env.DB.prepare(`SELECT id,currency,delta,balance_after,reason,created_at
        FROM sharika_wallet_ledger WHERE auth_uid=? ORDER BY id DESC LIMIT 40`).bind(uid).all();
      return reply({ coins: user.coins, diamonds: user.diamonds, xp: user.xp, ledger: rows.results || [] }, 200, cors);
    }
    // Exchange terms are quoted by the server and editable only by Super
    // Admin. Without the new D1 table, existing 100:70 terms still apply.
    if(path==='/api/v1/wallet/exchange-rate'&&request.method==='GET'){
      await assertActive(env.DB,uid);
      return reply(respondRate(await readExchangeRate(env.DB)),200,cors);
    }
    // A D1 batch atomically moves diamonds to coins and writes immutable
    // ledger entries. Replays return the ORIGINAL coins, even after rate edits.
    if (path === '/api/v1/wallet/exchange' && request.method === 'POST') {
      const user=await assertActive(env.DB,uid);
      if(user.minor)return fail('exchange_adult_only',403,cors);
      const body=await readBody(request);
      const diamonds=body.diamonds;
      const requestId=typeof body.request_id==='string'?body.request_id.trim():'';
      if(!Number.isSafeInteger(diamonds)||diamonds<1||diamonds>1000000||
        !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
        return fail('invalid_exchange',400,cors);
      const txid='exchange:'+requestId;
      const prior=await env.DB.prepare(
        "SELECT id,delta FROM sharika_wallet_ledger WHERE auth_uid=? AND currency='diamonds' AND request_id=? AND reason='diamond_exchange'"
      ).bind(uid,txid).first();
      if(prior){
        if(Number(prior.delta)!==-diamonds)return fail('idempotency_conflict',409,cors);
        const receipt=await env.DB.prepare(
          "SELECT delta FROM sharika_wallet_ledger WHERE auth_uid=? AND currency='coins' AND request_id=? AND reason='diamond_exchange'"
        ).bind(uid,txid).first();
        if(!receipt||!Number.isSafeInteger(Number(receipt.delta))||Number(receipt.delta)<=0)
          throw Error('exchange_receipt_incomplete');
        const saved=await me(env.DB,uid);
        return reply({coins:saved.coins,diamonds:saved.diamonds,
          spent_diamonds:diamonds,credited_coins:Number(receipt.delta),duplicate:true},200,cors);
      }
      const rate=await readExchangeRate(env.DB);
      if(body.exchange_rate_revision!==undefined&&
         (!Number.isSafeInteger(body.exchange_rate_revision)||
          body.exchange_rate_revision!==rate.revision))
        return fail('exchange_rate_changed',409,cors);
      // Older APKs have no rate revision. Once admins edit the rate, they
      // must upgrade rather than accept a different rate silently.
      if(rate.revision>1&&body.exchange_rate_revision===undefined)
        return fail('exchange_rate_refresh_required',409,cors);
      const coins=exchangeCredit(diamonds,rate);
      if(coins===null)return fail('invalid_exchange',400,cors);
      if(user.diamonds<diamonds)return fail('insufficient_diamonds',409,cors);
      if(user.coins>1000000000000-coins)return fail('coin_balance_limit',409,cors);
      const coinChange="UPDATE sharika_users SET coins=CASE WHEN status='active' "+
        "AND coins+?<=1000000000000 "+
        (rate.persisted?"AND (SELECT revision FROM sharika_exchange_rate WHERE id=1)=? ":"")+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?";
      const creditArgs=rate.persisted?[coins,rate.revision,coins,uid]:[coins,coins,uid];
      try{
        await env.DB.batch([
          env.DB.prepare("UPDATE sharika_users SET diamonds=CASE WHEN status='active' AND diamonds>=? THEN diamonds-? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
            .bind(diamonds,diamonds,uid),
          env.DB.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
            "VALUES(?,'diamonds',?,(SELECT diamonds FROM sharika_users WHERE auth_uid=?),'diamond_exchange',?)")
            .bind(uid,-diamonds,uid,txid),
          env.DB.prepare(coinChange).bind(...creditArgs),
          env.DB.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
            "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'diamond_exchange',?)")
            .bind(uid,coins,uid,txid)
        ]);
      }catch(error){
        if(rate.persisted&&/CHECK constraint/i.test(String(error?.message||error)))
          return fail('exchange_rate_changed_or_balance_insufficient',409,cors);
        throw error;
      }
      const updated=await me(env.DB,uid);
      return reply({coins:updated.coins,diamonds:updated.diamonds,
        spent_diamonds:diamonds,credited_coins:coins,duplicate:false,
        exchange_rate_revision:rate.revision},200,cors);
    }
    if(coverPath && request.method==='PUT') {
      await assertActive(env.DB,uid);
      const roomId=coverPath[1];
      const room=await env.DB.prepare('SELECT * FROM sharika_rooms WHERE id=?')
        .bind(roomId).first();
      if(!room)return fail('room_not_found',404,cors);
      if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
      const contentLength=Number(request.headers.get('content-length')||0);
      if(contentLength>125000)return fail('room_cover_too_large',413,cors);
      const raw=await request.text();
      if(raw.length>125000)return fail('room_cover_too_large',413,cors);
      let body;
      try{body=JSON.parse(raw||'{}');}catch(_){return fail('invalid_room_cover',400,cors);}
      if(!body||typeof body!=='object'||Array.isArray(body)||
         typeof body.image_data!=='string'||!body.image_data.startsWith('data:image/jpeg;base64,'))
        return fail('invalid_room_cover',400,cors);
      const imageBase64=body.image_data.slice('data:image/jpeg;base64,'.length);
      if(imageBase64.length<16||imageBase64.length>120000||
         !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))
        return fail('invalid_room_cover',400,cors);
      let binary;
      try{binary=atob(imageBase64);}catch(_){return fail('invalid_room_cover',400,cors);}
      if(binary.length<32||binary.length>90000||
         binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216||
         binary.charCodeAt(2)!==255||
         binary.charCodeAt(binary.length-2)!==255||
         binary.charCodeAt(binary.length-1)!==217)
        return fail('invalid_room_cover',400,cors);
      const saved=await env.DB.prepare(
        'INSERT INTO sharika_room_covers(room_id,mime,image_base64,image_bytes) '+
        "VALUES(?,'image/jpeg',?,?) ON CONFLICT(room_id) DO UPDATE SET "+
        'image_base64=excluded.image_base64,image_bytes=excluded.image_bytes,'+
        "version=MIN(sharika_room_covers.version+1,1000000000),updated_at=datetime('now') "+
        "WHERE sharika_room_covers.updated_at<=datetime('now','-20 seconds')"
      ).bind(roomId,imageBase64,binary.length).run();
      if(!saved.meta?.changes)return fail('room_cover_rate_limited',429,cors);
      const row=await env.DB.prepare(
        'SELECT version,image_bytes FROM sharika_room_covers WHERE room_id=?'
      ).bind(roomId).first();
      return reply({room_id:roomId,cover_url:url.origin+path+'?v='+row.version,
        cover_version:row.version,image_bytes:row.image_bytes},200,cors);
    }
    if (path === '/api/v1/rooms') {
      await assertActive(env.DB, uid);
      if (request.method === 'GET') {
        const rows=await env.DB.prepare(
          'SELECT r.*,c.version AS cover_version FROM sharika_rooms r '+
          'LEFT JOIN sharika_room_covers c ON c.room_id=r.id '+
          'ORDER BY r.created_at DESC LIMIT 100'
        ).all();
        // One verified room presence snapshot for all displayed cards.
        let online={};
        if(env.VOICE_ROOMS) {
          try {
            online=await env.VOICE_ROOMS.getByName('sharika:presence:staging')
              .presenceRoomCounts();
          } catch(error) {console.warn('room_presence_unavailable',error?.message);}
        }
        return reply({rooms:(rows.results||[]).map(r=>({
          ...r,cover_url:r.cover_version?url.origin+'/api/v1/rooms/'+r.id+
            '/cover?v='+r.cover_version:null,
          online_count:Number(online?.[r.id])||0
        }))},200,cors);
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
    // Room settings are owned by the verified room owner, never the browser's
    // self-declared "owner" flag. Save name and seat count in shared D1.
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'v1' &&
        parts[2] === 'rooms' && PUBLIC_ID.test(parts[3]) && request.method === 'PATCH') {
      await assertActive(env.DB, uid);
      const roomId=parts[3];
      const room=await env.DB.prepare('SELECT * FROM sharika_rooms WHERE id=?').bind(roomId).first();
      if(!room)return fail('room_not_found',404,cors);
      if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
      const body=await readBody(request);
      const name=body.name===undefined ? room.name : txt(body.name,100);
      const seatCount=body.seat_count===undefined ? room.seat_count : body.seat_count;
      const theme=body.theme===undefined ? (room.theme||'mid') : body.theme;
      const seatFrame=body.seat_frame_style===undefined
        ? (room.seat_frame_style||'grad') : body.seat_frame_style;
      if(!name || !Number.isInteger(seatCount) || seatCount<4 || seatCount>20 ||
         !ROOM_THEMES.has(theme) || !ROOM_SEAT_FRAMES.has(seatFrame))
        return fail('invalid_room_settings',400,cors);
      if(theme==='photo'){
        const photo=await env.DB.prepare(
          'SELECT version FROM sharika_room_covers WHERE room_id=?'
        ).bind(roomId).first();
        if(!photo?.version)return fail('room_theme_photo_missing',409,cors);
      }
      const updated=await env.DB.prepare(
        'UPDATE sharika_rooms SET name=?,seat_count=?,theme=?,seat_frame_style=? WHERE id=? AND owner_id=? '+
        'AND NOT EXISTS (SELECT 1 FROM sharika_room_members WHERE room_id=? AND seat_no>?)'
      ).bind(name,seatCount,theme,seatFrame,roomId,uid,roomId,seatCount).run();
      if(!updated.meta?.changes)return fail('seats_occupied_above_new_limit',409,cors);
      if(env.VOICE_ROOMS)await env.VOICE_ROOMS.getByName('sharika:'+roomId)
        .dropSeatLocksAbove(seatCount);
      return reply({room:await env.DB.prepare('SELECT * FROM sharika_rooms WHERE id=?')
        .bind(roomId).first()},200,cors);
    }
    if (parts.length >= 5 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'rooms' && PUBLIC_ID.test(parts[3])) {
      await assertActive(env.DB, uid);
      const roomId = parts[3];
      const action = parts[4];
      const { room, member } = await roomAndMember(env.DB, roomId, uid);
      // An owner may invite an unseated, verified member to an unlocked mic seat.
      if(parts.length===5 && action==='invitations') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_invites_unavailable',503,cors);
        const coordinator=env.VOICE_ROOMS.getByName('sharika:'+roomId);
        if(request.method==='GET')return reply(await coordinator.seatInvitePending(uid),200,cors);
        if(request.method==='POST') {
          if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
          const body=await readBody(request);
          if(!Number.isInteger(body.seat_no)||body.seat_no<1||
             body.seat_no>room.seat_count||
             typeof body.target_public_id!=='string'||!PUBLIC_ID.test(body.target_public_id))
            return fail('invalid_invitation',400,cors);
          const target=await env.DB.prepare(
            'SELECT u.auth_uid,u.status,m.seat_no FROM sharika_room_members m '+
            'JOIN sharika_users u ON u.auth_uid=m.user_id WHERE m.room_id=? AND u.public_no=?'
          ).bind(roomId,Number(body.target_public_id)).first();
          if(!target||target.status!=='active'||target.auth_uid===uid||
             target.seat_no!==null)return fail('invite_target_unavailable',409,cors);
          const result=await coordinator.seatInviteSend(roomId,uid,target.auth_uid,body.seat_no);
          if(result.error)return fail(result.error,
            result.error==='invite_rate_limited'?429:409,cors);
          return reply({invitation:result},201,cors);
        }
        return fail('method_not_allowed',405,cors);
      }
      if(parts.length===6 && action==='invitations' &&
         parts[5]==='respond' && request.method==='POST') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_invites_unavailable',503,cors);
        const body=await readBody(request);
        if(!Number.isInteger(body.seat_no)||body.seat_no<1||
           body.seat_no>room.seat_count||typeof body.accept!=='boolean')
          return fail('invalid_invitation_response',400,cors);
        const result=await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .seatInviteRespond(roomId,uid,body.seat_no,body.accept);
        if(result.error)return fail(result.error,
          result.error==='invite_not_found'?404:409,cors);
        return reply(result,200,cors);
      }
      // Text chat is real-time room data, not a browser-only fake conversation.
      // Only verified members may read or send, and the Worker supplies identity.
      if (parts.length === 5 && action === 'chat') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_chat_unavailable',503,cors);
        const coordinator=env.VOICE_ROOMS.getByName('sharika:'+roomId);
        if(request.method==='GET') {
          const raw=url.searchParams.get('after')||'0';
          if(!/^[0-9]{1,12}$/.test(raw) || !Number.isSafeInteger(Number(raw)))
            return fail('invalid_chat_cursor',400,cors);
          return reply(await coordinator.roomChatRead(Number(raw)),200,cors);
        }
        if(request.method==='POST') {
          const payload=await readBody(request);
          const message=typeof payload.body==='string'?payload.body.trim():'';
          const requestId=typeof payload.request_id==='string'?payload.request_id.trim():'';
          if(!message||message.length>300||
             !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
            return fail('invalid_room_message',400,cors);
          const user=await assertActive(env.DB,uid);
          const result=await coordinator.roomChatSend(uid,publicId(user.public_no),
            txt(user.name,80)||'Member',message,requestId);
          if(result.error)return fail(result.error,
            result.error==='message_rate_limited'?429:409,cors);
          return reply(result,result.duplicate?200:201,cors);
        }
        return fail('method_not_allowed',405,cors);
      }
      // Ephemeral room-wide emoji reactions: authenticate both the sender and
      // their current mic seat. Clients never choose another member's ID.
      if(parts.length===5 && action==='reactions') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_reactions_unavailable',503,cors);
        const coordinator=env.VOICE_ROOMS.getByName('sharika:'+roomId);
        if(request.method==='GET') {
          const after=url.searchParams.get('after')||'0';
          if(!/^[0-9]{1,12}$/.test(after)||!Number.isSafeInteger(Number(after)))
            return fail('invalid_reaction_cursor',400,cors);
          return reply(await coordinator.roomReactionRead(Number(after)),200,cors);
        }
        if(request.method==='POST') {
          if(room.owner_id!==uid &&
             (!Number.isInteger(member.seat_no)||member.seat_no<1))
            return fail('take_mic_seat_first',403,cors);
          const body=await readBody(request);
          const permitted=new Set(['😂','😍','😎','🔥','👏','🎉','😭','😡',
            '🥳','😘','🤩','👍','🙏','💯','😴','💖']);
          if(typeof body.emoji!=='string'||!permitted.has(body.emoji)||
             typeof body.request_id!=='string'||
             !/^[a-zA-Z0-9:_-]{12,80}$/.test(body.request_id))
            return fail('invalid_seat_reaction',400,cors);
          const sender=await assertActive(env.DB,uid);
          const result=await coordinator.roomReactionSend(uid,publicId(sender.public_no),
            body.emoji,body.request_id);
          if(result.error)return fail(result.error,
            result.error==='reaction_rate_limited'?429:409,cors);
          return reply(result,result.duplicate?200:201,cors);
        }
        return fail('method_not_allowed',405,cors);
      }
      if (parts.length === 5 && action === 'join' && request.method === 'POST') {
        const ban=await env.DB.prepare(
          'SELECT banned_until_ms FROM sharika_room_bans WHERE room_id=? AND user_id=?'
        ).bind(roomId,uid).first();
        if(ban&&Number(ban.banned_until_ms)>Date.now())
          return fail('room_temporarily_blocked',403,cors);
        if (!member) {
          await env.DB.prepare(`INSERT OR IGNORE INTO sharika_room_members(room_id,user_id,role) VALUES(?,?,'member')`)
            .bind(roomId, uid).run();
        }
        const saved = await env.DB.prepare('SELECT * FROM sharika_room_members WHERE room_id=? AND user_id=?').bind(roomId,uid).first();
        // Room-wide arrival event uses the verified equipped style and ID.
        // Its coordinator retains a short event history for other phones.
        if(env.VOICE_ROOMS){
          const entrant=await assertActive(env.DB,uid);
          const equipped=await readEquipped(env.DB,uid);
          const entry=Object.prototype.hasOwnProperty.call(equipped,'entry_style')
            ?equipped.entry_style:(entrant.entry_style||'');
          if(entry)await env.VOICE_ROOMS.getByName('sharika:'+roomId)
            .roomEntryAnnounce(uid,publicId(entrant.public_no),entrant.name,entry);
        }
        return reply({ member: saved, owner: room.owner_id === uid }, 200, cors);
      }
      if (parts.length === 5 && action === 'leave' && request.method === 'POST') {
        if (room.owner_id === uid) {
          await env.DB.prepare('UPDATE sharika_room_members SET seat_no=NULL WHERE room_id=? AND user_id=?')
            .bind(roomId, uid).run();
        } else {
          await env.DB.prepare('DELETE FROM sharika_room_members WHERE room_id=? AND user_id=?').bind(roomId, uid).run();
        }
        if(env.VOICE_ROOMS)await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .seatInviteClear(uid);
        return reply({ left: true, owner: room.owner_id === uid }, 200, cors);
      }
      // Ordinary gifts earn a 10% room share. Newly settled gifts also credit
      // whole coins once to the owner's audited personal wallet; the room
      // ledger remains a report, not another claimable balance.
      // Lucky Gifts retain their separate 1% rule.
      if (parts.length===5 && action==='rewards' && request.method==='GET') {
        if(!member)return fail('join_room_first',403,cors);
        const regular=await env.DB.prepare(
          'SELECT COALESCE(SUM(reward_hundredths),0) AS points '+
          'FROM sharika_regular_room_rewards WHERE room_id=?'
        ).bind(roomId).first();
        const regularPoints=Number(regular?.points)||0;
        const luckyEnabled=env.SHARIKA_LUCKY_GIFTS_ENABLED==='true' &&
          nonRedeemableLuckyEconomy(env);
        const lucky=luckyEnabled?await env.DB.prepare(
          'SELECT COALESCE(SUM(reward_hundredths),0) AS points '+
          'FROM sharika_lucky_room_rewards WHERE room_id=?'
        ).bind(roomId).first():null;
        const luckyPoints=Number(lucky?.points)||0;
        const points=regularPoints+luckyPoints;
        const credited=await env.DB.prepare(
          "SELECT COALESCE(SUM(l.delta),0) AS coins FROM sharika_gift_transactions t "+
          "JOIN sharika_wallet_ledger l ON l.auth_uid=? AND l.currency='coins' "+
          "AND l.reason='room_gift_reward' AND l.request_id=('roomgift:'||t.id) "+
          "WHERE t.room_id=?"
        ).bind(room.owner_id,roomId).first();
        const ownerWalletCreditedCoins=Number(credited?.coins)||0;
        return reply({room_id:roomId,reward_coins:Math.floor(points/100),
          reward_fraction_hundredths:points%100,reward_hundredths:points,
          regular_reward_hundredths:regularPoints,lucky_reward_hundredths:luckyPoints,
          regular_gift_percent:10,lucky_gift_percent:1,
          owner_wallet_credited:ownerWalletCreditedCoins>0,
          owner_wallet_credited_coins:ownerWalletCreditedCoins,
          owner_wallet_credit_enabled:true,withdrawal_enabled:false},200,cors);
      }
      // Gift sending uses the real D1 catalog and an all-or-nothing ledger.
      // Lucky/random-payout items remain blocked pending cashout compliance.
      if (parts.length===5 && action==='gifts') {
        if(!member)return fail('join_room_first',403,cors);
        if(request.method==='GET') {
          const luckyEnabled=env.SHARIKA_LUCKY_GIFTS_ENABLED==='true' &&
            nonRedeemableLuckyEconomy(env);
          const rows=await env.DB.prepare(
            'SELECT e.id,e.quantity,e.price_coins,e.created_at,'+
            'su.public_no AS sender_no,ru.public_no AS recipient_no,'+
            (luckyEnabled?'g.name,g.emoji,g.tab,lo.payout_coins,lo.max_multiplier ':
              'g.name,g.emoji,g.tab,NULL AS payout_coins,NULL AS max_multiplier ')+
            'FROM sharika_gift_events e '+
            'JOIN sharika_users su ON su.auth_uid=e.sender_uid '+
            'JOIN sharika_users ru ON ru.auth_uid=e.recipient_uid '+
            'JOIN sharika_gifts g ON g.id=e.gift_id '+
            (luckyEnabled?'LEFT JOIN sharika_lucky_gift_outcomes lo ON lo.transaction_id=e.transaction_id ':'')+
            'WHERE e.room_id=? ORDER BY e.id DESC LIMIT 40'
          ).bind(roomId).all();
          return reply({events:(rows.results||[]).reverse().map(e=>({
            id:e.id,quantity:e.quantity,price_coins:e.price_coins,
            created_at:e.created_at,sender_id:publicId(e.sender_no),
            recipient_id:publicId(e.recipient_no),name:e.name,emoji:e.emoji,
            lucky:e.tab===2&&luckyEnabled?{payout_coins:Number(e.payout_coins)||0,
              max_multiplier:Number(e.max_multiplier)||0}:null
          }))},200,cors);
        }
        if(request.method==='POST') {
          const body=await readBody(request);
          const giftId=body.gift_id,quantity=body.quantity;
          const requested=body.recipient_public_ids;
          const requestId=typeof body.request_id==='string'?body.request_id.trim():'';
          if(!Number.isSafeInteger(giftId)||giftId<1||
             !Number.isSafeInteger(quantity)||quantity<1||quantity>10||
             !Array.isArray(requested)||requested.length<1||requested.length>20||
             requested.some(x=>typeof x!=='string'||!PUBLIC_ID.test(x))||
             new Set(requested).size!==requested.length||
             !/^[a-zA-Z0-9:_-]{12,80}$/.test(requestId))
            return fail('invalid_gift_request',400,cors);
          const ids=[...requested].sort();
          const existing=await env.DB.prepare(
            'SELECT id,room_id,gift_id,quantity,recipient_ids_json,total_coins '+
            'FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?'
          ).bind(uid,requestId).first();
          if(existing){
            if(existing.room_id!==roomId||existing.gift_id!==giftId||
               existing.quantity!==quantity||
                existing.recipient_ids_json!==JSON.stringify(ids))
              return fail('idempotency_conflict',409,cors);
            const wallet=await me(env.DB,uid);
            const regularShare=await env.DB.prepare(
              'SELECT reward_hundredths FROM sharika_regular_room_rewards WHERE transaction_id=?'
            ).bind(existing.id).first();
            const ownerCredit=await env.DB.prepare(
              "SELECT delta FROM sharika_wallet_ledger WHERE auth_uid=? "+
              "AND currency='coins' AND reason='room_gift_reward' "+
              "AND request_id=('roomgift:'||?)"
            ).bind(room.owner_id,existing.id).first();
            const outcome=env.SHARIKA_LUCKY_GIFTS_ENABLED==='true'
              ?await env.DB.prepare(
                'SELECT payout_coins,max_multiplier FROM sharika_lucky_gift_outcomes WHERE transaction_id=?'
              ).bind(existing.id).first():null;
            return reply({duplicate:true,transaction_id:existing.id,
              coins:wallet.coins,spent_coins:existing.total_coins,
              room_reward_coins:Number(regularShare?.reward_hundredths||0)/100,
              owner_reward_coins:Number(ownerCredit?.delta)||0,
              lucky:outcome?{payout_coins:outcome.payout_coins,
                max_multiplier:outcome.max_multiplier}:null},200,cors);
          }
          const gift=await env.DB.prepare(
            'SELECT id,name,emoji,tab,price_coins FROM sharika_gifts '+
            'WHERE id=? AND active=1 AND tab IN (0,1,2)'
          ).bind(giftId).first();
          if(!gift)return fail('gift_unavailable',404,cors);
          const recipients=await env.DB.prepare(
            'SELECT u.auth_uid,u.public_no,u.status FROM sharika_users u '+
            'JOIN sharika_room_members m ON m.user_id=u.auth_uid '+
            'WHERE m.room_id=? AND u.public_no IN ('+
            ids.map(()=>'?').join(',')+')'
          ).bind(roomId,...ids.map(Number)).all();
          const found=recipients.results||[];
          if(found.length!==ids.length||found.some(u=>u.status!=='active'))
            return fail('gift_recipient_unavailable',409,cors);
          const spend=Number(gift.price_coins)*quantity*ids.length;
          if(!Number.isSafeInteger(spend)||spend<1||spend>100000000)
            return fail('gift_amount_exceeds_limit',400,cors);
          const sender=await assertActive(env.DB,uid);
          let lucky=null,benefits=null;
          if(gift.tab===2) {
            if(env.SHARIKA_LUCKY_GIFTS_ENABLED!=='true')
              return fail('lucky_gifts_disabled',503,cors);
            if(!nonRedeemableLuckyEconomy(env))
              return fail('lucky_requires_non_redeemable_coins',403,cors);
            if(sender.minor || !(ageFromDate(sender.birthdate)>=18))
              return fail('lucky_gifts_adult_only',403,cors);
            lucky=drawLuckyGift(Number(gift.price_coins),quantity*ids.length);
            benefits=luckyGiftBenefits(Number(gift.price_coins),quantity,ids.length);
            if(!Number.isSafeInteger(sender.coins-spend+lucky.payout_coins))
              return fail('lucky_wallet_limit',400,cors);
          }
          if(sender.coins<spend)return fail('insufficient_coins',409,cors);
          const recent=await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM sharika_gift_transactions WHERE sender_uid=? "+
            "AND created_at>=datetime('now','-1 minute')"
          ).bind(uid).first();
          if(Number(recent?.n||0)>=20)return fail('gift_rate_limited',429,cors);
          const txid='gift:'+requestId;
          const statements=[
            env.DB.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' "+
              "THEN coins-? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
              .bind(spend,uid),
            env.DB.prepare(
              'INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,'+
              'recipient_ids_json,total_coins,request_id) VALUES(?,?,?,?,?,?,?)'
            ).bind(uid,roomId,giftId,quantity,JSON.stringify(ids),spend,requestId),
            env.DB.prepare(
              "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
              "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'gift_sent',?)"
            ).bind(uid,-spend,uid,txid),
            env.DB.prepare(
              'UPDATE sharika_users SET wealth_level=MAX(wealth_level,1+CAST('+
              "(SELECT COALESCE(-SUM(delta),0) FROM sharika_wallet_ledger "+
              "WHERE auth_uid=? AND currency='coins' AND reason='gift_sent')/1000 "+
              "AS INTEGER)) WHERE auth_uid=?"
            ).bind(uid,uid)
          ];
          if(lucky) {
            if(lucky.payout_coins>0) {
              statements.push(env.DB.prepare(
                "UPDATE sharika_users SET coins=coins+?,updated_at=datetime('now') "+
                "WHERE auth_uid=? AND status='active'"
              ).bind(lucky.payout_coins,uid));
              statements.push(env.DB.prepare(
                "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
                "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'lucky_gift_reward',?)"
              ).bind(uid,lucky.payout_coins,uid,'lucky:'+requestId));
            }
            statements.push(env.DB.prepare(
              'INSERT INTO sharika_lucky_gift_outcomes(transaction_id,sender_uid,'+
              'payout_coins,max_multiplier,rolls_json) VALUES('+
              '(SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?),?,?,?,?)'
            ).bind(uid,requestId,uid,lucky.payout_coins,lucky.max_multiplier,
              JSON.stringify(lucky.rolls)));
          }
          for(const recipient of found) {
            const xp=Number(gift.price_coins)*quantity;
            statements.push(env.DB.prepare(
              'INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,'+
              'recipient_uid,gift_id,quantity,price_coins) VALUES('+
              '(SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?),?,?,?,?,?,?)'
            ).bind(uid,requestId,roomId,uid,recipient.auth_uid,giftId,quantity,gift.price_coins));
            statements.push(env.DB.prepare(
              "UPDATE sharika_users SET xp=CASE WHEN status='active' THEN xp+? ELSE -1 END,"+
              "charm_level=MAX(charm_level,1+CAST((xp+?)/1000 AS INTEGER)),"+
              "updated_at=datetime('now') WHERE auth_uid=?"
            ).bind(xp,xp,recipient.auth_uid));
            if(benefits)statements.push(env.DB.prepare(
              'INSERT INTO sharika_lucky_recipient_rewards(transaction_id,recipient_uid,'+
              'earned_hundredths) VALUES('+
              '(SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?),?,?)'
            ).bind(uid,requestId,recipient.auth_uid,benefits.recipient_hundredths));
          }
          if(benefits)statements.push(env.DB.prepare(
            'INSERT INTO sharika_lucky_room_rewards(transaction_id,room_id,reward_hundredths) '+
            'VALUES((SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?),?,?)'
          ).bind(uid,requestId,roomId,benefits.room_hundredths));
          // A verified 10% room share is recorded for every ordinary gift.
          // Its D1 trigger checks the full settled transaction amount.
          const regularRewardHundredths=gift.tab===2?0:spend*10;
          if(regularRewardHundredths)statements.push(env.DB.prepare(
            'INSERT INTO sharika_regular_room_rewards(transaction_id,room_id,reward_hundredths) '+
            'VALUES((SELECT id FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?),?,?)'
          ).bind(uid,requestId,roomId,regularRewardHundredths));
          // The room ledger retains the exact 10% share in hundredths.
          // Whole coins are also credited once to the room owner's wallet
          // in this same atomic gift settlement (no second claim).
          const ownerRewardCoins=gift.tab===2?0:Math.floor(spend/10);
          if(ownerRewardCoins>0){
            statements.push(env.DB.prepare(
              "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
              "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
            ).bind(Number.MAX_SAFE_INTEGER-ownerRewardCoins,ownerRewardCoins,room.owner_id));
            statements.push(env.DB.prepare(
              "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
              "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
              "'room_gift_reward','roomgift:'||(SELECT id FROM sharika_gift_transactions "+
              "WHERE sender_uid=? AND request_id=?))"
            ).bind(room.owner_id,ownerRewardCoins,room.owner_id,uid,requestId));
          }
          await env.DB.batch(statements);
          const saved=await env.DB.prepare(
            'SELECT id,total_coins FROM sharika_gift_transactions WHERE sender_uid=? AND request_id=?'
          ).bind(uid,requestId).first();
          const wallet=await me(env.DB,uid);
          return reply({duplicate:false,transaction_id:saved.id,
            gift:{id:gift.id,name:gift.name,emoji:gift.emoji},
            coins:wallet.coins,spent_coins:spend,recipients:ids,
            quantity,room_reward_coins:regularRewardHundredths/100,
            owner_reward_coins:ownerRewardCoins,
            lucky:lucky?{payout_coins:lucky.payout_coins,
              max_multiplier:lucky.max_multiplier,
              recipient_reward_diamonds:benefits.recipient_hundredths/100,
              room_reward_coins:benefits.room_hundredths/100}:null},201,cors);
        }
        return fail('method_not_allowed',405,cors);
      }
      if (!member) return fail('join_room_first', 403, cors);
      if (parts.length === 6 && action === 'voice')
        return await handleVoiceOperation({
          request, env, room, member, uid, roomId, operation:parts[5],
          reply, fail, cors, readBody
        });
      if(parts.length===5 && action==='moderate')
        return handleRoomModeration({
          request,env,uid,room,roomId,reply,fail,cors,readBody
        });
      if (parts.length===5 && action==='locks' && request.method==='PUT') {
        if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_seats_unavailable',503,cors);
        const body=await readBody(request);
        if(!Number.isInteger(body.seat_no)||body.seat_no<1||
           body.seat_no>room.seat_count||typeof body.locked!=='boolean')
          return fail('invalid_seat_lock',400,cors);
        const result=await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .changeSeatLock(roomId,body.seat_no,body.locked);
        if(result.error)return fail(result.error,409,cors);
        return reply(result,200,cors);
      }
      if (parts.length === 5 && action === 'seat' && request.method === 'PUT') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_seats_unavailable',503,cors);
        const body=await readBody(request);
        const seat = body.seat_no === null ? null : Number(body.seat_no);
        if (seat !== null && (!Number.isInteger(seat) || seat < 1 ||
          seat > room.seat_count)) return fail('invalid_seat', 400, cors);
        const result=await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .changeMemberSeat(roomId,uid,seat);
        if(result.error)return fail(result.error,
          result.error==='seat_locked'?409:403,cors);
        return reply(result,200,cors);
      }
      if(parts.length===5 && action==='entries' && request.method==='GET'){
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_entries_unavailable',503,cors);
        const after=url.searchParams.get('after')||'0';
        if(!/^[0-9]{1,12}$/.test(after)||!Number.isSafeInteger(Number(after)))
          return fail('invalid_entry_cursor',400,cors);
        return reply(await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .roomEntryRead(Number(after)),200,cors);
      }
      if (parts.length === 5 && action === 'members' && request.method === 'GET') {
        if(!member)return fail('join_room_first',403,cors);
        if(!env.VOICE_ROOMS)return fail('room_seats_unavailable',503,cors);
        const result = await env.DB.prepare(`SELECT m.room_id,m.user_id,m.role,m.seat_no,m.muted,
          u.public_no,u.name,u.pic,u.wealth_level,u.frame_style,u.entry_style,u.medal_style,u.name_tag_style FROM sharika_room_members m
          JOIN sharika_users u ON u.auth_uid=m.user_id WHERE m.room_id=? ORDER BY m.joined_at LIMIT 100`).bind(roomId).all();
        const lockedSeats=await env.VOICE_ROOMS.getByName('sharika:'+roomId)
          .lockedSeats();
        const equipped=await readRoomEquipped(env.DB,roomId);
        // Room color and owner-selected photo are shared room state. Return
        // them with every member poll, so guests already inside and late
        // joiners see the same background without trusting localStorage.
        const cover=room.theme==='photo' ? await env.DB.prepare(
          'SELECT version FROM sharika_room_covers WHERE room_id=?'
        ).bind(roomId).first() : null;
        return reply({ room: roomId,
          theme:ROOM_THEMES.has(room.theme)?room.theme:'mid',
          theme_background_url:cover?.version
            ? url.origin+'/api/v1/rooms/'+roomId+'/cover?v='+cover.version:null,
          // Room capacity is authoritative in D1; all joined devices must
          // receive current capacity even when their room card is cached.
          seat_count:room.seat_count,
          seat_frame_style:room.seat_frame_style||'grad',
          locked_seats:lockedSeats.filter(seat=>seat>=1&&seat<=room.seat_count),
          members: (result.results || []).map(x => ({
          room_id: x.room_id, user_id: x.user_id, role: x.role, seat_no: x.seat_no, muted: !!x.muted,
          sharika_users: { public_id: publicId(x.public_no), name: x.name, pic: x.pic, wealth_level: x.wealth_level,
            frame_style: x.frame_style || '', entry_style: x.entry_style || '',
            medal_style: x.medal_style || '', name_tag_style: x.name_tag_style || '',
            ...(equipped.get(x.user_id)||{}) }
        })) }, 200, cors);
      }
      if (parts.length === 5 && action === 'voice-token' && request.method === 'POST') {
        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !/^wss:\/\//.test(env.LIVEKIT_URL || '')) {
          return fail('voice_not_configured', 503, cors);
        }
        const publish = room.owner_id === uid || (member.seat_no !== null && !member.muted);
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
