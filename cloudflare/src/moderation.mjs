// Verified room owner moderation for isolated Sharika staging.
// Never trust client-supplied roles, seat occupancy or Firebase UID.
import { forceCloseMicrophone } from './sfu.mjs';

const PUBLIC_ID=/^[0-9]{8}$/;
const ACTIONS=new Set(['mute','unmute','remove_seat','kick']);
const ROOM_BAN_MS=10*60*1000;

export async function handleRoomModeration({
  request,env,uid,room,roomId,reply,fail,cors,readBody,
  closeAudio=forceCloseMicrophone
}) {
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  if(room.owner_id!==uid)return fail('room_owner_only',403,cors);
  const body=await readBody(request);
  const action=body.action;
  const publicId=body.target_public_id;
  if(!ACTIONS.has(action) || typeof publicId!=='string' || !PUBLIC_ID.test(publicId))
    return fail('invalid_moderation',400,cors);
  const target=await env.DB.prepare(
    'SELECT m.user_id,m.seat_no,m.muted,u.public_no FROM sharika_room_members m '+
    'JOIN sharika_users u ON u.auth_uid=m.user_id '+
    'WHERE m.room_id=? AND u.public_no=?'
  ).bind(roomId,Number(publicId)).first();
  if(!target)return fail('room_member_not_found',404,cors);
  if(target.user_id===uid)return fail('cannot_moderate_room_owner',403,cors);
  if(action!=='kick' && target.seat_no===null)
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
    ).bind(roomId,target.user_id,Date.now()+ROOM_BAN_MS));
    statements.push(env.DB.prepare(
      'DELETE FROM sharika_room_members WHERE room_id=? AND user_id=?'
    ).bind(roomId,target.user_id));
  }
  statements.push(env.DB.prepare(
    'INSERT INTO sharika_room_moderation_audit(room_id,actor_uid,target_uid,action) '+
    'VALUES(?,?,?,?)'
  ).bind(roomId,uid,target.user_id,action));
  await env.DB.batch(statements);
  if(action!=='unmute' && roomDO)
    await roomDO.withdrawUser(target.user_id,action==='kick');

  return reply({
    ok:true,room_id:roomId,target_public_id:publicId,action,
    banned_for_seconds:action==='kick'?600:0
  },200,cors);
}
