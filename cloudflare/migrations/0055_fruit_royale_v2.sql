-- Fruit Royale V2 uses independent tables, protecting all legacy Jackpot Fruit rows.
-- Only NEW Jackpot Fruit bets are disabled; old wagers can still settle.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_fruit_royale_rounds (
  id TEXT PRIMARY KEY,
  round_no INTEGER NOT NULL UNIQUE CHECK(round_no>=0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  closes_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);
CREATE INDEX IF NOT EXISTS sharika_fruit_round_recent
  ON sharika_fruit_royale_rounds(round_no DESC);

CREATE TABLE IF NOT EXISTS sharika_fruit_royale_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_fruit_royale_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,request_id),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL AND result_json IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sharika_fruit_bets_status
  ON sharika_fruit_royale_bets(status,round_no);
CREATE INDEX IF NOT EXISTS sharika_fruit_bets_user
  ON sharika_fruit_royale_bets(user_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_fruit_bets_round
  ON sharika_fruit_royale_bets(round_id,id);
CREATE INDEX IF NOT EXISTS sharika_fruit_bets_rank
  ON sharika_fruit_royale_bets(status,settled_at,payout DESC);

CREATE TABLE IF NOT EXISTS sharika_fruit_royale_pool (
  id TEXT PRIMARY KEY CHECK(id='main'),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0)
);
INSERT OR IGNORE INTO sharika_fruit_royale_pool(id,coins) VALUES('main',0);

CREATE TABLE IF NOT EXISTS sharika_fruit_royale_jackpots (
  round_id TEXT PRIMARY KEY REFERENCES sharika_fruit_royale_rounds(id),
  budget INTEGER NOT NULL CHECK(budget>=0),
  total_stake INTEGER NOT NULL CHECK(total_stake>0)
);

CREATE TRIGGER IF NOT EXISTS sharika_fruit_bet_validate
BEFORE INSERT ON sharika_fruit_royale_bets
BEGIN
  SELECT RAISE(ABORT,'fruit_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_fruit_royale_rounds
     WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'fruit_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_fruit_royale_rounds WHERE id=NEW.round_id)
      <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    OR (SELECT starts_ms FROM sharika_fruit_royale_rounds WHERE id=NEW.round_id)
      > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
  SELECT RAISE(ABORT,'fruit_user_ineligible') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
      AND status='active' AND minor=0);
END;

-- Once a bet is settled its result cannot be overwritten or replayed.
CREATE TRIGGER IF NOT EXISTS sharika_fruit_settlement_immutable
BEFORE UPDATE ON sharika_fruit_royale_bets
WHEN OLD.status='settled'
BEGIN
  SELECT RAISE(ABORT,'fruit_settlement_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sharika_fruit_history_no_delete
BEFORE DELETE ON sharika_fruit_royale_bets
BEGIN
  SELECT RAISE(ABORT,'fruit_history_immutable');
END;

CREATE TRIGGER IF NOT EXISTS sharika_fruit_bet_debit
AFTER INSERT ON sharika_fruit_royale_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount
      AND status='active' AND minor=0;
  SELECT RAISE(ABORT,'fruit_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'fruit_royale_bet','fruit:bet:'||NEW.id);
  UPDATE sharika_fruit_royale_pool SET coins=coins+CAST(NEW.amount/20 AS INTEGER)
    WHERE id='main';
END;

CREATE TRIGGER IF NOT EXISTS sharika_fruit_bet_credit
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'fruit_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'fruit_royale_win','fruit:win:'||NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS sharika_fruit_jackpot_reserve
AFTER INSERT ON sharika_fruit_royale_jackpots
BEGIN
  UPDATE sharika_fruit_royale_pool SET coins=coins-NEW.budget
    WHERE id='main' AND coins>=NEW.budget;
  SELECT RAISE(ABORT,'fruit_jackpot_pool_insufficient') WHERE changes()!=1;
END;

INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('fruit-royale',1);
UPDATE sharika_game_catalog SET enabled=0,updated_at=datetime('now')
  WHERE id='jackpot-fruit';
