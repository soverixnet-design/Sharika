-- Verified Sharika notifications and message unread receipts (isolated staging).
-- Notifications never debit or credit a wallet. Admin announcements require Super Admin.
CREATE TABLE IF NOT EXISTS sharika_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('official','event','reward','gift','system')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000),
  dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 5 AND 120),
  created_by TEXT REFERENCES sharika_users(auth_uid),
  read_at TEXT,
  push_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(push_status IN ('pending','sent','not_configured','no_device','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recipient_uid,dedupe_key)
);
CREATE INDEX IF NOT EXISTS sharika_notifications_inbox
  ON sharika_notifications(recipient_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_notifications_unread
  ON sharika_notifications(recipient_uid,read_at,id DESC);

CREATE TABLE IF NOT EXISTS sharika_push_devices (
  token TEXT PRIMARY KEY CHECK(length(token) BETWEEN 30 AND 512),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android' CHECK(platform='android'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_push_devices_uid
  ON sharika_push_devices(auth_uid,updated_at DESC);

CREATE TABLE IF NOT EXISTS sharika_message_reads (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  other_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_id>=0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,other_uid),
  CHECK(auth_uid<>other_uid)
);
