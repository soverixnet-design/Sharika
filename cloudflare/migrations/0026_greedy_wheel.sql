-- Greedy Wheel: isolated, server-settled virtual-coin rounds.
-- Preserve every existing balance, game, and immutable ledger record.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sharika_greedy_rounds (
  id TEXT PRIMARY KEY,
  round_no INTEGER NOT NULL UNIQUE CHECK(round_no >= 0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  settles_ms INTEGER NOT NULL,
  ends_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex) = 64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256) = 64),
  CHECK(starts_ms < bet_closes_ms AND bet_closes_ms < settles_ms AND settles_ms < ends_ms)
);

CREATE TABLE IF NOT EXISTS sharika_greedy_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_greedy_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL CHECK(item_id IN
    ('shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout >= 0),
  result_id TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid, request_id),
  CHECK((status='accepted' AND payout=0 AND result_id IS NULL AND settled_at IS NULL)
    OR (status='settled' AND result_id IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sharika_greedy_pending ON sharika_greedy_bets(status,round_no,id);
CREATE INDEX IF NOT EXISTS sharika_greedy_user ON sharika_greedy_bets(user_uid,round_no DESC,id DESC);
CREATE INDEX IF NOT EXISTS sharika_greedy_winners ON sharika_greedy_bets(round_id,status,payout DESC);

CREATE TRIGGER IF NOT EXISTS sharika_greedy_bet_validate
BEFORE INSERT ON sharika_greedy_bets
BEGIN
  SELECT RAISE(ABORT,'greedy_round_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_rounds
    WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'greedy_betting_closed') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_rounds WHERE id=NEW.round_id
    AND starts_ms <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND bet_closes_ms > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
  SELECT RAISE(ABORT,'greedy_user_ineligible') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
    AND status='active' AND minor=0);
  SELECT RAISE(ABORT,'greedy_round_limit') WHERE
    COALESCE((SELECT SUM(amount) FROM sharika_greedy_bets
      WHERE round_id=NEW.round_id AND user_uid=NEW.user_uid),0)+NEW.amount>1000000000;
END;

-- Both debit and its audit entry are in the same SQLite transaction.
CREATE TRIGGER IF NOT EXISTS sharika_greedy_bet_debit
AFTER INSERT ON sharika_greedy_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND minor=0 AND status='active';
  SELECT RAISE(ABORT,'greedy_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_wheel_bet','greedy:bet:'||NEW.id);
END;

-- Conditional settlement permits exactly one payout even on Worker retries.
CREATE TRIGGER IF NOT EXISTS sharika_greedy_bet_payout
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'greedy_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_wheel_win','greedy:win:'||NEW.id);
END;
