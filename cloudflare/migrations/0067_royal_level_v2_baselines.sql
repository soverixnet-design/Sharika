-- Grandfather the visible gift levels before introducing much slower
-- progression. Existing gift/coin history and premium entitlements are not
-- rewritten, and new users start with zero baseline.
CREATE TABLE IF NOT EXISTS sharika_royal_level_v2_baselines (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  sent_baseline_coins INTEGER NOT NULL CHECK(sent_baseline_coins>=0),
  received_baseline_coins INTEGER NOT NULL CHECK(received_baseline_coins>=0),
  old_wealth_level INTEGER NOT NULL CHECK(old_wealth_level>=1),
  old_charm_level INTEGER NOT NULL CHECK(old_charm_level>=1),
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A single migration-time snapshot freezes the old level starting point.
-- In particular, do not reset the existing user's wallet, awards or XP.
INSERT OR IGNORE INTO sharika_royal_level_v2_baselines
  (auth_uid,sent_baseline_coins,received_baseline_coins,old_wealth_level,old_charm_level)
SELECT u.auth_uid,
  COALESCE((SELECT SUM(e.quantity*e.price_coins) FROM sharika_gift_events e
            WHERE e.sender_uid=u.auth_uid),0) +
  COALESCE((SELECT SUM(e.value_coins) FROM sharika_bond_gift_events e
            WHERE e.sender_uid=u.auth_uid),0),
  COALESCE((SELECT SUM(e.quantity*e.price_coins) FROM sharika_gift_events e
            WHERE e.recipient_uid=u.auth_uid),0) +
  COALESCE((SELECT SUM(e.value_coins) FROM sharika_bond_gift_events e
            WHERE e.recipient_uid=u.auth_uid),0),
  MAX(1,u.wealth_level),MAX(1,u.charm_level)
FROM sharika_users u;
