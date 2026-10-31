import { DurableObject } from 'cloudflare:workers';

// One SQLite-backed coordinator per Sharika voice room.
// Only the authenticated Worker calls these RPC methods.
export class SharikaVoiceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sharikaDb=env.DB;
    this.seatTasks=Promise.resolve();
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
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_entry_events ('+
        'id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, '+
        'public_id TEXT NOT NULL, display_name TEXT NOT NULL, '+
        'entry_style TEXT NOT NULL, created_at_ms INTEGER NOT NULL)'
      );
      // Short-lived seat emojis belong to their authenticated sender, not to
      // whichever user happens to occupy seat zero on another phone.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_seat_reactions ('+
        'id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, '+
        'public_id TEXT NOT NULL, emoji TEXT NOT NULL, '+
        'request_id TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_seat_locks (' +
        'seat_no INTEGER PRIMARY KEY CHECK(seat_no BETWEEN 1 AND 20), ' +
        'locked_at_ms INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_seat_invites (' +
        'invitee_uid TEXT PRIMARY KEY, inviter_uid TEXT NOT NULL, ' +
        'seat_no INTEGER NOT NULL, invited_at_ms INTEGER NOT NULL, ' +
        'expires_at_ms INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS room_seat_invites_expiry ' +
        'ON room_seat_invites(expires_at_ms)'
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
  // Serialize seat taking and owner locking through the SAME room coordinator.
  // D1 still enforces unique occupied seats; SQLite DO locks survive restarts.
  async withSeatGate(work) {
    const operation=this.seatTasks.catch(()=>{}).then(work);
    this.seatTasks=operation.catch(()=>{});
    return operation;
  }

  async lockedSeats() {
    return this.ctx.storage.sql.exec(
      'SELECT seat_no AS seatNo FROM room_seat_locks ORDER BY seat_no'
    ).toArray().map(row=>Number(row.seatNo));
  }

  async changeMemberSeat(roomId,uid,seat) {
    return this.withSeatGate(async()=>{
      if(seat!==null) {
        const locked=this.ctx.storage.sql.exec(
          'SELECT 1 AS locked FROM room_seat_locks WHERE seat_no=?',seat
        ).toArray()[0];
        if(locked)return {error:'seat_locked'};
      }
      const db=this.sharikaDb;
      if(seat!==null){
        // Any joined guest may claim an unlocked, empty seat without invite.
        // The same Durable Object gate serializes this with owner locking.
        const occupant=await db.prepare(
          'SELECT user_id FROM sharika_room_members WHERE room_id=? AND seat_no=?'
        ).bind(roomId,seat).first();
        if(occupant&&occupant.user_id!==uid)return {error:'seat_occupied'};
      }
      let changed;
      try{
        changed=await db.prepare(
          'UPDATE sharika_room_members SET seat_no=? WHERE room_id=? AND user_id=?'
        ).bind(seat,roomId,uid).run();
      }catch(error){
        if(seat!==null&&/UNIQUE constraint/i.test(String(error?.message)))
          return {error:'seat_occupied'};
        throw error;
      }
      if(!changed.meta?.changes)return {error:'join_room_first'};
      const member=await db.prepare(
        'SELECT * FROM sharika_room_members WHERE room_id=? AND user_id=?'
      ).bind(roomId,uid).first();
      this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE invitee_uid=?',uid);
      if(seat!==null)this.ctx.storage.sql.exec(
        'DELETE FROM room_seat_invites WHERE seat_no=?',seat
      );
      return {member};
    });
  }

  async changeSeatLock(roomId,seat,locked) {
    return this.withSeatGate(async()=>{
      if(locked) {
        const occupied=await this.sharikaDb.prepare(
          'SELECT user_id FROM sharika_room_members WHERE room_id=? AND seat_no=?'
        ).bind(roomId,seat).first();
        if(occupied)return {error:'seat_occupied'};
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO room_seat_locks(seat_no,locked_at_ms) VALUES(?,?)',
          seat,Date.now()
        );
        this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE seat_no=?',seat);
      } else {
        this.ctx.storage.sql.exec(
          'DELETE FROM room_seat_locks WHERE seat_no=?',seat
        );
      }
      return {locked_seats:await this.lockedSeats()};
    });
  }

  async dropSeatLocksAbove(seatCount) {
    return this.withSeatGate(async()=>{
      this.ctx.storage.sql.exec(
        'DELETE FROM room_seat_locks WHERE seat_no>?',seatCount
      );
      this.ctx.storage.sql.exec(
        'DELETE FROM room_seat_invites WHERE seat_no>?',seatCount
      );
      return true;
    });
  }

  // Room invitations expire after 2 minutes and are never accepted without
  // both the recipient's authenticated consent and a free, unlocked seat.
  async seatInviteSend(roomId,inviterUid,inviteeUid,seat) {
    return this.withSeatGate(async()=>{
      const now=Date.now();
      this.ctx.storage.sql.exec(
        'DELETE FROM room_seat_invites WHERE expires_at_ms<=?',now
      );
      if(this.ctx.storage.sql.exec(
        'SELECT 1 AS locked FROM room_seat_locks WHERE seat_no=?',seat
      ).toArray()[0])return {error:'seat_locked'};
      const occupied=await this.sharikaDb.prepare(
        'SELECT user_id FROM sharika_room_members WHERE room_id=? AND seat_no=?'
      ).bind(roomId,seat).first();
      if(occupied)return {error:'seat_occupied'};
      const current=this.ctx.storage.sql.exec(
        'SELECT invited_at_ms FROM room_seat_invites WHERE invitee_uid=?',inviteeUid
      ).toArray()[0];
      if(current&&now-Number(current.invited_at_ms)<15000)
        return {error:'invite_rate_limited'};
      this.ctx.storage.sql.exec(
        'INSERT INTO room_seat_invites(invitee_uid,inviter_uid,seat_no,invited_at_ms,expires_at_ms) ' +
        'VALUES(?,?,?,?,?) ON CONFLICT(invitee_uid) DO UPDATE SET ' +
        'inviter_uid=excluded.inviter_uid,seat_no=excluded.seat_no,' +
        'invited_at_ms=excluded.invited_at_ms,expires_at_ms=excluded.expires_at_ms',
        inviteeUid,inviterUid,seat,now,now+120000
      );
      return {seat_no:seat,invited_at_ms:now,expires_at_ms:now+120000};
    });
  }

  async seatInvitePending(uid) {
    this.ctx.storage.sql.exec(
      'DELETE FROM room_seat_invites WHERE expires_at_ms<=?',Date.now()
    );
    const invite=this.ctx.storage.sql.exec(
      'SELECT seat_no,invited_at_ms,expires_at_ms FROM room_seat_invites ' +
      'WHERE invitee_uid=?',uid
    ).toArray()[0];
    return {invite:invite||null};
  }

  async seatInviteRespond(roomId,uid,seat,accept) {
    return this.withSeatGate(async()=>{
      const invite=this.ctx.storage.sql.exec(
        'SELECT seat_no,expires_at_ms FROM room_seat_invites WHERE invitee_uid=?',uid
      ).toArray()[0];
      if(!invite||Number(invite.expires_at_ms)<=Date.now()||
         Number(invite.seat_no)!==seat)return {error:'invite_not_found'};
      if(!accept) {
        this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE invitee_uid=?',uid);
        return {accepted:false};
      }
      if(this.ctx.storage.sql.exec(
        'SELECT 1 AS locked FROM room_seat_locks WHERE seat_no=?',seat
      ).toArray()[0])return {error:'seat_locked'};
      const occupant=await this.sharikaDb.prepare(
        'SELECT user_id FROM sharika_room_members WHERE room_id=? AND seat_no=?'
      ).bind(roomId,seat).first();
      if(occupant)return {error:'seat_occupied'};
      const member=await this.sharikaDb.prepare(
        'SELECT seat_no FROM sharika_room_members WHERE room_id=? AND user_id=?'
      ).bind(roomId,uid).first();
      if(!member)return {error:'join_room_first'};
      if(member.seat_no!==null)return {error:'already_seated'};
      const result=await this.sharikaDb.prepare(
        'UPDATE sharika_room_members SET seat_no=? WHERE room_id=? AND user_id=? AND seat_no IS NULL'
      ).bind(seat,roomId,uid).run();
      if(!result.meta?.changes)return {error:'seat_occupied'};
      this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE invitee_uid=?',uid);
      this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE seat_no=?',seat);
      return {accepted:true,seat_no:seat};
    });
  }

  async seatInviteClear(uid) {
    this.ctx.storage.sql.exec('DELETE FROM room_seat_invites WHERE invitee_uid=?',uid);
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

  // Every room attendee reads the same server-authored entry events; join
  // animations cannot be forged with a client-only decorative style.
  async roomEntryAnnounce(uid,publicId,displayName,style) {
    if(!style)return {announced:false};
    const now=Date.now();
    const recent=this.ctx.storage.sql.exec(
      'SELECT created_at_ms FROM room_entry_events WHERE uid=? ORDER BY id DESC LIMIT 1',uid
    ).toArray()[0];
    if(recent && now-Number(recent.created_at_ms)<4000)return {announced:false};
    this.ctx.storage.sql.exec(
      'INSERT INTO room_entry_events(uid,public_id,display_name,entry_style,created_at_ms) VALUES(?,?,?,?,?)',
      uid,publicId,displayName,style,now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM room_entry_events WHERE id < '+
      '(SELECT id FROM room_entry_events ORDER BY id DESC LIMIT 1 OFFSET 99)'
    );
    return {announced:true};
  }
  async roomEntryRead(afterId) {
    const safeAfter=Number.isSafeInteger(afterId)&&afterId>=0?afterId:0;
    const events=this.ctx.storage.sql.exec(
      'SELECT id,public_id AS user_id,display_name AS name,entry_style,created_at_ms '+
      'FROM room_entry_events WHERE id>? AND created_at_ms>=? '+
      'ORDER BY id DESC LIMIT 30',safeAfter,Date.now()-30_000
    ).toArray().reverse();
    return {events};
  }

  async roomReactionSend(uid, publicId, emoji, requestId) {
    const previous=this.ctx.storage.sql.exec(
      'SELECT id,uid,public_id,emoji,created_at_ms FROM room_seat_reactions '+
      'WHERE request_id=?',requestId
    ).toArray()[0];
    if(previous){
      if(previous.uid!==uid||previous.emoji!==emoji)return {error:'reaction_request_conflict'};
      const {uid: _privateUid,...event}=previous;
      return {event,duplicate:true};
    }
    const now=Date.now();
    const recent=this.ctx.storage.sql.exec(
      'SELECT created_at_ms FROM room_seat_reactions WHERE uid=? ORDER BY id DESC LIMIT 1',uid
    ).toArray()[0];
    if(recent&&now-Number(recent.created_at_ms)<900)
      return {error:'reaction_rate_limited'};
    this.ctx.storage.sql.exec(
      'INSERT INTO room_seat_reactions(uid,public_id,emoji,request_id,created_at_ms) '+
      'VALUES(?,?,?,?,?)',uid,publicId,emoji,requestId,now
    );
    const id=Number(this.ctx.storage.sql.exec(
      'SELECT last_insert_rowid() AS id'
    ).toArray()[0].id);
    this.ctx.storage.sql.exec(
      'DELETE FROM room_seat_reactions WHERE id < '+
      '(SELECT id FROM room_seat_reactions ORDER BY id DESC LIMIT 1 OFFSET 99)'
    );
    return {event:{id,public_id:publicId,emoji,created_at_ms:now},duplicate:false};
  }
  async roomReactionRead(afterId) {
    const after=Number.isSafeInteger(afterId)&&afterId>=0?afterId:0;
    return {events:this.ctx.storage.sql.exec(
      'SELECT id,public_id,emoji,created_at_ms FROM room_seat_reactions '+
      'WHERE id>? AND created_at_ms>=? ORDER BY id DESC LIMIT 40',
      after,Date.now()-6_000
    ).toArray().reverse()};
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
