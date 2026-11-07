-- Independent room-entry lock; existing rooms remain open by default.
-- This never changes microphone seats, wallets, room owners or memberships.
CREATE TABLE IF NOT EXISTS sharika_room_access_locks (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  changed_by_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sharika_room_access_lock_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  locked INTEGER NOT NULL CHECK (locked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_room_access_lock_audit_room_time_idx
  ON sharika_room_access_lock_audit(room_id,created_at);
