-- The 62 original Royal Role animation files are bundled with the staging APK.
-- Register them as grantable cosmetics without selling them or changing users.
-- Super Admin can give these to an eight-digit Sharika ID through Cosmetics.
-- Decorative titles on the art never grant actual administrator privileges.
WITH RECURSIVE role_numbers(n) AS (
  SELECT 1
  UNION ALL SELECT n+1 FROM role_numbers WHERE n<64
)
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
SELECT 'frame_style:role-frame-'||printf('%02d',n),
       'frame_style',
       'Royal Role Frame '||printf('%02d',n),
       'role-frame-'||printf('%02d',n),
       1000,0
FROM role_numbers WHERE n<=51 OR n>=54;
