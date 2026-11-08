-- Staff permissions may be time-limited. Existing staff rows retain their
-- current status until a Super Admin explicitly sets an expiration.
-- No user roles, coins, sessions or prior audit records are deleted.
ALTER TABLE sharika_admin_staff_accounts
  ADD COLUMN expires_at_ms INTEGER DEFAULT NULL
    CHECK(expires_at_ms IS NULL OR expires_at_ms>0);
CREATE INDEX IF NOT EXISTS sharika_admin_staff_access_expiry
  ON sharika_admin_staff_accounts(active,expires_at_ms);

-- Wallet writes must enforce expiry inside D1 itself even when a session was
-- authenticated immediately before expiry or a concurrent admin revocation.
DROP TRIGGER IF EXISTS sharika_staff_direct_recharge_limit;
CREATE TRIGGER sharika_staff_direct_recharge_limit
BEFORE INSERT ON sharika_admin_direct_recharges
WHEN EXISTS(SELECT 1 FROM sharika_admin_staff_accounts WHERE auth_uid=NEW.actor_uid)
BEGIN
  SELECT RAISE(ABORT,'staff_recharge_disabled')
    WHERE NOT EXISTS(
      SELECT 1 FROM sharika_admin_staff_accounts s
      WHERE s.auth_uid=NEW.actor_uid AND s.active=1
        AND (s.expires_at_ms IS NULL OR
          s.expires_at_ms>CAST(unixepoch('now') AS INTEGER)*1000)
        AND EXISTS(SELECT 1 FROM json_each(s.permissions_json)
                   WHERE value='coin_recharge')
    );
  SELECT RAISE(ABORT,'staff_daily_limit_exceeded')
    WHERE NEW.coins + COALESCE((
      SELECT SUM(x.coins) FROM sharika_admin_direct_recharges x
      WHERE x.actor_uid=NEW.actor_uid
        AND x.created_at>=date('now') AND x.created_at<datetime(date('now'),'+1 day')
    ),0) > (
      SELECT daily_coin_limit FROM sharika_admin_staff_accounts WHERE auth_uid=NEW.actor_uid
    );
END;
