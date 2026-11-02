-- Expand verified Super Admin / Finance recharge amount per transaction.
-- Previous receipts, ledger entries and staff limits remain intact.
-- D1 applies each migration atomically. Still cap user wallet at 1e12 in Worker.

CREATE TABLE sharika_manual_recharge_reviews_large (
  support_message_id INTEGER PRIMARY KEY REFERENCES sharika_support_messages(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  admin_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000000000),
  payment_method TEXT NOT NULL DEFAULT '',
  payment_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (status='approved' AND coins>=1
      AND length(payment_method) BETWEEN 2 AND 40
      AND length(payment_reference) BETWEEN 6 AND 120)
    OR
    (status='rejected' AND coins=0
      AND payment_method='' AND payment_reference=''
      AND length(note) BETWEEN 8 AND 250)
  )
);
INSERT INTO sharika_manual_recharge_reviews_large
  SELECT * FROM sharika_manual_recharge_reviews;
DROP TABLE sharika_manual_recharge_reviews;
ALTER TABLE sharika_manual_recharge_reviews_large
  RENAME TO sharika_manual_recharge_reviews;
CREATE UNIQUE INDEX uniq_sharika_manual_receipt
  ON sharika_manual_recharge_reviews(lower(payment_method),lower(payment_reference))
  WHERE status='approved';
CREATE TRIGGER sharika_manual_recharge_valid_request
  BEFORE INSERT ON sharika_manual_recharge_reviews
BEGIN
  SELECT RAISE(ABORT,'invalid_recharge_request')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_support_messages m
    WHERE m.id=NEW.support_message_id AND m.user_id=NEW.user_uid
      AND m.sender_role='user' AND m.body LIKE 'Recharge request · %'
  );
END;
CREATE TRIGGER sharika_manual_recharge_immutable_update
  BEFORE UPDATE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;
CREATE TRIGGER sharika_manual_recharge_immutable_delete
  BEFORE DELETE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;

CREATE TABLE sharika_admin_direct_recharges_large (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid,request_id)
);
INSERT INTO sharika_admin_direct_recharges_large
  SELECT * FROM sharika_admin_direct_recharges;
DROP TABLE sharika_admin_direct_recharges;
ALTER TABLE sharika_admin_direct_recharges_large
  RENAME TO sharika_admin_direct_recharges;
CREATE INDEX sharika_admin_direct_recharges_actor_date
  ON sharika_admin_direct_recharges(actor_uid,created_at DESC);

-- The staff permissions and same-day quota still apply to every staff grant.
CREATE TRIGGER sharika_staff_direct_recharge_limit
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
CREATE TRIGGER sharika_admin_direct_recharge_immutable_update
BEFORE UPDATE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;
CREATE TRIGGER sharika_admin_direct_recharge_immutable_delete
BEFORE DELETE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;
