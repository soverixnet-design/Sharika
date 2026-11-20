-- Shared public directory only. Run on the existing staging identity D1 bound
-- as SHARIKA_ID_DB by both Workers, NOT on the Play wallet D1.
-- Never copy coins, diamonds, birthdates, admin roles, messages or gift ledgers.
CREATE TABLE IF NOT EXISTS sharika_global_public_profiles (
  public_no INTEGER PRIMARY KEY REFERENCES sharika_public_id_registry(public_no),
  auth_uid TEXT NOT NULL UNIQUE,
  source_environment TEXT NOT NULL CHECK(source_environment IN ('staging','play_virtual')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  country TEXT NOT NULL DEFAULT '',
  pic TEXT,
  cover TEXT,
  wealth_level INTEGER NOT NULL DEFAULT 1,
  charm_level INTEGER NOT NULL DEFAULT 1,
  frame_style TEXT NOT NULL DEFAULT '',
  entry_style TEXT NOT NULL DEFAULT '',
  medal_style TEXT NOT NULL DEFAULT '',
  name_tag_style TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('active','blocked','deleted')),
  profile_updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_global_profiles_active_name
  ON sharika_global_public_profiles(status,name);
