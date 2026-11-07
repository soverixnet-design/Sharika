-- Room-scoped administrators live outside the legacy member role CHECK
-- so existing D1 member/owner rows and room membership remain untouched.
CREATE TABLE IF NOT EXISTS sharika_room_admins (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  granted_by_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS sharika_room_admins_user_idx
  ON sharika_room_admins(user_id);

CREATE TABLE IF NOT EXISTS sharika_room_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_room_admin_audit_room_time_idx
  ON sharika_room_admin_audit(room_id,created_at);
