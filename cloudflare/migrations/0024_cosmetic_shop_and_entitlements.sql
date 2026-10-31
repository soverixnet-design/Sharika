-- Paid cosmetic inventory and Super Admin-only catalogue/grants.
-- Never debit or rewrite existing balances; past equipped styles are grandfathered
-- as legacy entitlements rather than being silently removed from old accounts.
CREATE TABLE IF NOT EXISTS sharika_cosmetics_catalog (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 3 AND 70),
  kind TEXT NOT NULL CHECK(kind IN ('frame_style','entry_style','medal_style','name_tag_style')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  art_key TEXT NOT NULL CHECK(length(art_key) BETWEEN 1 AND 70),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_cosmetic_inventory (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL REFERENCES sharika_cosmetics_catalog(id),
  source TEXT NOT NULL CHECK(source IN ('purchase','admin_grant','legacy')),
  request_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,item_id),
  UNIQUE(auth_uid,request_id)
);
CREATE TABLE IF NOT EXISTS sharika_cosmetic_equipped (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('frame_style','entry_style','medal_style','name_tag_style')),
  item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  equipped_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,kind)
);
CREATE INDEX IF NOT EXISTS sharika_cosmetic_inventory_item ON sharika_cosmetic_inventory(item_id);
INSERT OR IGNORE INTO sharika_cosmetics_catalog(id,kind,name,art_key,price_coins,active)
VALUES
('frame_style:phoenix-fire','frame_style','Phoenix Fire','phoenix-fire',1000,1),
('frame_style:ice-wings','frame_style','Ice Wings','ice-wings',1000,1),
('frame_style:royal-dragon','frame_style','Royal Dragon','royal-dragon',1000,1),
('frame_style:vip7','frame_style','Vip7','vip7',1000,1),
('frame_style:royal-gold','frame_style','Royal Gold','royal-gold',1000,1),
('frame_style:violet-love','frame_style','Violet Love','violet-love',1000,1),
('frame_style:ice-admin','frame_style','Ice Admin','ice-admin',1000,1),
('frame_style:golden-dragon','frame_style','Golden Dragon','golden-dragon',1000,1),
('frame_style:ice-dragon','frame_style','Ice Dragon','ice-dragon',1000,1),
('frame_style:violet-phoenix','frame_style','Violet Phoenix','violet-phoenix',1000,1),
('frame_style:castle-flag','frame_style','Castle Flag','castle-flag',1000,1),
('frame_style:lion-queen','frame_style','Lion Queen','lion-queen',1000,1),
('frame_style:phoenix-queen','frame_style','Phoenix Queen','phoenix-queen',1000,1),
('frame_style:tiger-queen','frame_style','Tiger Queen','tiger-queen',1000,1),
('entry_style:phoenix','entry_style','Phoenix','phoenix',1000,1),
('entry_style:dragon-queen','entry_style','Dragon Queen','dragon-queen',1000,1),
('entry_style:ice-king','entry_style','Ice King','ice-king',1000,1),
('entry_style:castle-flag','entry_style','Castle Flag','castle-flag',1000,1),
('entry_style:lion-queen','entry_style','Lion Queen','lion-queen',1000,1),
('entry_style:phoenix-queen','entry_style','Phoenix Queen','phoenix-queen',1000,1),
('entry_style:tiger-queen','entry_style','Tiger Queen','tiger-queen',1000,1),
('medal_style:bronze','medal_style','Bronze','bronze',1000,1),
('medal_style:silver','medal_style','Silver','silver',1000,1),
('medal_style:gold','medal_style','Gold','gold',1000,1),
('medal_style:top-host','medal_style','Top Host','top-host',1000,1),
('name_tag_style:legend','name_tag_style','Legend','legend',1000,1);
-- Preserve old saved selections, but nobody can select an unowned new item.
INSERT OR IGNORE INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id)
SELECT u.auth_uid,c.id,'legacy','legacy:'||c.id
FROM sharika_users u JOIN sharika_cosmetics_catalog c
  ON (c.kind='frame_style' AND c.art_key=u.frame_style)
  OR (c.kind='entry_style' AND c.art_key=u.entry_style)
  OR (c.kind='medal_style' AND c.art_key=u.medal_style)
  OR (c.kind='name_tag_style' AND c.art_key=u.name_tag_style);
INSERT OR IGNORE INTO sharika_cosmetic_equipped(auth_uid,kind,item_id)
SELECT i.auth_uid,c.kind,c.id FROM sharika_cosmetic_inventory i
JOIN sharika_cosmetics_catalog c ON c.id=i.item_id
WHERE i.source='legacy';
