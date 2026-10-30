-- Lucky Gift results are written once per settled gift transaction.
-- No user balances, gift history, or existing ledger entries are erased.
CREATE TABLE IF NOT EXISTS sharika_lucky_gift_outcomes (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  payout_coins INTEGER NOT NULL CHECK (payout_coins >= 0),
  max_multiplier INTEGER NOT NULL CHECK (max_multiplier IN (0,1,2,5,10,50)),
  rolls_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_lucky_gift_outcomes_sender
  ON sharika_lucky_gift_outcomes(sender_uid,created_at DESC);

-- Replace the existing event guard to accept Lucky gifts only when a
-- server-settled Lucky outcome exists in the same atomic transaction.
DROP TRIGGER IF EXISTS sharika_gift_event_validate;
CREATE TRIGGER sharika_gift_event_validate
BEFORE INSERT ON sharika_gift_events
BEGIN
  SELECT RAISE(ABORT,'recipient_not_in_room')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_room_members
      WHERE room_id=NEW.room_id AND user_id=NEW.recipient_uid);
  SELECT RAISE(ABORT,'gift_not_active')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_gifts
      WHERE id=NEW.gift_id AND active=1 AND tab IN (0,1,2));
  SELECT RAISE(ABORT,'lucky_outcome_missing')
    WHERE EXISTS (SELECT 1 FROM sharika_gifts WHERE id=NEW.gift_id AND tab=2)
      AND NOT EXISTS (SELECT 1 FROM sharika_lucky_gift_outcomes
        WHERE transaction_id=NEW.transaction_id AND sender_uid=NEW.sender_uid);
END;
