-- Allow 1-10 digit admin-assigned public aliases without changing canonical public_no.
-- Preserve all prior assignments and add hard database guards against ID collisions.
CREATE TABLE sharika_special_ids_1_to_10 (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  special_id TEXT NOT NULL UNIQUE
    CHECK(length(special_id) BETWEEN 1 AND 10 AND special_id NOT GLOB '*[^0-9]*'),
  frame TEXT NOT NULL DEFAULT 'neon' CHECK(frame IN ('neon')),
  expires_at TEXT,
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sharika_special_ids_1_to_10
  (auth_uid,special_id,frame,expires_at,assigned_by,created_at,updated_at)
SELECT auth_uid,special_id,frame,expires_at,assigned_by,created_at,updated_at
FROM sharika_special_ids;

DROP TABLE sharika_special_ids;
ALTER TABLE sharika_special_ids_1_to_10 RENAME TO sharika_special_ids;
CREATE INDEX sharika_special_ids_expiry_idx ON sharika_special_ids(expires_at);

-- A new alias cannot shadow any existing immutable real 8-digit member ID.
CREATE TRIGGER sharika_special_no_public_insert
BEFORE INSERT ON sharika_special_ids
WHEN length(NEW.special_id)=8 AND EXISTS (
  SELECT 1 FROM sharika_users
  WHERE public_no=CAST(NEW.special_id AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'special_id_conflicts_with_account_id');
END;

CREATE TRIGGER sharika_special_no_public_update
BEFORE UPDATE OF special_id ON sharika_special_ids
WHEN length(NEW.special_id)=8 AND EXISTS (
  SELECT 1 FROM sharika_users
  WHERE public_no=CAST(NEW.special_id AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'special_id_conflicts_with_account_id');
END;

-- Signups skip reserved candidate numbers; this guard also protects races.
CREATE TRIGGER sharika_user_no_reserved_special
BEFORE INSERT ON sharika_users
WHEN EXISTS (
  SELECT 1 FROM sharika_special_ids
  WHERE length(special_id)=8 AND
    CAST(special_id AS INTEGER)=NEW.public_no
)
BEGIN
  SELECT RAISE(ABORT,'public_id_reserved_as_special');
END;
