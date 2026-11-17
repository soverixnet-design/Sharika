-- Cleopatra's Gold Deluxe: isolated, server-settled, non-cash-redeemable coins only.
-- Never run this staging migration against an unrelated production D1.
CREATE TABLE IF NOT EXISTS sharika_cleopatra_settings(
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  bets_json TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  payout_scale REAL NOT NULL DEFAULT 1 CHECK(payout_scale BETWEEN 0.1 AND 2),
  jackpot_seed INTEGER NOT NULL DEFAULT 24074034 CHECK(jackpot_seed>=0),
  contribution_bps INTEGER NOT NULL DEFAULT 100 CHECK(contribution_bps BETWEEN 0 AND 1000),
  max_win INTEGER NOT NULL DEFAULT 50000000 CHECK(max_win>0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_cleopatra_settings
 (id,enabled,bets_json,weights_json,payout_scale,jackpot_seed,contribution_bps,max_win)
VALUES
 (1,1,'[100,500,1000,2000,5000,10000]',
 '{"H":2,"E":3,"L":3,"A":4,"K":5,"Q":6,"J":7,"T":8,"N":9,"W":4,"B":1.3,"P":0.2}',
 1,24074034,100,50000000);

CREATE TABLE IF NOT EXISTS sharika_cleopatra_jackpot(
  id INTEGER PRIMARY KEY CHECK(id=1),
  pool INTEGER NOT NULL CHECK(pool>=0),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO sharika_cleopatra_jackpot(id,pool) VALUES(1,24074034);

CREATE TABLE IF NOT EXISTS sharika_cleopatra_free_spins(
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining BETWEEN 0 AND 1000),
  bet INTEGER NOT NULL DEFAULT 100 CHECK(bet>0),
  settings_version INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sharika_cleopatra_rounds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 8 AND 120),
  bet INTEGER NOT NULL CHECK(bet>0),
  is_free_spin INTEGER NOT NULL CHECK(is_free_spin IN(0,1)),
  grid_json TEXT NOT NULL CHECK(json_valid(grid_json)),
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  win INTEGER NOT NULL CHECK(win>=0),
  bonus_spins INTEGER NOT NULL CHECK(bonus_spins IN(0,10)),
  jackpot_hit INTEGER NOT NULL CHECK(jackpot_hit IN(0,1)),
  settings_version INTEGER NOT NULL,
  jackpot_version INTEGER NOT NULL,
  created_ms INTEGER NOT NULL,
  balance_after INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_cleopatra_user_rounds ON sharika_cleopatra_rounds(user_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_cleopatra_rank ON sharika_cleopatra_rounds(created_ms,win DESC);

CREATE TRIGGER IF NOT EXISTS sharika_cleopatra_validate BEFORE INSERT ON sharika_cleopatra_rounds
BEGIN
 SELECT RAISE(ABORT,'cleopatra_disabled') WHERE
   (SELECT enabled FROM sharika_cleopatra_settings WHERE id=1)!=1;
 SELECT RAISE(ABORT,'cleopatra_ineligible') WHERE NOT EXISTS(
   SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND minor=0 AND status='active');
 SELECT RAISE(ABORT,'cleopatra_settings_changed') WHERE NEW.is_free_spin=0 AND
   NEW.settings_version!=(SELECT version FROM sharika_cleopatra_settings WHERE id=1);
 SELECT RAISE(ABORT,'cleopatra_jackpot_changed') WHERE
   NEW.jackpot_version!=(SELECT version FROM sharika_cleopatra_jackpot WHERE id=1);
 SELECT RAISE(ABORT,'cleopatra_free_spin_mismatch') WHERE
   NEW.is_free_spin != CASE WHEN
     COALESCE((SELECT remaining FROM sharika_cleopatra_free_spins WHERE user_uid=NEW.user_uid),0)>0
     THEN 1 ELSE 0 END;
 SELECT RAISE(ABORT,'cleopatra_locked_bet') WHERE NEW.is_free_spin=1 AND
   NEW.bet!=(SELECT bet FROM sharika_cleopatra_free_spins WHERE user_uid=NEW.user_uid);
 SELECT RAISE(ABORT,'cleopatra_invalid_bet') WHERE NEW.is_free_spin=0 AND NOT EXISTS(
   SELECT 1 FROM sharika_cleopatra_settings s,json_each(s.bets_json) b
   WHERE s.id=1 AND CAST(b.value AS INTEGER)=NEW.bet);
 SELECT RAISE(ABORT,'cleopatra_insufficient_balance') WHERE NEW.is_free_spin=0 AND
   (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.bet;
 SELECT RAISE(ABORT,'cleopatra_spin_rate_limited') WHERE
   EXISTS(SELECT 1 FROM sharika_cleopatra_rounds
     WHERE user_uid=NEW.user_uid AND created_ms>NEW.created_ms-500 LIMIT 1);
END;

-- A single INSERT owns debit, free spins, payout, jackpot contribution, ledger
-- and the immutable result. SQLite rolls the entire statement back on error.
CREATE TRIGGER IF NOT EXISTS sharika_cleopatra_settle AFTER INSERT ON sharika_cleopatra_rounds
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.bet,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND NEW.is_free_spin=0;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.user_uid,'coins',-NEW.bet,coins,'cleopatra_bet','cleopatra:bet:'||NEW.id
  FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.is_free_spin=0;
 UPDATE sharika_users SET coins=coins+NEW.win,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND NEW.win>0;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.user_uid,'coins',NEW.win,coins,'cleopatra_win','cleopatra:win:'||NEW.id
  FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.win>0;
 INSERT INTO sharika_cleopatra_free_spins(user_uid,remaining,bet,settings_version,settings_json)
  VALUES(NEW.user_uid,NEW.bonus_spins,NEW.bet,NEW.settings_version,NEW.settings_json)
  ON CONFLICT(user_uid) DO UPDATE SET
    remaining=MIN(1000,MAX(0,remaining-NEW.is_free_spin)+NEW.bonus_spins),
    bet=CASE WHEN remaining>NEW.is_free_spin THEN bet ELSE NEW.bet END,
    settings_version=CASE WHEN remaining>NEW.is_free_spin THEN settings_version ELSE NEW.settings_version END,
    settings_json=CASE WHEN remaining>NEW.is_free_spin THEN settings_json ELSE NEW.settings_json END;
 UPDATE sharika_cleopatra_jackpot SET
   pool=CASE WHEN NEW.jackpot_hit=1 THEN
       (SELECT jackpot_seed FROM sharika_cleopatra_settings WHERE id=1)
     ELSE pool+CAST(NEW.bet*(SELECT contribution_bps FROM sharika_cleopatra_settings WHERE id=1)/10000 AS INTEGER)
       * (1-NEW.is_free_spin) END,
   version=version+1 WHERE id=1;
 UPDATE sharika_cleopatra_rounds SET
   balance_after=(SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)
   WHERE id=NEW.id;
END;

INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('cleopatra',0);
