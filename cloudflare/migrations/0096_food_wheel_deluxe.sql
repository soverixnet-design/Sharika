-- Isolated Food Wheel Deluxe 25s rounds; never rewrite existing original-game history.
-- 15s betting, 5s animation, 5s verified result. Virtual coins only.
CREATE TABLE IF NOT EXISTS sharika_food_deluxe_rounds(
 id TEXT PRIMARY KEY,
 round_no INTEGER NOT NULL UNIQUE CHECK(round_no>=0),
 starts_ms INTEGER NOT NULL,
 bet_closes_ms INTEGER NOT NULL,
 result_ms INTEGER NOT NULL,
 closes_ms INTEGER NOT NULL,
 seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
 commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
 winning_index INTEGER CHECK(winning_index BETWEEN 0 AND 7),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<result_ms AND result_ms<closes_ms)
);
CREATE INDEX IF NOT EXISTS sharika_food_deluxe_recent ON sharika_food_deluxe_rounds(round_no DESC);
CREATE TABLE IF NOT EXISTS sharika_food_deluxe_bets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 round_id TEXT NOT NULL REFERENCES sharika_food_deluxe_rounds(id),
 round_no INTEGER NOT NULL,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 stakes_json TEXT NOT NULL CHECK(json_valid(stakes_json)),
 total INTEGER NOT NULL CHECK(total BETWEEN 100 AND 100000000),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
 payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
 winning_index INTEGER CHECK(winning_index BETWEEN 0 AND 7),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 settled_at TEXT,
 UNIQUE(user_uid,request_id),
 CHECK((status='accepted' AND settled_at IS NULL AND payout=0 AND winning_index IS NULL)
 OR (status='settled' AND settled_at IS NOT NULL AND winning_index IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sharika_food_deluxe_pending ON sharika_food_deluxe_bets(status,round_no);
CREATE INDEX IF NOT EXISTS sharika_food_deluxe_user ON sharika_food_deluxe_bets(user_uid,round_no DESC);
CREATE INDEX IF NOT EXISTS sharika_food_deluxe_wins ON sharika_food_deluxe_bets(status,settled_at,payout DESC);
CREATE TRIGGER IF NOT EXISTS sharika_food_deluxe_validate BEFORE INSERT ON sharika_food_deluxe_bets
BEGIN
 SELECT RAISE(ABORT,'food_round_mismatch') WHERE NOT EXISTS (
  SELECT 1 FROM sharika_food_deluxe_rounds WHERE id=NEW.round_id AND round_no=NEW.round_no
 );
 SELECT RAISE(ABORT,'food_betting_closed') WHERE
  (SELECT bet_closes_ms FROM sharika_food_deluxe_rounds WHERE id=NEW.round_id)
    <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR
  (SELECT starts_ms FROM sharika_food_deluxe_rounds WHERE id=NEW.round_id)
    > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
 SELECT RAISE(ABORT,'food_invalid_stakes') WHERE
  json_type(NEW.stakes_json)!='array' OR json_array_length(NEW.stakes_json)!=8 OR
  (SELECT COALESCE(SUM(CAST(value AS INTEGER)),0) FROM json_each(NEW.stakes_json))!=NEW.total OR
  EXISTS(SELECT 1 FROM json_each(NEW.stakes_json)
    WHERE type!='integer' OR CAST(value AS INTEGER)<0 OR CAST(value AS INTEGER)%100!=0);
 SELECT RAISE(ABORT,'food_user_ineligible') WHERE NOT EXISTS (
  SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0
 );
END;
CREATE TRIGGER IF NOT EXISTS sharika_food_deluxe_debit AFTER INSERT ON sharika_food_deluxe_bets
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.total,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND coins>=NEW.total AND status='active' AND minor=0;
 SELECT RAISE(ABORT,'food_insufficient_coins') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',-NEW.total,
 (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
 'food_deluxe_bet','food-deluxe:bet:'||NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sharika_food_deluxe_pay AFTER UPDATE OF status ON sharika_food_deluxe_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
 UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid;
 SELECT RAISE(ABORT,'food_user_missing') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',NEW.payout,
 (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
 'food_deluxe_win','food-deluxe:win:'||NEW.id);
END;
INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('food-deluxe',0);
