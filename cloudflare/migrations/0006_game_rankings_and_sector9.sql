-- Rebuild the isolated game-bet table to support all NINE Food Wheel sectors.
-- Preserve any existing user bets/coin ledger entries; do not reset wallets.
PRAGMA foreign_keys=ON;

DROP TRIGGER IF EXISTS sharika_game_bet_validate;
DROP TRIGGER IF EXISTS sharika_game_bet_debit;
DROP TRIGGER IF EXISTS sharika_game_bet_payout;

CREATE TABLE sharika_game_bets_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK(game IN ('food-wheel','jackpot-fruit')),
  round_no INTEGER NOT NULL,
  round_id TEXT NOT NULL REFERENCES sharika_game_rounds(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  stake INTEGER NOT NULL CHECK(stake>0 AND stake<=250000000000000),
  pick_index INTEGER CHECK(pick_index BETWEEN 0 AND 8),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0 AND payout<=stake*36),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,game,round_no),
  UNIQUE(user_uid,request_id),
  CHECK((game='food-wheel' AND pick_index IS NOT NULL) OR
        (game='jackpot-fruit' AND pick_index IS NULL)),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);
INSERT INTO sharika_game_bets_next
  (id,game,round_no,round_id,user_uid,stake,pick_index,request_id,
   status,payout,result_json,created_at,settled_at)
SELECT id,game,round_no,round_id,user_uid,stake,pick_index,request_id,
       status,payout,result_json,created_at,settled_at
  FROM sharika_game_bets;
DROP TABLE sharika_game_bets;
ALTER TABLE sharika_game_bets_next RENAME TO sharika_game_bets;

CREATE INDEX IF NOT EXISTS sharika_game_bets_user_time
  ON sharika_game_bets(user_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_game_bets_pending
  ON sharika_game_bets(user_uid,status,round_no);

-- Reject mismatched or expired rounds at the storage layer too.
CREATE TRIGGER IF NOT EXISTS sharika_game_bet_validate
BEFORE INSERT ON sharika_game_bets
BEGIN
  SELECT RAISE(ABORT,'game_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_game_rounds WHERE id=NEW.round_id
      AND game=NEW.game AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'game_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_game_rounds WHERE id=NEW.round_id)
      <= CAST(strftime('%s','now') AS INTEGER)*1000;
END;

-- A successful INSERT is the only way to charge a bet, so retries cannot
-- debit again. SQLite executes the trigger and INSERT in one transaction.
CREATE TRIGGER IF NOT EXISTS sharika_game_bet_debit
AFTER INSERT ON sharika_game_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.stake,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0 AND coins>=NEW.stake;
  SELECT RAISE(ABORT,'game_insufficient_or_ineligible') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES
    (NEW.user_uid,'coins',-NEW.stake,
     (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
     'game_bet','game:bet:'||NEW.id);
END;

-- A bet can be paid only once on the accepted -> settled transition.
CREATE TRIGGER IF NOT EXISTS sharika_game_bet_payout
AFTER UPDATE OF status ON sharika_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'game_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES
    (NEW.user_uid,'coins',NEW.payout,
      (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
      'game_win','game:win:'||NEW.id);
END;

-- Ranking and recent round queries, bounded to a game and UTC period.
CREATE INDEX IF NOT EXISTS sharika_game_bets_period_rank
  ON sharika_game_bets(game,status,settled_at,payout DESC);
CREATE INDEX IF NOT EXISTS sharika_game_bets_round_rank
  ON sharika_game_bets(game,round_no,stake DESC);
CREATE INDEX IF NOT EXISTS sharika_game_rounds_recent
  ON sharika_game_rounds(game,round_no DESC);
