-- Country-scoped administration without splitting the shared D1 user database.
-- Apply on staging before enabling /api/v1/admin/countries.
CREATE TABLE IF NOT EXISTS sharika_country_settings (
  country_code TEXT PRIMARY KEY CHECK (country_code GLOB '[A-Z][A-Z]'),
  pinned_room_id TEXT NOT NULL DEFAULT '',
  notice TEXT NOT NULL DEFAULT '' CHECK (length(notice) <= 280),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sharika_country_settings_audit (
  id INTEGER PRIMARY KEY,
  country_code TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  old_pinned_room_id TEXT NOT NULL,
  pinned_room_id TEXT NOT NULL,
  old_notice TEXT NOT NULL,
  notice TEXT NOT NULL,
  revision INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_country_settings_audit_country
 ON sharika_country_settings_audit(country_code, changed_at);
