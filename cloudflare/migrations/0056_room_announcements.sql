-- Room announcement: additive-only staging migration.
-- Existing rooms, members, wallets, rewards and chat remain unchanged.
CREATE TABLE IF NOT EXISTS sharika_room_announcements (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 280),
  updated_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
