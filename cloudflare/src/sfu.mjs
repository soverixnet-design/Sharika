// Cloudflare Realtime SFU signaling for the isolated Sharika staging Worker.
// The SFU App Secret stays in Worker secrets; Android never receives it.
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const TRACK_NAME = /^microphone$/;
const MID = /^[0-9]{1,3}$/;

function description(raw, expected) {
  return raw && raw.type === expected && typeof raw.sdp === 'string' &&
    raw.sdp.length > 50 && raw.sdp.length < 16_000 &&
    raw.sdp.startsWith('v=0') ? { type: expected, sdp: raw.sdp } : null;
}
function sfuAvailable(env) {
  return !!(env.VOICE_ROOMS && env.REALTIME_SFU_APP_ID && env.REALTIME_SFU_APP_SECRET);
}
async function sfu(env, method, path, data) {
  const url = 'https://rtc.live.cloudflare.com/v1/apps/' +
    encodeURIComponent(env.REALTIME_SFU_APP_ID) + path;
  const result = await fetch(url, {
    method,
    headers: {
      'Authorization': 'Bearer ' + env.REALTIME_SFU_APP_SECRET,
      'Content-Type': 'application/json'
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(15000)
  });
  if (!result.ok) {
    console.error('sharika_sfu_error', result.status, path);
    throw new Error('sfu_upstream_unavailable');
  }
  const value = await result.json();
  if (value.errorCode || value.errorDescription || value.error) {
    console.error('sharika_sfu_resource_error', path);
    throw new Error('sfu_upstream_unavailable');
  }
  return value;
}
function cleanSid(x) { return typeof x === 'string' && SESSION_ID.test(x) ? x : null; }
function checkTracks(result, size) {
  if (!result || !Array.isArray(result.tracks) || result.tracks.length !== size ||
      result.tracks.some(t => t.errorCode || t.errorDescription || t.error)) {
    throw new Error('sfu_track_unavailable');
  }
  return result;
}

export async function handleVoiceOperation({
  request, env, room, member, uid, roomId, operation,
  reply, fail, cors, readBody
}) {
  const canPublish = room.owner_id === uid ||
    (member.seat_no !== null && Number(member.muted) === 0);
  if (operation === 'config' && request.method === 'GET') {
    if (sfuAvailable(env))
      return reply({provider:'cloudflare_sfu', publish:canPublish}, 200, cors);
    if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && /^wss:\/\//.test(env.LIVEKIT_URL || ''))
      return reply({provider:'livekit',publish:canPublish}, 200, cors);
    return fail('voice_not_configured', 503, cors);
  }
  if (!sfuAvailable(env)) return fail('voice_not_configured', 503, cors);
  const doRoom = env.VOICE_ROOMS.getByName('sharika:' + roomId);
  if (operation === 'session' && request.method === 'POST') {
    const body = await readBody(request);
    if (body.mode !== 'publish' && body.mode !== 'subscribe')
      return fail('invalid_voice_mode', 400, cors);
    if (body.mode === 'publish' && !canPublish) return fail('voice_publish_forbidden',403,cors);
    const made = await sfu(env, 'POST', '/sessions/new');
    const sessionId = cleanSid(made.sessionId);
    if (!sessionId) return fail('sfu_invalid_session', 502, cors);
    await doRoom.register(uid, sessionId, body.mode === 'publish');
    return reply({sessionId, publish:body.mode === 'publish'},201,cors);
  }
  if (operation === 'publications' && request.method === 'GET') {
    return reply({publications:await doRoom.publications(uid)},200,cors);
  }
  if (operation === 'heartbeat' && request.method === 'POST') {
    const body = await readBody(request);
    if (!Array.isArray(body.sessionIds) || body.sessionIds.length > 3 ||
        !body.sessionIds.every(cleanSid)) return fail('invalid_sessions',400,cors);
    await doRoom.heartbeat(uid, body.sessionIds);
    return reply({ok:true},200,cors);
  }
  if (operation === 'leave' && request.method === 'POST') {
    const body = await readBody(request);
    if (!Array.isArray(body.sessionIds) || body.sessionIds.length > 3 ||
        !body.sessionIds.every(cleanSid)) return fail('invalid_sessions',400,cors);
    // A publisher disappears immediately from room discovery. WebRTC transport
    // stops when its local PeerConnection is closed by the caller.
    await doRoom.forget(uid,body.sessionIds);
    return reply({ok:true},200,cors);
  }

  const body = await readBody(request);
  const sessionId = cleanSid(body.sessionId);
  if (!sessionId) return fail('invalid_session',400,cors);
  const owned = await doRoom.owns(uid,sessionId);
  if (!owned) return fail('voice_session_not_found',403,cors);
  if (operation === 'publish' && request.method === 'POST') {
    if (!canPublish || !owned.canPublish) return fail('voice_publish_forbidden',403,cors);
    const sessionDescription = description(body.sessionDescription,'offer');
    if (!sessionDescription || !MID.test(body.mid || '') ||
        !TRACK_NAME.test(body.trackName || '')) return fail('invalid_voice_offer',400,cors);
    const response=checkTracks(await sfu(env,'POST',
      '/sessions/'+sessionId+'/tracks/new',{
        sessionDescription,
        tracks:[{location:'local',mid:body.mid,trackName:'microphone'}]
      }),1);
    if (!description(response.sessionDescription,'answer'))
      return fail('sfu_invalid_answer',502,cors);
    await doRoom.markPublished(uid,sessionId,'microphone');
    return reply({sessionDescription:response.sessionDescription},200,cors);
  }
  if (operation === 'subscribe' && request.method === 'POST') {
    const desired = body.publications;
    if (!Array.isArray(desired) || desired.length === 0 || desired.length > 8 ||
        desired.some(x => !x || !cleanSid(x.sessionId) || !TRACK_NAME.test(x.trackName || '')))
      return fail('invalid_subscriptions',400,cors);
    const unique=new Map(desired.map(x=>[x.sessionId+':'+x.trackName,x]));
    if (unique.size !== desired.length) return fail('duplicate_subscriptions',400,cors);
    const permitted=await doRoom.permittedPublications(uid,desired);
    if (permitted.length !== desired.length) return fail('voice_publication_forbidden',403,cors);
    const response=checkTracks(await sfu(env,'POST','/sessions/'+sessionId+'/tracks/new',{
      tracks: permitted.map(x=>({location:'remote',sessionId:x.sessionId,trackName:x.trackName}))
    }),permitted.length);
    if (!description(response.sessionDescription,'offer'))
      return fail('sfu_invalid_offer',502,cors);
    return reply({sessionDescription:response.sessionDescription,
      tracks:response.tracks.map((x,i)=>({
        mid:x.mid,
        sessionId:permitted[i].sessionId,
        userId:desired[i].userId || ''
      }))},200,cors);
  }
  if (operation === 'renegotiate' && request.method === 'PUT') {
    const sessionDescription = description(body.sessionDescription,'answer');
    if (!sessionDescription) return fail('invalid_voice_answer',400,cors);
    await sfu(env,'PUT','/sessions/'+sessionId+'/renegotiate',{sessionDescription});
    return reply({ok:true},200,cors);
  }
  return fail('not_found',404,cors);
}
