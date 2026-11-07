-- Admin-published wallpapers shared by every room. A room's profile cover
-- remains in sharika_room_covers; these catalog images live in Media R2.
CREATE TABLE IF NOT EXISTS sharika_room_theme_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  media_path TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_room_theme_catalog_active_idx
  ON sharika_room_theme_catalog(active,sort_order,name);
