-- Independently managed public room wallpapers. Never mutate room-card covers.
CREATE TABLE IF NOT EXISTS sharika_room_theme_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  image_base64 TEXT NOT NULL DEFAULT '',
  image_bytes INTEGER NOT NULL DEFAULT 0 CHECK(image_bytes BETWEEN 0 AND 360000),
  image_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_room_theme_catalog_active
  ON sharika_room_theme_catalog(active,sort_order,id);
