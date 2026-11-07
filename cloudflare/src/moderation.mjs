// Verified room owner moderation for isolated Sharika staging.
// Never trust client-supplied roles, seat occupancy or Firebase UID.
import { forceCloseMicrophone } from './sfu.mjs';

const PUBLIC_ID=/^[0-9]{8}$/;
const ACTIONS=new Set(['mute','unmute','remove_seat','kick','block','unblock']);
const ROOM_BAN_MS=10*60*1000;
// Explicit Room Blocks last until an authorized moderator removes them.
const ROOM_BLOCK_UNTIL_MS=Date.UTC(3000,0,1);

export async function isRoomAdmin(env,roomId,uid) {
  const found=await env.DB.prepare(
    'SELECT 1 AS active FROM sharika_room_admins WHERE room_id=? AND user_id=?'
  ).bind(roomId,uid).first();
  return Number(found?.active)===1;
}

// Only the verified owner appoints or revokes administrators. An assigned
// administrator has room-scoped moderation, never global or wallet privileges.
export async function handleRoomAdminAssignment({
  request,env,uid,room,roomId,reply,fail,cors,readBody
}) {
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
  const body=await readBody(request);
  const action=body.action;
  const publicId=body.target_public_id;
  if(!['grant','revoke'].includes(action)||
     typeof publicId!=='string'||!PUBLIC_ID.test(publicId))
    return fail('invalid_room_admin_action',400,cors);
  const target=await env.DB.prepare(
    'SELECT u.auth_uid AS user_id,u.status,m.user_id AS member_uid '+
    'FROM sharika_users u LEFT JOIN sharika_room_members m '+
    'ON m.user_id=u.auth_uid AND m.room_id=? WHERE u.public_no=?'
  ).bind(roomId,Number(publicId)).first();
  if(!target)return fail('user_not_found',404,cors);
  if(target.user_id===room.owner_id)return fail('cannot_change_room_owner',403,cors);
  if(action==='grant'&&(!target.member_uid||target.status!=='active'))
    return fail('room_member_not_found',404,cors);
  const mutation=action==='grant'
    ?env.DB.prepare(
      'INSERT INTO sharika_room_admins(room_id,user_id,granted_by_uid) '+
      'VALUES(?,?,?) ON CONFLICT(room_id,user_id) DO NOTHING'
    ).bind(roomId,target.user_id,uid)
    :env.DB.prepare(
      'DELETE FROM sharika_room_admins WHERE room_id=? AND user_id=?'
    ).bind(roomId,target.user_id);
  const audit=env.DB.prepare(
    'INSERT INTO sharika_room_admin_audit(room_id,actor_uid,target_uid,action) '+
    'VALUES(?,?,?,?)'
  ).bind(roomId,uid,target.user_id,action);
  await env.DB.batch([mutation,audit]);
  return reply({ok:true,room_id:roomId,target_public_id:publicId,
    role:action==='grant'?'admin':'member'},200,cors);
}

