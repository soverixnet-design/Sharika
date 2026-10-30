-- Staging-only public profile thumbnails (no broad Android photo permission).
-- Owner-authenticated writes; public users can see the user's chosen avatar.
CREATE TABLE IF NOT EXISTS sharika_user_avatars (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 120000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 90000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
