-- Previous-week champions appear one at a time on verified app launches.
-- Settings belong to the server, not a device-local demo leaderboard.
CREATE TABLE IF NOT EXISTS sharika_opening_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  mode TEXT NOT NULL DEFAULT 'automatic' CHECK(mode IN ('automatic','custom')),
  duration_seconds INTEGER NOT NULL DEFAULT 10 CHECK(duration_seconds BETWEEN 3 AND 30),
  custom_user_id TEXT NOT NULL DEFAULT '',
  custom_title TEXT NOT NULL DEFAULT '',
  custom_subtitle TEXT NOT NULL DEFAULT '',
  custom_image_url TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_opening_settings(id) VALUES(1);

CREATE TABLE IF NOT EXISTS sharika_opening_cursors (
  viewer_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  week_key TEXT NOT NULL,
  opens INTEGER NOT NULL DEFAULT 0 CHECK(opens>=0),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
