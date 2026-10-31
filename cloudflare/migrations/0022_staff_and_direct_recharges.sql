-- Staging-only staff panel accounts and auditable administrator coin credits.
-- Firebase owns credentials; no passwords or refresh tokens are stored in D1.
-- This migration does not create staff users, change balances or grant permissions.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_admin_staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL UNIQUE CHECK(length(auth_uid) BETWEEN 20 AND 190),
  login_email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(login_email) BETWEEN 6 AND 254),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  permissions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(permissions_json) AND json_type(permissions_json)='array'),
  daily_coin_limit INTEGER NOT NULL DEFAULT 0 CHECK(daily_coin_limit BETWEEN 0 AND 10000000),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sharika_admin_direct_recharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_admin_direct_recharges_actor_date
  ON sharika_admin_direct_recharges(actor_uid,created_at DESC);

-- Even if two staff requests arrive simultaneously, the insert trigger checks
-- the already-committed same-day spend inside the atomic D1 write transaction.
CREATE TRIGGER IF NOT EXISTS sharika_staff_direct_recharge_limit
BEFORE INSERT ON sharika_admin_direct_recharges
WHEN EXISTS(SELECT 1 FROM sharika_admin_staff_accounts WHERE auth_uid=NEW.actor_uid)
BEGIN
  SELECT RAISE(ABORT,'staff_recharge_disabled')
    WHERE NOT EXISTS(
      SELECT 1 FROM sharika_admin_staff_accounts s
      WHERE s.auth_uid=NEW.actor_uid AND s.active=1
        AND EXISTS(SELECT 1 FROM json_each(s.permissions_json) WHERE value='coin_recharge')
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

CREATE TRIGGER IF NOT EXISTS sharika_admin_direct_recharge_immutable_update
BEFORE UPDATE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_admin_direct_recharge_immutable_delete
BEFORE DELETE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;
