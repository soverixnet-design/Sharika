-- Individually cut out from supplied 18316.mp4: no recording background,
-- no sound or altered privileges. Leave inactive until Super Admin approves
-- prices or issues free cosmetics. Existing tier artwork stays unchanged.
WITH RECURSIVE levels(n) AS (SELECT 2 UNION ALL SELECT n+1 FROM levels WHERE n<5)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'frame_style:vip-royal-frame-'||printf('%02d',n), 'frame_style',
       'VIP '||n||' Royal Frame', 'vip-royal-frame-'||printf('%02d',n),1000,0
FROM levels;

WITH RECURSIVE levels(n) AS (SELECT 4 UNION ALL SELECT n+1 FROM levels WHERE n<5)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'frame_style:svip-royal-frame-'||printf('%02d',n), 'frame_style',
       'SVIP '||n||' Royal Frame', 'svip-royal-frame-'||printf('%02d',n),1000,0
FROM levels;

WITH RECURSIVE levels(n) AS (SELECT 2 UNION ALL SELECT n+1 FROM levels WHERE n<5)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'medal_style:vip-royal-badge-'||printf('%02d',n), 'medal_style',
       'VIP '||n||' Royal Badge', 'vip-royal-badge-'||printf('%02d',n),1000,0
FROM levels;

WITH RECURSIVE levels(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM levels WHERE n<5)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'medal_style:svip-royal-badge-'||printf('%02d',n), 'medal_style',
       'SVIP '||n||' Royal Badge', 'svip-royal-badge-'||printf('%02d',n),1000,0
FROM levels;
