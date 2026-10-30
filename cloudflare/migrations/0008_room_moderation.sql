-- Verified room-owner moderation only. Does not change wallet or identity data.
CREATE TABLE IF NOT EXISTS sharika_room_bans (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  banned_until_ms INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS sharika_room_bans_expiry ON sharika_room_bans(banned_until_ms);

CREATE TABLE IF NOT EXISTS sharika_room_moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('mute','unmute','remove_seat','kick')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_moderation_room_time
  ON sharika_room_moderation_audit(room_id,created_at);