export async function handleRoomModeration({
  request,env,uid,room,roomId,reply,fail,cors,readBody,
  closeAudio=forceCloseMicrophone
}) {
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  const actorIsOwner=room.owner_id===uid;
  if(!actorIsOwner && !await isRoomAdmin(env,roomId,uid))
    return fail('room_owner_only',403,cors);
  const body=await readBody(request);
  const action=body.action;
  const publicId=body.target_public_id;
  if(!ACTIONS.has(action) || typeof publicId!=='string' || !PUBLIC_ID.test(publicId))
    return fail('invalid_moderation',400,cors);
  if(action==='unblock'){
    const blocked=await env.DB.prepare(
      'SELECT b.user_id FROM sharika_room_bans b '+
      'JOIN sharika_users u ON u.auth_uid=b.user_id '+
      'WHERE b.room_id=? AND u.public_no=? AND b.banned_until_ms>?'
    ).bind(roomId,Number(publicId),Date.now()).first();
    if(!blocked)return fail('room_block_not_found',404,cors);
    if(blocked.user_id===uid||blocked.user_id===room.owner_id)
      return fail('cannot_moderate_room_owner',403,cors);
    if(!actorIsOwner&&await isRoomAdmin(env,roomId,blocked.user_id))
      return fail('cannot_moderate_room_admin',403,cors);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sharika_room_bans WHERE room_id=? AND user_id=?')
        .bind(roomId,blocked.user_id),
      env.DB.prepare(
        "INSERT INTO sharika_room_block_audit(room_id,actor_uid,target_uid,action) VALUES(?,?,?,'unblock')"
      ).bind(roomId,uid,blocked.user_id)
    ]);
    return reply({ok:true,room_id:roomId,target_public_id:publicId,action:'unblock'},200,cors);
  }
  const target=await env.DB.prepare(
    'SELECT m.user_id,m.seat_no,m.muted,u.public_no FROM sharika_room_members m '+
    'JOIN sharika_users u ON u.auth_uid=m.user_id '+
    'WHERE m.room_id=? AND u.public_no=?'
  ).bind(roomId,Number(publicId)).first();
  if(!target)return fail('room_member_not_found',404,cors);
  if(target.user_id===uid || target.user_id===room.owner_id)
    return fail('cannot_moderate_room_owner',403,cors);
  if(!actorIsOwner && await isRoomAdmin(env,roomId,target.user_id))
    return fail('cannot_moderate_room_admin',403,cors);
  if(action!=='kick'&&action!=='block' && target.seat_no===null)
    return fail('user_not_on_mic',409,cors);

  if(action!=='unmute' && !env.VOICE_ROOMS)return fail('voice_moderation_unavailable',503,cors);
  const roomDO=env.VOICE_ROOMS?.getByName('sharika:'+roomId);
  if(action!=='unmute' && roomDO) {
    // First close live SFU publications. If Cloudflare cannot confirm this,
    // leave membership unchanged so the owner can retry safely.
    const sessions=await roomDO.publishedFor(target.user_id);
    try {
      for(const session of sessions)
        await closeAudio(env,session.sessionId);
    } catch(error) {
      console.warn('room_moderation_audio_pending',error?.message);
      return fail('voice_moderation_unavailable',502,cors);
    }
  }
  const statements=[];
  if(action==='mute'||action==='unmute') {
    statements.push(env.DB.prepare(
      'UPDATE sharika_room_members SET muted=? WHERE room_id=? AND user_id=?'
    ).bind(action==='mute'?1:0,roomId,target.user_id));
  } else if(action==='remove_seat') {
    statements.push(env.DB.prepare(
      'UPDATE sharika_room_members SET seat_no=NULL,muted=0 '+
      'WHERE room_id=? AND user_id=?'
    ).bind(roomId,target.user_id));
  } else {
    statements.push(env.DB.prepare(
      'INSERT INTO sharika_room_bans(room_id,user_id,banned_until_ms) VALUES(?,?,?) '+
      'ON CONFLICT(room_id,user_id) DO UPDATE SET banned_until_ms=excluded.banned_until_ms'
    ).bind(roomId,target.user_id,action==='block'?ROOM_BLOCK_UNTIL_MS:Date.now()+ROOM_BAN_MS));
    statements.push(env.DB.prepare(
      'DELETE FROM sharika_room_members WHERE room_id=? AND user_id=?'
    ).bind(roomId,target.user_id));
    // Kicking or blocking an Admin revokes their grant before any rejoin.
    if(actorIsOwner)statements.push(env.DB.prepare(
      'DELETE FROM sharika_room_admins WHERE room_id=? AND user_id=?'
    ).bind(roomId,target.user_id));
  }
  if(action==='block'){
    statements.push(env.DB.prepare(
      "INSERT INTO sharika_room_block_audit(room_id,actor_uid,target_uid,action) VALUES(?,?,?,'block')"
    ).bind(roomId,uid,target.user_id));
  }else{
    statements.push(env.DB.prepare(
      'INSERT INTO sharika_room_moderation_audit(room_id,actor_uid,target_uid,action) '+
      'VALUES(?,?,?,?)'
    ).bind(roomId,uid,target.user_id,action));
  }
  await env.DB.batch(statements);
  if(action!=='unmute' && roomDO)
    await roomDO.withdrawUser(target.user_id,action==='kick'||action==='block');

  return reply({
    ok:true,room_id:roomId,target_public_id:publicId,action,
    banned_for_seconds:action==='kick'?600:null,
    blocked_until_unblocked:action==='block'
  },200,cors);
}

export async function handleRoomBanList({request,env,uid,room,roomId,reply,fail,cors}){
  if(request.method!=='GET')return fail('method_not_allowed',405,cors);
  if(room.owner_id!==uid && !await isRoomAdmin(env,roomId,uid))
    return fail('room_owner_only',403,cors);
  const found=await env.DB.prepare(
    'SELECT u.public_no,u.name,b.banned_until_ms FROM sharika_room_bans b '+
    'JOIN sharika_users u ON u.auth_uid=b.user_id '+
    'WHERE b.room_id=? AND b.banned_until_ms>? '+
    'ORDER BY b.banned_until_ms DESC LIMIT 100'
  ).bind(roomId,Date.now()).all();
  return reply({bans:(found.results||[]).map(x=>({
    public_id:String(x.public_no).padStart(8,'0'),
    name:x.name,blocked_until_unblocked:x.banned_until_ms>=ROOM_BLOCK_UNTIL_MS,
    banned_until_ms:x.banned_until_ms
  }))},200,cors);
}
