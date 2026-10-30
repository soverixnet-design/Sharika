import { DurableObject } from 'cloudflare:workers';

// One SQLite-backed coordinator per Sharika voice room.
// Only the authenticated Worker calls these RPC methods.
export class SharikaVoiceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS voice_sessions (' +
        'session_id TEXT PRIMARY KEY, uid TEXT NOT NULL, can_publish INTEGER NOT NULL, ' +
        'published INTEGER NOT NULL DEFAULT 0, track_name TEXT, last_seen INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS voice_sessions_by_user ON voice_sessions(uid)'
      );
      // A single dedicated coordinator records verified app presence. Room
      // coordinators continue using the existing voice_sessions table.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS app_presence (' +
        'uid TEXT PRIMARY KEY, room_id TEXT, last_seen INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS app_presence_seen ON app_presence(last_seen)'
      );
      // Room text chat is durable, server-authored and isolated by coordinator.
      // No unverified browser names or local demo messages are accepted.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_chat (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, ' +
        'public_id TEXT NOT NULL, display_name TEXT NOT NULL, body TEXT NOT NULL, ' +
        'request_id TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS room_chat_by_user ON room_chat(uid, id)'
      );
    });
  }

  prune() {
    // Expired sessions are not discoverable. Clients refresh their sessions
    // every 10 seconds; allow a generous grace period for mobile scheduling.
    this.ctx.storage.sql.exec(
      'DELETE FROM voice_sessions WHERE last_seen < ?', Date.now() - 90_000
    );
  }

  async register(uid, sessionId, canPublish) {
    this.prune();
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO voice_sessions ' +
      '(session_id,uid,can_publish,published,track_name,last_seen) VALUES(?,?,?,0,NULL,?)',
      sessionId, uid, canPublish ? 1 : 0, Date.now()
    );
    return true;
  }

  async owns(uid, sessionId) {
    const row = this.ctx.storage.sql.exec(
      'SELECT can_publish FROM voice_sessions WHERE uid=? AND session_id=? AND last_seen>=?',
      uid, sessionId, Date.now() - 90_000
    ).toArray()[0];
    return row ? { canPublish: !!row.can_publish } : null;
  }

  async markPublished(uid, sessionId, trackName) {
    const result = this.ctx.storage.sql.exec(
      'UPDATE voice_sessions SET published=1,track_name=?,last_seen=? ' +
      'WHERE session_id=? AND uid=? AND can_publish=1',
      trackName, Date.now(), sessionId, uid
    );
    return result.rowsWritten > 0;
  }

  async publications(excludeUid) {
    this.prune();
    return this.ctx.storage.sql.exec(
      'SELECT uid AS userId, session_id AS sessionId, track_name AS trackName ' +
      'FROM voice_sessions WHERE published=1 AND uid<>? AND last_seen>=? ' +
      'ORDER BY last_seen DESC LIMIT 32',
      excludeUid, Date.now() - 90_000
    ).toArray();
  }

  async permittedPublications(uid, requested) {
    this.prune();
    const result = [];
    for (const item of requested) {
      const row = this.ctx.storage.sql.exec(
        'SELECT session_id AS sessionId,track_name AS trackName ' +
        'FROM voice_sessions WHERE published=1 AND uid<>? AND session_id=? ' +
        'AND track_name=? AND last_seen>=?',
        uid, item.sessionId, item.trackName, Date.now() - 90_000
      ).toArray()[0];
      if (row) result.push(row);
    }
    return result;
  }

  async heartbeat(uid, sessionIds) {
    if (!Array.isArray(sessionIds) || sessionIds.length > 3) return false;
    for (const sessionId of sessionIds) {
      this.ctx.storage.sql.exec(
        'UPDATE voice_sessions SET last_seen=? WHERE uid=? AND session_id=?',
        Date.now(), uid, sessionId
      );
    }
    return true;
  }

  async forget(uid, sessionIds) {
    if (!Array.isArray(sessionIds) || sessionIds.length > 3) return false;
    for (const sessionId of sessionIds) {
      this.ctx.storage.sql.exec(
        'DELETE FROM voice_sessions WHERE uid=? AND session_id=?', uid, sessionId
      );
    }
    return true;
  }
  // Presence is touched by the authenticated Android app every 25 seconds.
  // Stale sessions expire after 90 seconds, even after a crash or network loss.
  async publishedFor(uid) {
    this.prune();
    return this.ctx.storage.sql.exec(
      'SELECT session_id AS sessionId FROM voice_sessions ' +
      'WHERE uid=? AND can_publish=1 AND published=1',uid
    ).toArray();
  }

  async withdrawUser(uid,forgetAll=false) {
    if(forgetAll) {
      this.ctx.storage.sql.exec('DELETE FROM voice_sessions WHERE uid=?',uid);
    } else {
      this.ctx.storage.sql.exec(
        'UPDATE voice_sessions SET published=0,track_name=NULL WHERE uid=?',uid
      );
    }
    return true;
  }

  // The Worker checks Firebase identity, profile status and D1 room membership
  // before reaching these methods. The Durable Object owns ordered messages.
  async roomChatRead(afterId) {
    const safeAfter = Number.isSafeInteger(afterId) && afterId >= 0 ? afterId : 0;
    const messages = this.ctx.storage.sql.exec(
      'SELECT id,public_id AS sender_id,display_name AS name,body,created_at_ms ' +
      'FROM room_chat WHERE id>? ORDER BY id DESC LIMIT 40', safeAfter
    ).toArray().reverse();
    return {messages};
  }

  async roomChatSend(uid, publicId, displayName, body, requestId) {
    const existing = this.ctx.storage.sql.exec(
      'SELECT id,uid,public_id AS sender_id,display_name AS name,body,created_at_ms ' +
      'FROM room_chat WHERE request_id=?', requestId
    ).toArray()[0];
    if (existing) {
      if (existing.uid !== uid || existing.body !== body)
        return {error:'message_request_conflict'};
      const {uid: _privateUid, ...message} = existing;
      return {message,duplicate:true};
    }
    const now = Date.now();
    const last = this.ctx.storage.sql.exec(
      'SELECT created_at_ms FROM room_chat WHERE uid=? ORDER BY id DESC LIMIT 1', uid
    ).toArray()[0];
    if (last && now - Number(last.created_at_ms) < 1500)
      return {error:'message_rate_limited'};
    this.ctx.storage.sql.exec(
      'INSERT INTO room_chat(uid,public_id,display_name,body,request_id,created_at_ms) ' +
      'VALUES(?,?,?,?,?,?)',uid,publicId,displayName,body,requestId,now
    );
    const id = Number(this.ctx.storage.sql.exec(
      'SELECT last_insert_rowid() AS id'
    ).toArray()[0].id);
    // Keep the most recent 200 messages per room, avoiding unbounded DO usage.
    this.ctx.storage.sql.exec(
      'DELETE FROM room_chat WHERE id < ' +
      '(SELECT id FROM room_chat ORDER BY id DESC LIMIT 1 OFFSET 199)'
    );
    return {message:{id,sender_id:publicId,name:displayName,body,created_at_ms:now},
      duplicate:false};
  }

  async presenceTouch(uid, roomId) {
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM app_presence WHERE last_seen < ?',now-90_000);
    this.ctx.storage.sql.exec(
      'INSERT INTO app_presence(uid,room_id,last_seen) VALUES(?,?,?) ' +
      'ON CONFLICT(uid) DO UPDATE SET room_id=excluded.room_id,last_seen=excluded.last_seen',
      uid,roomId,now
    );
    return true;
  }

  async presenceRoomCounts() {
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM app_presence WHERE last_seen < ?',now-90_000);
    const rows=this.ctx.storage.sql.exec(
      'SELECT room_id AS roomId,COUNT(*) AS onlineCount FROM app_presence ' +
      'WHERE room_id IS NOT NULL AND last_seen >= ? ' +
      'GROUP BY room_id ORDER BY room_id LIMIT 1000',now-90_000
    ).toArray();
    return Object.fromEntries(rows.map(r=>[r.roomId,Number(r.onlineCount)||0]));
  }

  async presenceStats() {
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM app_presence WHERE last_seen < ?',now-90_000);
    const row=this.ctx.storage.sql.exec(
      'SELECT COUNT(*) AS online_users,COUNT(DISTINCT room_id) AS live_rooms ' +
      'FROM app_presence WHERE last_seen >= ?',now-90_000
    ).toArray()[0];
    return {online_users:Number(row?.online_users)||0,
      live_rooms:Number(row?.live_rooms)||0,window_seconds:90};
  }

}
