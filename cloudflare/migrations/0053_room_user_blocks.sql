-- Additive, room-scoped Block/Unblock audit. Existing kick bans and wallet
-- balances are unchanged. A Block is stored in sharika_room_bans until
-- a verified Owner or Room Admin removes it.
CREATE TABLE IF NOT EXISTS sharika_room_block_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('block','unblock')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_room_block_audit_room_time
  ON sharika_room_block_audit(room_id,created_at DESC);
