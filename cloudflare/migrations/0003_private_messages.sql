-- Sharika staging: mutual-follow permission and private messages.
-- No demo users or fabricated conversations.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sharika_follows (
  follower_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  followed_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(follower_uid,followed_uid),
  CHECK(follower_uid <> followed_uid)
);
CREATE INDEX IF NOT EXISTS sharika_followers_by_user
  ON sharika_follows(followed_uid,created_at DESC);
CREATE TABLE IF NOT EXISTS sharika_private_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000),
  request_id TEXT NOT NULL UNIQUE CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(sender_uid <> recipient_uid)
);
CREATE INDEX IF NOT EXISTS sharika_messages_sender
  ON sharika_private_messages(sender_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_messages_recipient
  ON sharika_private_messages(recipient_uid,id DESC);
