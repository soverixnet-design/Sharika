// Persistent access control for joining voice rooms. This is distinct from
// per-seat microphone locks in the room Durable Object.
export async function readRoomAccessLock(db, roomId) {
  const row=await db.prepare(
    'SELECT locked,updated_at FROM sharika_room_access_locks WHERE room_id=?'
  ).bind(roomId).first();
  return {locked:Number(row?.locked)===1,updated_at:row?.updated_at||null};
}

export async function writeRoomAccessLock(db,roomId,actorUid,locked) {
  if(typeof locked!=='boolean')throw new TypeError('invalid_room_access_lock');
  await db.batch([
    db.prepare(
      "INSERT INTO sharika_room_access_locks(room_id,locked,changed_by_uid,updated_at) "+
      "VALUES(?,?,?,datetime('now')) ON CONFLICT(room_id) DO UPDATE SET "+
      "locked=excluded.locked,changed_by_uid=excluded.changed_by_uid,updated_at=datetime('now')"
    ).bind(roomId,locked?1:0,actorUid),
    db.prepare(
      'INSERT INTO sharika_room_access_lock_audit(room_id,actor_uid,locked) VALUES(?,?,?)'
    ).bind(roomId,actorUid,locked?1:0)
  ]);
  return readRoomAccessLock(db,roomId);
}
