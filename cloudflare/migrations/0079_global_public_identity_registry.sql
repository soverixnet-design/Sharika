-- Run on the staging D1 FIRST; the same DB is bound to both Workers as
-- SHARIKA_ID_DB. This migration does not copy wallets, rooms or admin roles.
-- It preserves EVERY old staging public ID for the same Firebase auth UID.
CREATE TABLE IF NOT EXISTS sharika_public_id_registry (
  public_no INTEGER PRIMARY KEY CHECK (public_no BETWEEN 10000001 AND 99999999),
  auth_uid TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL CHECK (origin IN ('staging','play_virtual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sharika_public_id_registry(public_no,auth_uid,origin)
  SELECT public_no,auth_uid,'staging' FROM sharika_users
  WHERE NOT EXISTS (SELECT 1 FROM sharika_public_id_registry r
                    WHERE r.auth_uid=sharika_users.auth_uid);

-- A Play-only canonical number is not in staging's sharika_users table.
-- Protect it from later being granted as a custom Special ID in staging.
CREATE TRIGGER IF NOT EXISTS sharika_global_id_blocks_new_special
BEFORE INSERT ON sharika_special_ids
WHEN EXISTS (SELECT 1 FROM sharika_public_id_registry
             WHERE public_no=CAST(NEW.special_id AS INTEGER))
BEGIN SELECT RAISE(ABORT,'global_public_id_reserved'); END;
CREATE TRIGGER IF NOT EXISTS sharika_global_id_blocks_changed_special
BEFORE UPDATE OF special_id ON sharika_special_ids
WHEN EXISTS (SELECT 1 FROM sharika_public_id_registry
             WHERE public_no=CAST(NEW.special_id AS INTEGER))
BEGIN SELECT RAISE(ABORT,'global_public_id_reserved'); END;
CREATE TRIGGER IF NOT EXISTS sharika_global_id_blocks_reserved_special
BEFORE INSERT ON sharika_public_id_registry
WHEN EXISTS (SELECT 1 FROM sharika_special_ids
             WHERE special_id=CAST(NEW.public_no AS TEXT))
BEGIN SELECT RAISE(ABORT,'special_id_reserved'); END;
