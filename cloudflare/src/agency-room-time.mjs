// Verified presence heartbeats are bounded at 60 seconds and attributed only
// to a continuous visit in the same room and UTC day. A room switch, a first
// heartbeat, an offline gap, or a UTC rollover never manufactures activity.
const MAX_GAP_MS=60_000;

export function agencyRoomActivityStatements(db,uid,roomId,nowMs){
  if(!Number.isSafeInteger(nowMs)||nowMs<0||
    !(roomId===null||(typeof roomId==='string'&&/^[0-9]{8}$/.test(roomId))))
    throw Error('invalid_agency_presence');
  const utcDay=new Date(nowMs).toISOString().slice(0,10);
  const credit=roomId===null?null:db.prepare(
    'INSERT INTO sharika_agency_room_activity(user_uid,utc_day,room_id,active_seconds) '+
    'SELECT ?,?,?,CAST((?-c.last_seen_ms)/1000 AS INTEGER) '+
    'FROM sharika_agency_presence_cursor c '+
    'WHERE c.user_uid=? AND c.room_id=? AND c.utc_day=? '+
    'AND c.last_seen_ms BETWEEN ? AND ? '+
    'ON CONFLICT(user_uid,room_id,utc_day) DO UPDATE SET '+
    'active_seconds=sharika_agency_room_activity.active_seconds+excluded.active_seconds'
  ).bind(uid,utcDay,roomId,nowMs,uid,roomId,utcDay,nowMs-MAX_GAP_MS,nowMs-1000);
  const cursor=db.prepare(
    'INSERT INTO sharika_agency_presence_cursor(user_uid,room_id,utc_day,last_seen_ms) '+
    'VALUES(?,?,?,?) ON CONFLICT(user_uid) DO UPDATE SET '+
    'room_id=CASE WHEN excluded.last_seen_ms>sharika_agency_presence_cursor.last_seen_ms '+
    'THEN excluded.room_id ELSE sharika_agency_presence_cursor.room_id END,'+
    'utc_day=CASE WHEN excluded.last_seen_ms>sharika_agency_presence_cursor.last_seen_ms '+
    'THEN excluded.utc_day ELSE sharika_agency_presence_cursor.utc_day END,'+
    'last_seen_ms=MAX(excluded.last_seen_ms,sharika_agency_presence_cursor.last_seen_ms)'
  ).bind(uid,roomId,utcDay,nowMs);
  return credit?[credit,cursor]:[cursor];
}

export async function recordAgencyRoomActivity(db,uid,roomId,nowMs=Date.now()){
  // Prevent extra D1 writes for ordinary listeners. Owners and BD agents may
  // also be monitored, so role reports can show their real room participation.
  const role=await db.prepare(
    'SELECT 1 AS eligible FROM sharika_agency_hosts WHERE host_uid=? AND active=1 '+
    'UNION ALL SELECT 1 FROM sharika_families WHERE owner_uid=? AND status=\'active\' '+
    'UNION ALL SELECT 1 FROM sharika_bd_agents WHERE bd_uid=? AND active=1 LIMIT 1'
  ).bind(uid,uid,uid).first();
  if(!role)return false;
  await db.batch(agencyRoomActivityStatements(db,uid,roomId,nowMs));
  return true;
}
