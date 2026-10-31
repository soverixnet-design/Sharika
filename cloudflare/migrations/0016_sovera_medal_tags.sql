-- Isolated Sharika staging; purely decorative original Sovera artwork choices.
-- No assigned staff role, VIP entitlement, or in-app coin charge is implied.
ALTER TABLE sharika_users ADD COLUMN medal_style TEXT NOT NULL DEFAULT ''
  CHECK (medal_style IN ('', 'bronze', 'silver', 'gold', 'top-host'));
ALTER TABLE sharika_users ADD COLUMN name_tag_style TEXT NOT NULL DEFAULT ''
  CHECK (name_tag_style IN ('', 'legend'));
