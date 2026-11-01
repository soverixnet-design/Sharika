-- Additive, isolated Sharika staging Special IDs. Never changes permanent account IDs.
CREATE TABLE IF NOT EXISTS sharika_special_ids (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  special_id TEXT NOT NULL UNIQUE
    CHECK(length(special_id) BETWEEN 4 AND 7 AND special_id NOT GLOB '*[^0-9]*'),
  frame TEXT NOT NULL DEFAULT 'neon' CHECK(frame IN ('neon')),
  expires_at TEXT,
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_special_ids_expiry_idx ON sharika_special_ids(expires_at);
