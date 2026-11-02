-- Preserve existing premium memberships and wallets.
-- The existing animated SVIP frames, medals and tags map to levels 1..8.
-- Older SVIP grants/purchases default to level 1 until a super-admin assigns another.
ALTER TABLE sharika_premium_memberships
  ADD COLUMN svip_level INTEGER NOT NULL DEFAULT 1 CHECK(svip_level BETWEEN 1 AND 8);

CREATE INDEX IF NOT EXISTS sharika_premium_active_svip
  ON sharika_premium_memberships(tier,expires_at_ms,svip_level);
