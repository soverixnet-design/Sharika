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
}
