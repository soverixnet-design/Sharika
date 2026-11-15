CREATE TABLE IF NOT EXISTS sharika_location_price (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  coins INTEGER NOT NULL CHECK (coins BETWEEN 0 AND 1000000000)
);
INSERT OR IGNORE INTO sharika_location_price(id, coins) VALUES (1, 1000000);

CREATE TABLE IF NOT EXISTS sharika_location_price_audit (
  id INTEGER PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  previous_coins INTEGER NOT NULL,
  next_coins INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sharika_location_changes (
  auth_uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_uid TEXT,
  old_country TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country GLOB '[A-Z][A-Z]'),
  coins INTEGER NOT NULL CHECK (coins BETWEEN 0 AND 1000000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (auth_uid, request_id)
);

CREATE TRIGGER IF NOT EXISTS sharika_apply_location_change
AFTER INSERT ON sharika_location_changes
BEGIN
  UPDATE sharika_users
    SET country=NEW.country, coins=coins-NEW.coins, updated_at=datetime('now')
    WHERE auth_uid=NEW.auth_uid;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
    SELECT auth_uid,'coins',-NEW.coins,coins,'location_change',NEW.request_id
    FROM sharika_users WHERE auth_uid=NEW.auth_uid AND NEW.coins>0;
END;
