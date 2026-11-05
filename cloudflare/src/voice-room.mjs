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
      // An explicit room exit wins over delayed heartbeat requests from that
      // visit. A new authenticated /join clears this marker for the next visit.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS app_presence_departures (' +
        'uid TEXT NOT NULL, room_id TEXT NOT NULL, left_at INTEGER NOT NULL, ' +
        'PRIMARY KEY(uid,room_id))'
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
      // A fresh visit is a fresh transcript. Store per-user event boundaries
      // beside the room coordinator so reconnecting cannot replay history.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_visits ('+
        'uid TEXT PRIMARY KEY, chat_after_id INTEGER NOT NULL, '+
        'entry_after_id INTEGER NOT NULL, gift_after_id INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_music_state ('+
        'id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, '+
        'mode TEXT NOT NULL, track_id INTEGER, title TEXT NOT NULL, '+
        'url TEXT NOT NULL, controller_uid TEXT, started_at_ms INTEGER NOT NULL, '+
        'updated_at_ms INTEGER NOT NULL)'
      );
      // Only the dedicated library coordinator uses this small catalogue.
      // The Worker authenticates the Super Admin before any mutation.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS music_library ('+
        'id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, '+
        'url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, '+
        'created_at_ms INTEGER NOT NULL)'
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
      // Backward-compatible room controls live beside the room coordinator.
      // Existing D1 users, seats, coins and gift history are never migrated.
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_policy ('+
        'id INTEGER PRIMARY KEY CHECK(id=1), chat_mode TEXT NOT NULL DEFAULT \'anyone\', '+
        'mic_mode TEXT NOT NULL DEFAULT \'anyone\', '+
        'super_mic INTEGER NOT NULL DEFAULT 1, '+
        'password_salt TEXT, password_digest TEXT, revision INTEGER NOT NULL DEFAULT 1)'
      );
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO room_policy(id,chat_mode,mic_mode,super_mic) VALUES(1,'anyone','anyone',1)"
      );
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_password_attempts ('+
        'uid TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until_ms INTEGER NOT NULL)'
      );
    });
  }

  roomPolicyRead() {
    const row=this.ctx.storage.sql.exec(
      'SELECT chat_mode,mic_mode,super_mic,password_digest,revision FROM room_policy WHERE id=1'
    ).toArray()[0];
    return {chat_mode:row?.chat_mode||'anyone',mic_mode:row?.mic_mode||'anyone',
      super_mic:row?.super_mic!==0,password_required:!!row?.password_digest,
      revision:Number(row?.revision)||1};
  }

  async roomPolicyUpdate(change) {
    const old=this.ctx.storage.sql.exec('SELECT * FROM room_policy WHERE id=1').toArray()[0];
    if(!old)return {error:'room_policy_unavailable'};
    const modes=new Set(['anyone','admins','owner']);
    const chat=change.chat_mode===undefined?old.chat_mode:change.chat_mode;
    const mic=change.mic_mode===undefined?old.mic_mode:change.mic_mode;
    const superMic=change.super_mic===undefined?!!old.super_mic:change.super_mic;
    if(!modes.has(chat)||!modes.has(mic)||typeof superMic!=='boolean')
      return {error:'invalid_room_policy'};
    let salt=old.password_salt,digest=old.password_digest;
    if(change.password_action==='clear'){salt=null;digest=null;}
    else if(change.password_action==='set'){
      if(typeof change.password!=='string'||!/^[0-9]{4,12}$/.test(change.password))
        return {error:'invalid_room_password'};
      const random=crypto.getRandomValues(new Uint8Array(16));
      salt=Array.from(random,x=>x.toString(16).padStart(2,'0')).join('');
      digest=await this.roomPasswordDigest(change.password,random);
    }else if(change.password_action!==undefined&&change.password_action!=='keep')
      return {error:'invalid_room_password_action'};
    this.ctx.storage.sql.exec(
      'UPDATE room_policy SET chat_mode=?,mic_mode=?,super_mic=?,password_salt=?, '+
      'password_digest=?,revision=revision+1 WHERE id=1',
      chat,mic,superMic?1:0,salt,digest
    );
    return {ok:true,...this.roomPolicyRead()};
  }

  async roomPasswordDigest(password,saltBytes){
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),
      'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,
      hash:'SHA-256',iterations:100000},key,256);
    return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
  }

  async roomPasswordCheck(uid,password){
    const row=this.ctx.storage.sql.exec(
      'SELECT password_salt,password_digest FROM room_policy WHERE id=1'
    ).toArray()[0];
    if(!row?.password_digest)return {allowed:true};
    const now=Date.now();
    const attempts=this.ctx.storage.sql.exec(
      'SELECT failures,blocked_until_ms FROM room_password_attempts WHERE uid=?',uid
    ).toArray()[0];
    if(Number(attempts?.blocked_until_ms)>now)
      return {allowed:false,error:'room_password_rate_limited',
        retry_after_seconds:Math.ceil((attempts.blocked_until_ms-now)/1000)};
    if(typeof password!=='string'||!/^[0-9]{4,12}$/.test(password))
      return {allowed:false,error:'room_password_required'};
    const salt=Uint8Array.from(row.password_salt.match(/../g),h=>parseInt(h,16));
    const actual=await this.roomPasswordDigest(password,salt);
    let difference=0;
    for(let i=0;i<row.password_digest.length;i++)
      difference|=row.password_digest.charCodeAt(i)^actual.charCodeAt(i);
    if(!difference){
      this.ctx.storage.sql.exec('DELETE FROM room_password_attempts WHERE uid=?',uid);
      return {allowed:true};
    }
    const failures=Number(attempts?.failures)||0;
    const next=failures+1;
    this.ctx.storage.sql.exec(
      'INSERT INTO room_password_attempts(uid,failures,blocked_until_ms) VALUES(?,?,?) '+
      'ON CONFLICT(uid) DO UPDATE SET failures=excluded.failures,blocked_until_ms=excluded.blocked_until_ms',
      uid,next>=5?0:next,next>=5?now+5*60*1000:0
    );
    return {allowed:false,error:'room_password_incorrect'};
  }

  prune() {
    // Expired sessions are not discoverable. Clients refresh their sessions
    // every 8 seconds. Allow mobile/WebView scheduling grace; subscribers
    // isolate failed remote tracks instead of waiting for this TTL to expire.
    this.ctx.storage.sql.exec(
      'DELETE FROM voice_sessions WHERE last_seen < ?', Date.now() - 60_000
    );
  }

  async register(uid, sessionId, canPublish, requiresReady=false) {
    this.prune();
    // Only one microphone publication per authenticated user in this room.
    // Closing or reconnecting the app may skip /leave: evict the old record
    // before a new publisher can be offered to other participants.
    if (canPublish) this.ctx.storage.sql.exec(
      'DELETE FROM voice_sessions WHERE uid=? AND can_publish=1',uid
    );
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO voice_sessions ' +
      '(session_id,uid,can_publish,published,track_name,last_seen) VALUES(?,?,?,0,?,?)',
      sessionId, uid, canPublish ? 1 : 0,
      canPublish&&requiresReady?'pending_ready':null,Date.now()
    );
    return true;
  }

  async owns(uid, sessionId) {
    const row = this.ctx.storage.sql.exec(
      'SELECT can_publish,track_name FROM voice_sessions WHERE uid=? AND session_id=? AND last_seen>=?',
      uid, sessionId, Date.now() - 60_000
    ).toArray()[0];
    return row ? {canPublish:!!row.can_publish,
      requiresReady:row.track_name==='pending_ready'} : null;
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
      excludeUid, Date.now() - 60_000
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
        uid, item.sessionId, item.trackName, Date.now() - 60_000
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

  // Lock all available seats in one room gate; seated guests are not ejected.
  async changeAllSeatLocks(roomId,seatCount,locked) {
    return this.withSeatGate(async()=>{
      if(!Number.isInteger(seatCount)||seatCount<1||seatCount>20)
        return {error:'invalid_seat_count'};
      if(!locked) {
        this.ctx.storage.sql.exec('DELETE FROM room_seat_locks');
        return {locked_seats:[],skipped_occupied:[]};
      }
      const rows=await this.sharikaDb.prepare(
        'SELECT seat_no FROM sharika_room_members WHERE room_id=? AND seat_no IS NOT NULL'
      ).bind(roomId).all();
      const occupied=new Set((rows.results||[]).map(row=>Number(row.seat_no)));
      const skipped=[];
      for(let seat=1;seat<=seatCount;seat++) {
        if(occupied.has(seat)) {
          skipped.push(seat);
          continue;
        }
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO room_seat_locks(seat_no,locked_at_ms) VALUES(?,?)',
          seat,Date.now()
        );
        this.ctx.storage.sql.exec(
          'DELETE FROM room_seat_invites WHERE seat_no=?',seat
        );
      }
      return {locked_seats:await this.lockedSeats(),skipped_occupied:skipped};
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
  async beginRoomVisit(uid,latestGiftId) {
    const lastChat=this.ctx.storage.sql.exec(
      'SELECT COALESCE(MAX(id),0) AS id FROM room_chat'
    ).toArray()[0];
    const lastEntry=this.ctx.storage.sql.exec(
      'SELECT COALESCE(MAX(id),0) AS id FROM room_entry_events'
    ).toArray()[0];
    const giftAfter=Number.isSafeInteger(latestGiftId)&&latestGiftId>=0?latestGiftId:0;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO room_visits(uid,chat_after_id,entry_after_id,gift_after_id) '+
      'VALUES(?,?,?,?)',uid,Number(lastChat.id)||0,Number(lastEntry.id)||0,giftAfter
    );
    return {joined:true};
  }

  async endRoomVisit(uid) {
    this.ctx.storage.sql.exec('DELETE FROM room_visits WHERE uid=?',uid);
    return {left:true};
  }

  async roomGiftAfter(uid) {
    const row=this.ctx.storage.sql.exec(
      'SELECT gift_after_id AS id FROM room_visits WHERE uid=?',uid
    ).toArray()[0];
    return row?Number(row.id):null;
  }

  async musicLibraryList(includeInactive=false) {
    const entries=this.ctx.storage.sql.exec(
      'SELECT id,title,url,active,created_at_ms FROM music_library '+
      (includeInactive?'':'WHERE active=1 ')+
      'ORDER BY id DESC LIMIT 100'
    ).toArray();
    return {tracks:entries.map(item=>({...item,active:!!item.active}))};
  }

  async musicLibraryTrack(trackId) {
    const row=this.ctx.storage.sql.exec(
      'SELECT id,title,url FROM music_library WHERE id=? AND active=1',trackId
    ).toArray()[0];
    return row||null;
  }

  async musicLibraryCreate(title,url) {
    this.ctx.storage.sql.exec(
      'INSERT INTO music_library(title,url,active,created_at_ms) VALUES(?,?,1,?)',
      title,url,Date.now()
    );
    return this.musicLibraryList(true);
  }

  async musicLibraryUpdate(trackId,title,url,active) {
    this.ctx.storage.sql.exec(
      'UPDATE music_library SET title=?,url=?,active=? WHERE id=?',
      title,url,active?1:0,trackId
    );
    const changed=this.ctx.storage.sql.exec(
      'SELECT changes() AS count'
    ).toArray()[0];
    if(!changed?.count)return {error:'music_track_not_found'};
    return this.musicLibraryList(true);
  }

  async roomMusicRead() {
    let row=this.ctx.storage.sql.exec(
      'SELECT * FROM room_music_state WHERE id=1'
    ).toArray()[0];
    // A phone that crashes cannot leave an endless phantom MP3 broadcast.
    if(row?.mode==='local'&&Date.now()-row.updated_at_ms>25_000){
      this.ctx.storage.sql.exec(
        "UPDATE room_music_state SET mode='off',track_id=NULL,url='',title='',"+
        'controller_uid=NULL,revision=revision+1,updated_at_ms=? WHERE id=1',Date.now()
      );
      row=this.ctx.storage.sql.exec(
        'SELECT * FROM room_music_state WHERE id=1'
      ).toArray()[0];
    }
    return row?{revision:row.revision,mode:row.mode,track_id:row.track_id,
      title:row.title,url:row.url,started_at_ms:row.started_at_ms,
      updated_at_ms:row.updated_at_ms}:
      {revision:0,mode:'off',track_id:null,title:'',url:'',
        started_at_ms:0,updated_at_ms:0};
  }

  async roomMusicSet(uid,action,track=null) {
    const existing=this.ctx.storage.sql.exec(
      'SELECT controller_uid,mode FROM room_music_state WHERE id=1'
    ).toArray()[0];
    if(action==='stop_self'){
      if(existing?.controller_uid!==uid)return this.roomMusicRead();
      return this.roomMusicSet(uid,'stop');
    }
    if(action==='heartbeat'){
      if(existing?.controller_uid!==uid||existing?.mode!=='local')
        return {error:'music_controller_changed'};
      this.ctx.storage.sql.exec(
        'UPDATE room_music_state SET updated_at_ms=? WHERE id=1',Date.now()
      );
      return this.roomMusicRead();
    }
    if(!['stop','library','local'].includes(action))return {error:'invalid_music_action'};
    const now=Date.now();
    const mode=action==='stop'?'off':action;
    const title=mode==='off'?'':String(track?.title||'');
    const url=mode==='library'?String(track?.url||''):'';
    const trackId=mode==='library'?Number(track?.id)||null:null;
    this.ctx.storage.sql.exec(
      'INSERT INTO room_music_state(id,revision,mode,track_id,title,url,controller_uid,'+
      'started_at_ms,updated_at_ms) VALUES(1,1,?,?,?,?,?,?,?) '+
      'ON CONFLICT(id) DO UPDATE SET revision=revision+1,mode=excluded.mode,'+
      'track_id=excluded.track_id,title=excluded.title,url=excluded.url,'+
      'controller_uid=excluded.controller_uid,started_at_ms=excluded.started_at_ms,'+
      'updated_at_ms=excluded.updated_at_ms',
      mode,trackId,title,url,mode==='off'?null:uid,now,now
    );
    return this.roomMusicRead();
  }

  async roomMusicStopFor(uid) {
    const existing=this.ctx.storage.sql.exec(
      'SELECT controller_uid FROM room_music_state WHERE id=1'
    ).toArray()[0];
    if(existing?.controller_uid===uid)return this.roomMusicSet(uid,'stop');
    return this.roomMusicRead();
  }

  async roomChatRead(uid,afterId) {
    const safeAfter = Number.isSafeInteger(afterId) && afterId >= 0 ? afterId : 0;
    const visit=this.ctx.storage.sql.exec(
      'SELECT chat_after_id AS id FROM room_visits WHERE uid=?',uid
    ).toArray()[0];
    if(!visit)return {messages:[]};
    const messages = this.ctx.storage.sql.exec(
      'SELECT id,public_id AS sender_id,display_name AS name,body,created_at_ms ' +
      'FROM room_chat WHERE id>? ORDER BY id DESC LIMIT 40',
      Math.max(safeAfter,Number(visit.id)||0)
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
    const now=Date.now();
    this.ctx.storage.sql.exec(
      'INSERT INTO room_entry_events(uid,public_id,display_name,entry_style,created_at_ms) VALUES(?,?,?,?,?)',
      uid,publicId,displayName,style||'standard',now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM room_entry_events WHERE id < '+
      '(SELECT id FROM room_entry_events ORDER BY id DESC LIMIT 1 OFFSET 99)'
    );
    return {announced:true};
  }
  async roomEntryRead(uid,afterId) {
    const safeAfter=Number.isSafeInteger(afterId)&&afterId>=0?afterId:0;
    const visit=this.ctx.storage.sql.exec(
      'SELECT entry_after_id AS id FROM room_visits WHERE uid=?',uid
    ).toArray()[0];
    if(!visit)return {events:[]};
    const events=this.ctx.storage.sql.exec(
      'SELECT id,public_id AS user_id,display_name AS name,entry_style,created_at_ms '+
      'FROM room_entry_events WHERE id>? AND created_at_ms>=? '+
      'ORDER BY id DESC LIMIT 30',Math.max(safeAfter,Number(visit.id)||0),Date.now()-30_000
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
    if(roomId!==null){
      const departed=this.ctx.storage.sql.exec(
        'SELECT room_id FROM app_presence_departures WHERE uid=? AND room_id=?',uid,roomId
      ).toArray()[0];
      if(departed?.room_id===roomId)return false;
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO app_presence(uid,room_id,last_seen) VALUES(?,?,?) ' +
      'ON CONFLICT(uid) DO UPDATE SET room_id=excluded.room_id,last_seen=excluded.last_seen',
      uid,roomId,now
    );
    return true;
  }
  async presenceJoin(uid,roomId){
    // Called only after the Worker has authenticated and authorized /join.
    this.ctx.storage.sql.exec(
      'DELETE FROM app_presence_departures WHERE uid=? AND room_id=?',uid,roomId
    );
    return this.presenceTouch(uid,roomId);
  }
  async presenceLeave(uid,roomId){
    const now=Date.now();
    this.ctx.storage.sql.exec(
      'DELETE FROM app_presence_departures WHERE left_at<?',now-86_400_000
    );
    this.ctx.storage.sql.exec(
      'INSERT INTO app_presence_departures(uid,room_id,left_at) VALUES(?,?,?) ' +
      'ON CONFLICT(uid,room_id) DO UPDATE SET left_at=excluded.left_at',
      uid,roomId,now
    );
    // Only clear this visit: a late /leave must not evict a different room.
    this.ctx.storage.sql.exec(
      'UPDATE app_presence SET room_id=NULL,last_seen=? WHERE uid=? AND room_id=?',
      now,uid,roomId
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

  // D1 membership records survive an Android process being killed. Expose a
  // verified, short-lived room roster so seats do not display dead sessions.
  async presenceRoomMembers(roomId) {
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM app_presence WHERE last_seen < ?',now-90_000);
    return this.ctx.storage.sql.exec(
      'SELECT uid FROM app_presence WHERE room_id=? AND last_seen>=? LIMIT 100',
      roomId,now-90_000
    ).toArray().map(row=>String(row.uid));
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
