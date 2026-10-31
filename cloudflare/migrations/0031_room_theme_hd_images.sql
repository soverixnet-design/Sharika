-- Staging-only HD room backgrounds. Keep the existing small card-cover images.
-- One bounded JPEG per room; this is an additive table and changes no wallets.
CREATE TABLE IF NOT EXISTS sharika_room_theme_images (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 600000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 450000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
