-- Room-only event/game banners; isolated from home banners, coins and profiles.
-- This migration must be applied to staging D1 before publishing the new Worker.
CREATE TABLE IF NOT EXISTS sharika_room_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 70),
  placement TEXT NOT NULL CHECK(placement IN ('game','event')),
  country_code TEXT NOT NULL DEFAULT '' CHECK(country_code='' OR
    (length(country_code)=2 AND country_code GLOB '[A-Z][A-Z]')),
  action TEXT NOT NULL DEFAULT 'none' CHECK(action IN ('none','games')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  image_base64 TEXT NOT NULL DEFAULT '',
  image_bytes INTEGER NOT NULL DEFAULT 0 CHECK(image_bytes BETWEEN 0 AND 360000),
  image_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_room_banners_public
  ON sharika_room_banners(active,placement,country_code,sort_order,id);
