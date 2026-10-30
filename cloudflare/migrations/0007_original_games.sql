-- Isolated original visual games: authenticated virtual coins only.
-- Keep all prior game tables, player wallets, and immutable ledger history.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sharika_original_game_rounds (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL CHECK(game IN ('sovera-food','night-food','jackpot-fruit')),
  round_no INTEGER NOT NULL CHECK(round_no>=0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  closes_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(game,round_no),
  CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);
CREATE INDEX IF NOT EXISTS sharika_original_rounds_recent
  ON sharika_original_game_rounds(game,round_no DESC);

CREATE TABLE IF NOT EXISTS sharika_original_game_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK(game IN ('sovera-food','night-food','jackpot-fruit')),
  round_no INTEGER NOT NULL,
  round_id TEXT NOT NULL REFERENCES sharika_original_game_rounds(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 9),
  amount INTEGER NOT NULL CHECK(amount>0 AND amount<=100000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,request_id),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sharika_original_bets_status
  ON sharika_original_game_bets(status,round_no);
CREATE INDEX IF NOT EXISTS sharika_original_bets_user
  ON sharika_original_game_bets(user_uid,game,id DESC);
CREATE INDEX IF NOT EXISTS sharika_original_bets_rank
  ON sharika_original_game_bets(game,status,settled_at,payout DESC);
CREATE INDEX IF NOT EXISTS sharika_original_bets_round
  ON sharika_original_game_bets(game,round_no,amount DESC);

CREATE TABLE IF NOT EXISTS sharika_original_game_pools (
  game TEXT PRIMARY KEY CHECK(game='jackpot-fruit'),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0)
);
INSERT OR IGNORE INTO sharika_original_game_pools(game,coins)
  VALUES('jackpot-fruit',0);

CREATE TABLE IF NOT EXISTS sharika_original_jackpot_budgets (
  round_id TEXT PRIMARY KEY REFERENCES sharika_original_game_rounds(id),
  budget INTEGER NOT NULL CHECK(budget>=0),
  total_stake INTEGER NOT NULL CHECK(total_stake>0)
);

CREATE TRIGGER IF NOT EXISTS sharika_original_bet_validate
BEFORE INSERT ON sharika_original_game_bets
BEGIN
  SELECT RAISE(ABORT,'original_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_original_game_rounds
      WHERE id=NEW.round_id AND game=NEW.game AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'original_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      <= CAST(strftime('%s','now') AS INTEGER)*1000 OR
    (SELECT starts_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      > CAST(strftime('%s','now') AS INTEGER)*1000;
  SELECT RAISE(ABORT,'original_invalid_pick') WHERE
    (NEW.game!='night-food' AND NEW.pick_index>7);
  SELECT RAISE(ABORT,'original_user_ineligible') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
      AND status='active' AND minor=0);
END;
CREATE TRIGGER IF NOT EXISTS sharika_original_bet_debit
AFTER INSERT ON sharika_original_game_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount
      AND status='active' AND minor=0;
  SELECT RAISE(ABORT,'original_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'original_game_bet','original:bet:'||NEW.id);
  UPDATE sharika_original_game_pools
    SET coins=coins+CAST(NEW.amount/20 AS INTEGER)
    WHERE game='jackpot-fruit' AND NEW.game='jackpot-fruit';
END;
CREATE TRIGGER IF NOT EXISTS sharika_original_bet_payout
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'original_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'original_game_win','original:win:'||NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sharika_original_jackpot_reserve
AFTER INSERT ON sharika_original_jackpot_budgets
BEGIN
  UPDATE sharika_original_game_pools
    SET coins=coins-NEW.budget
    WHERE game='jackpot-fruit' AND coins>=NEW.budget;
  SELECT RAISE(ABORT,'original_jackpot_pool_insufficient') WHERE changes()!=1;
END;
