-- Sharika staging: real, authenticated support conversation history.
-- The original app design remains unchanged; no demo messages are seeded.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sharika_support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_support_by_user
  ON sharika_support_messages(user_id,id DESC);
CREATE INDEX IF NOT EXISTS sharika_support_rate
  ON sharika_support_messages(sender_uid,sender_role,created_at DESC);
