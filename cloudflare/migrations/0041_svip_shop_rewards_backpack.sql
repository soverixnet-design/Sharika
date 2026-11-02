-- SVIP 1–8: exactly 30-day paid passes, editable per-level prices and daily
-- rewards, and expiring Backpack cosmetics. No existing balances or receipts
-- are deleted or re-priced. Existing normal cosmetics remain permanent.
CREATE TABLE IF NOT EXISTS sharika_svip_levels (
  level INTEGER PRIMARY KEY CHECK(level BETWEEN 1 AND 8),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  daily_bonus_coins INTEGER NOT NULL CHECK(daily_bonus_coins BETWEEN 0 AND 1000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_svip_levels(level,price_coins,daily_bonus_coins,enabled)
VALUES (1,1000000,1000,1),(2,2000000,2000,1),
       (3,3000000,3000,1),(4,4000000,4000,1),
       (5,5000000,5000,1),(6,6000000,6000,1),
       (7,7000000,7000,1),(8,8000000,8000,1);
ALTER TABLE sharika_premium_purchases
  ADD COLUMN svip_level INTEGER NOT NULL DEFAULT 1
    CHECK(svip_level BETWEEN 1 AND 8);
ALTER TABLE sharika_cosmetic_inventory
  ADD COLUMN expires_at_ms INTEGER DEFAULT NULL
    CHECK(expires_at_ms IS NULL OR expires_at_ms>0);
CREATE INDEX IF NOT EXISTS sharika_svip_inventory_expiry
  ON sharika_cosmetic_inventory(auth_uid,expires_at_ms);
-- SVIP Entry is an authenticated arrival banner driven by the medal artwork,
-- not an invented video. Regular shop items are never granted by this migration.
WITH RECURSIVE levels(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM levels WHERE n<8)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'entry_style:svip-entry-'||printf('%02d',n),'entry_style',
       'SVIP '||n||' Royal Arrival','svip-entry-'||printf('%02d',n),1000,0
FROM levels;
-- Grandfather active paid/admin SVIP 1–8 into Backpack, respecting original
-- expiration and any existing user-selected equipment.
INSERT OR IGNORE INTO sharika_cosmetic_inventory
  (auth_uid,item_id,source,request_id,expires_at_ms)
SELECT p.auth_uid,c.id,CASE WHEN p.source='admin' THEN 'admin_grant' ELSE 'purchase' END,
       'svip:legacy:'||c.id,p.expires_at_ms
FROM sharika_premium_memberships p
JOIN sharika_cosmetics_catalog c ON c.id IN (
  'frame_style:svip-frame-'||printf('%02d',p.svip_level),
  'medal_style:svip-medal-'||printf('%02d',p.svip_level),
  'name_tag_style:svip-tag-'||printf('%02d',p.svip_level),
  'entry_style:svip-entry-'||printf('%02d',p.svip_level))
WHERE p.tier='svip' AND p.expires_at_ms>CAST(unixepoch('now') AS INTEGER)*1000;
INSERT OR IGNORE INTO sharika_cosmetic_equipped(auth_uid,kind,item_id)
SELECT i.auth_uid,c.kind,c.id FROM sharika_cosmetic_inventory i
JOIN sharika_cosmetics_catalog c ON c.id=i.item_id
WHERE i.request_id LIKE 'svip:legacy:%';
