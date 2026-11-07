-- Authenticated, server-verified rich gifts and jackpot announcements.
-- Append-only presentation events; balances, original receipts and ledgers remain unchanged.
CREATE TABLE IF NOT EXISTS sharika_celebration_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  gift_threshold_coins INTEGER NOT NULL DEFAULT 1000000
    CHECK(gift_threshold_coins BETWEEN 1000 AND 1000000000000),
  win_threshold_coins INTEGER NOT NULL DEFAULT 10000000
    CHECK(win_threshold_coins BETWEEN 1000 AND 1000000000000),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_celebration_settings(id) VALUES(1);

CREATE TABLE IF NOT EXISTS sharika_global_celebrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('gift','win')),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT REFERENCES sharika_users(auth_uid),
  gift_id INTEGER REFERENCES sharika_gifts(id),
  game TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount_coins INTEGER NOT NULL CHECK(amount_coins>0),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_global_celebrations_recent
  ON sharika_global_celebrations(created_at DESC,id DESC);

-- Event and wallet transactions commit together, so a failed gift or bet
-- cannot produce a fabricated broadcast. Unique source keys prevent replay.
CREATE TRIGGER IF NOT EXISTS sharika_global_celebration_gift
AFTER INSERT ON sharika_gift_events
WHEN NEW.price_coins*NEW.quantity >=
  (SELECT gift_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(
    source_key,kind,sender_uid,recipient_uid,gift_id,quantity,amount_coins)
  VALUES('gift:'||NEW.id,'gift',NEW.sender_uid,NEW.recipient_uid,NEW.gift_id,
    NEW.quantity,NEW.price_coins*NEW.quantity);
END;

CREATE TRIGGER IF NOT EXISTS sharika_global_celebration_greedy
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('greedy:'||NEW.id,'win',NEW.user_uid,'Greedy Wheel',NEW.payout);
END;

CREATE TRIGGER IF NOT EXISTS sharika_global_celebration_original
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('original:'||NEW.id,'win',NEW.user_uid,
    CASE NEW.game WHEN 'sovera-food' THEN 'Sovera Food Wheel'
      WHEN 'night-food' THEN 'Night Food Wheel' ELSE 'Jackpot Fruit' END,NEW.payout);
END;

CREATE TRIGGER IF NOT EXISTS sharika_global_celebration_fruit
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('fruit:'||NEW.id,'win',NEW.user_uid,'Fruit Royale',NEW.payout);
END;

CREATE TRIGGER IF NOT EXISTS sharika_global_celebration_gaddy
AFTER UPDATE OF status ON sharika_gaddy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('gaddy:'||NEW.id,'win',NEW.user_uid,'Sovera Gaddy',NEW.payout);
END;
