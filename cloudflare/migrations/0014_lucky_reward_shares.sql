-- Dormant Lucky Gift 5% recipient diamonds + 1% room reward, cashout hold remains ON.
-- Both rewards are funded by the existing gift spend. They never debit an
-- additional coin from the sender. 100 hundredths = one spendable unit.
PRAGMA foreign_keys = ON;

-- One reward per gift recipient. A 5% gift entitlement is stored precisely
-- in hundredths of a diamond, so cheap gifts still accumulate fairly.
CREATE TABLE IF NOT EXISTS sharika_lucky_recipient_rewards (
  transaction_id INTEGER NOT NULL REFERENCES sharika_gift_transactions(id),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  earned_hundredths INTEGER NOT NULL CHECK (earned_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(transaction_id, recipient_uid)
);
CREATE TABLE IF NOT EXISTS sharika_lucky_diamond_accruals (
  recipient_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  earned_hundredths INTEGER NOT NULL DEFAULT 0 CHECK (earned_hundredths >= 0),
  credited_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (credited_diamonds >= 0),
  CHECK (credited_diamonds * 100 <= earned_hundredths)
);

CREATE TRIGGER IF NOT EXISTS sharika_lucky_recipient_reward_validate
BEFORE INSERT ON sharika_lucky_recipient_rewards
BEGIN
  SELECT RAISE(ABORT, 'lucky_recipient_invalid_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    JOIN sharika_lucky_gift_outcomes o ON o.transaction_id=t.id
    JOIN sharika_gift_events e ON e.transaction_id=t.id AND e.recipient_uid=NEW.recipient_uid
    JOIN sharika_users u ON u.auth_uid=NEW.recipient_uid
    WHERE t.id=NEW.transaction_id AND g.tab=2
      AND u.status='active'
      AND NEW.earned_hundredths=g.price_coins*t.quantity*5
  );
END;

-- Called within the same D1 gift transaction. The running integer total
-- handles fractional rewards across many cheap gifts and simultaneous sends.
CREATE TRIGGER IF NOT EXISTS sharika_lucky_recipient_reward_credit
AFTER INSERT ON sharika_lucky_recipient_rewards
BEGIN
  INSERT INTO sharika_lucky_diamond_accruals
    (recipient_uid, earned_hundredths, credited_diamonds)
  VALUES (NEW.recipient_uid, NEW.earned_hundredths, 0)
  ON CONFLICT(recipient_uid) DO UPDATE SET
    earned_hundredths=earned_hundredths+excluded.earned_hundredths;

  UPDATE sharika_users
    SET diamonds=diamonds+(
      SELECT CAST(a.earned_hundredths/100 AS INTEGER)-a.credited_diamonds
      FROM sharika_lucky_diamond_accruals a WHERE a.recipient_uid=NEW.recipient_uid
    ),updated_at=datetime('now')
    WHERE auth_uid=NEW.recipient_uid AND status='active';

  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.recipient_uid,'diamonds',
    CAST(a.earned_hundredths/100 AS INTEGER)-a.credited_diamonds,
    (SELECT u.diamonds FROM sharika_users u WHERE u.auth_uid=NEW.recipient_uid),
    'lucky_gift_received',
    'lucky-recipient:'||NEW.transaction_id||':'||NEW.recipient_uid
  FROM sharika_lucky_diamond_accruals a
  WHERE a.recipient_uid=NEW.recipient_uid
    AND CAST(a.earned_hundredths/100 AS INTEGER)>a.credited_diamonds;

  UPDATE sharika_lucky_diamond_accruals
    SET credited_diamonds=CAST(earned_hundredths/100 AS INTEGER)
    WHERE recipient_uid=NEW.recipient_uid;
END;

-- The 1% belongs to the ROOM, not automatically to the room owner's wallet.
-- Keep precise hundredths in an immutable audit ledger; room-owner withdrawal
-- requires a separate policy and authorization.
CREATE TABLE IF NOT EXISTS sharika_lucky_room_rewards (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  reward_hundredths INTEGER NOT NULL CHECK (reward_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_lucky_room_rewards_room
  ON sharika_lucky_room_rewards(room_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_lucky_room_reward_validate
BEFORE INSERT ON sharika_lucky_room_rewards
BEGIN
  SELECT RAISE(ABORT, 'lucky_room_invalid_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    JOIN sharika_lucky_gift_outcomes o ON o.transaction_id=t.id
    WHERE t.id=NEW.transaction_id AND t.room_id=NEW.room_id
      AND g.tab=2 AND NEW.reward_hundredths=t.total_coins
  );
END;

-- Reward records cannot be rewritten or erased after settlement.
CREATE TRIGGER IF NOT EXISTS sharika_lucky_recipient_reward_no_update
BEFORE UPDATE ON sharika_lucky_recipient_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_lucky_recipient_reward_no_delete
BEFORE DELETE ON sharika_lucky_recipient_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_lucky_room_reward_no_update
BEFORE UPDATE ON sharika_lucky_room_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_lucky_room_reward_no_delete
BEFORE DELETE ON sharika_lucky_room_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;
