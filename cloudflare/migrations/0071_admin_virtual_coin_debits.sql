-- Additive STAGING-only immutable receipts for Super Admin virtual-coin deductions.
-- Historical wallets, transactions and existing staff authorizations are retained.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_admin_coin_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_admin_coin_adjustments_recipient_time
  ON sharika_admin_coin_adjustments(recipient_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_admin_coin_adjustments_immutable_update
BEFORE UPDATE ON sharika_admin_coin_adjustments
BEGIN SELECT RAISE(ABORT,'admin_coin_adjustment_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_admin_coin_adjustments_immutable_delete
BEFORE DELETE ON sharika_admin_coin_adjustments
BEGIN SELECT RAISE(ABORT,'admin_coin_adjustment_immutable'); END;
