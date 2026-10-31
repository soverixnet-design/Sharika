-- Super-Admin-controlled banner metadata, no wallet or gift balance changes.
CREATE TABLE IF NOT EXISTS sharika_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  subtitle TEXT NOT NULL DEFAULT '' CHECK(length(subtitle)<=160),
  emoji TEXT NOT NULL DEFAULT '🎉' CHECK(length(emoji)<=12),
  color_a TEXT NOT NULL DEFAULT '#9b4dff',
  color_b TEXT NOT NULL DEFAULT '#ff3dc8',
  action TEXT NOT NULL DEFAULT 'none' CHECK(action IN ('none','daily','recharge','rank','invite')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
