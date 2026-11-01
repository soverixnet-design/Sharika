-- User-supplied animated assets. Catalogued separately from verified roles.
-- Inactive until Super Admin sets appropriate coin prices or grants them.
-- No existing wallet, membership, equipment or inventory rows are changed.
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
VALUES
  ('frame_style:vip5-animated','frame_style','VIP5 Royal Wings','vip5-animated',1000,0),
  ('frame_style:noble-gold-microphone','frame_style','Noble Gold Microphone','noble-gold-microphone',1000,0);

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<8)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'frame_style:svip-frame-'||printf('%02d',n), 'frame_style',
       'SVIP '||n||' Animated Frame','svip-frame-'||printf('%02d',n),1000,0
FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<8)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'medal_style:svip-medal-'||printf('%02d',n), 'medal_style',
       'SVIP Animated Medal '||n,'svip-medal-'||printf('%02d',n),1000,0
FROM seq;

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<17)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'name_tag_style:svip-tag-'||printf('%02d',n), 'name_tag_style',
       'SVIP Nameplate '||n,'svip-tag-'||printf('%02d',n),1000,0
FROM seq;

-- Royal Role Frame artwork (from the third video) is bundled in the APK but
-- intentionally not seeded as a sellable item. A Super Admin must explicitly
-- create and grant each approved role-themed cosmetic from the Art dropdown.
