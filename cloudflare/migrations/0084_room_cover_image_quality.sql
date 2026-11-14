-- Align stored JPEG limits with the existing room cover upload API.
CREATE TABLE sharika_room_covers_hd (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 320000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 240000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sharika_room_covers_hd (room_id,mime,image_base64,image_bytes,version,updated_at)
SELECT room_id,mime,image_base64,image_bytes,version,updated_at FROM sharika_room_covers;
DROP TABLE sharika_room_covers;
ALTER TABLE sharika_room_covers_hd RENAME TO sharika_room_covers;
