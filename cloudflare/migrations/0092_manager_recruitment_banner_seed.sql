-- Non-financial recruiting banners. Intent-only form is verified via Sharika
-- /api/v1/role-applications; selection does not create any administrative role.
-- Keep action='none' until the historical banner CHECK is safely migrated:
-- the Android client maps these exact recruitment titles to the vetted form.
INSERT INTO sharika_banners
  (title,subtitle,emoji,color_a,color_b,action,sort_order,active)
SELECT 'ম্যানেজার নিয়োগ চলছে',
       'Sharika Global Management Team · আবেদন করুন',
       '👑','#071B3C','#D9A74D','none',0,1
WHERE NOT EXISTS (
  SELECT 1 FROM sharika_banners WHERE title='ম্যানেজার নিয়োগ চলছে'
);

INSERT INTO sharika_banners
  (title,subtitle,emoji,color_a,color_b,action,sort_order,active)
SELECT 'Country Manager Recruitment',
       'Lead your country community · Apply for official review',
       '🌍','#122448','#BD893A','none',1,1
WHERE NOT EXISTS (
  SELECT 1 FROM sharika_banners WHERE title='Country Manager Recruitment'
);

-- The pre-existing Global Manager Recruitment image is kept in place.
-- Never modify published artwork, existing users, balances, or privileges.
