-- Staging-only bounded room-cover thumbnails until object storage is enabled.
-- Each room owns one JPEG preview (up to 90 KB). Only the verified room
-- owner can change it; the public read route serves image bytes, not DB data.
CREATE TABLE IF NOT EXISTS sharika_room_covers (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 120000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 90000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
