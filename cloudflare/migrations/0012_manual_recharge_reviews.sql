-- Staging only: explicit human-verified payment reviews for existing user support requests.
-- A pending request never credits coins. Each request and external receipt may be approved once.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sharika_manual_recharge_reviews (
  support_message_id INTEGER PRIMARY KEY REFERENCES sharika_support_messages(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  admin_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000),
  payment_method TEXT NOT NULL DEFAULT '',
  payment_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(
    (status='approved' AND coins>=1
      AND length(payment_method) BETWEEN 2 AND 40
      AND length(payment_reference) BETWEEN 6 AND 120)
    OR
    (status='rejected' AND coins=0
      AND payment_method='' AND payment_reference=''
      AND length(note) BETWEEN 8 AND 250)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sharika_manual_receipt
  ON sharika_manual_recharge_reviews(lower(payment_method),lower(payment_reference))
  WHERE status='approved';
CREATE TRIGGER IF NOT EXISTS sharika_manual_recharge_valid_request
BEFORE INSERT ON sharika_manual_recharge_reviews
BEGIN
  SELECT RAISE(ABORT,'invalid_recharge_request')
  WHERE NOT EXISTS(
    SELECT 1 FROM sharika_support_messages m
    WHERE m.id=NEW.support_message_id AND m.user_id=NEW.user_uid
      AND m.sender_role='user' AND m.body LIKE 'Recharge request · %'
  );
END;
CREATE TRIGGER IF NOT EXISTS sharika_manual_recharge_immutable_update
BEFORE UPDATE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;
CREATE TRIGGER IF NOT EXISTS sharika_manual_recharge_immutable_delete
BEFORE DELETE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;
