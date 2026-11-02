-- Gallery-uploaded JPEG banners are independent of the home banner metadata.
-- Only verified Super Admin actions can write; GET returns a public JPEG.
CREATE TABLE IF NOT EXISTS sharika_banner_images (
  banner_id INTEGER PRIMARY KEY REFERENCES sharika_banners(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK(mime='image/jpeg'),
  image_base64 TEXT NOT NULL,
  -- Zero means removed; keep the version so re-upload invalidates caches.
  image_bytes INTEGER NOT NULL CHECK(image_bytes BETWEEN 0 AND 360000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
