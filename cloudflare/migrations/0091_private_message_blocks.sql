CREATE TABLE IF NOT EXISTS sharika_private_message_blocks (
  blocker_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  blocked_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  PRIMARY KEY (blocker_uid, blocked_uid),
  CHECK (blocker_uid <> blocked_uid)
);
CREATE INDEX IF NOT EXISTS sharika_message_blocks_by_target
  ON sharika_private_message_blocks(blocked_uid, blocker_uid);
