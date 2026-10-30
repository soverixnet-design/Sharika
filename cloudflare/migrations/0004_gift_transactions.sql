-- Sharika staging: server-settled non-lucky gifts, never demo awards.
-- Existing user rows, room records, coins and ledger are preserved.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sharika_gift_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  gift_id INTEGER NOT NULL REFERENCES sharika_gifts(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
  recipient_ids_json TEXT NOT NULL,
  total_coins INTEGER NOT NULL CHECK(total_coins > 0),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sender_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_gift_transactions_sender_time
  ON sharika_gift_transactions(sender_uid,created_at DESC);
CREATE TABLE IF NOT EXISTS sharika_gift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  gift_id INTEGER NOT NULL REFERENCES sharika_gifts(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
  price_coins INTEGER NOT NULL CHECK(price_coins > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(transaction_id,recipient_uid)
);
CREATE INDEX IF NOT EXISTS sharika_gift_events_room_time
  ON sharika_gift_events(room_id,id DESC);
CREATE INDEX IF NOT EXISTS sharika_gift_events_receiver_time
  ON sharika_gift_events(recipient_uid,id DESC);
CREATE TRIGGER IF NOT EXISTS sharika_gift_event_validate
BEFORE INSERT ON sharika_gift_events
BEGIN
  SELECT RAISE(ABORT,'recipient_not_in_room')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_room_members
      WHERE room_id=NEW.room_id AND user_id=NEW.recipient_uid);
  SELECT RAISE(ABORT,'gift_not_active')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_gifts
      WHERE id=NEW.gift_id AND active=1 AND tab IN (0,1));
END;
