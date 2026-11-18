-- Staging only. Apply only to the authorized Sharika staging D1; never replay prod migrations blindly.
-- Royal Ace Deluxe: virtual coins only. Wallet and bonus state settle inside a single INSERT.
CREATE TABLE IF NOT EXISTS sharika_royal_ace_settings(
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  bets_json TEXT NOT NULL CHECK(json_valid(bets_json)),
  max_win INTEGER NOT NULL DEFAULT 100000000 CHECK(max_win BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_royal_ace_settings(id,enabled,bets_json,max_win)
VALUES(1,0,'[1000,10000,100000,1000000,10000000]',100000000);

CREATE TABLE IF NOT EXISTS sharika_royal_ace_free(
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining BETWEEN 0 AND 1000),
  bet INTEGER NOT NULL CHECK(bet>0)
);
CREATE TABLE IF NOT EXISTS sharika_royal_ace_rounds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 100),
  bet INTEGER NOT NULL CHECK(bet>0),
  mode TEXT NOT NULL CHECK(mode IN('paid','free','bonus_buy')),
  cost INTEGER NOT NULL CHECK(cost>=0),
  steps_json TEXT NOT NULL CHECK(json_valid(steps_json)),
  win INTEGER NOT NULL CHECK(win>=0),
  bonus_spins INTEGER NOT NULL CHECK(bonus_spins BETWEEN 0 AND 10),
  created_ms INTEGER NOT NULL,
  balance_after INTEGER,
  free_after INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_uid,request_id)
);
CREATE INDEX IF NOT EXISTS royal_ace_rounds_user ON sharika_royal_ace_rounds(user_uid,id DESC);
CREATE TRIGGER IF NOT EXISTS royal_ace_validate BEFORE INSERT ON sharika_royal_ace_rounds
BEGIN
  SELECT RAISE(ABORT,'royal_disabled') WHERE
    (SELECT enabled FROM sharika_royal_ace_settings WHERE id=1)!=1 OR
    COALESCE((SELECT enabled FROM sharika_game_catalog WHERE id='royal-ace'),0)!=1;
  SELECT RAISE(ABORT,'royal_ineligible') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
  SELECT RAISE(ABORT,'royal_invalid_bet') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_royal_ace_settings s,json_each(s.bets_json) b
    WHERE s.id=1 AND CAST(b.value AS INTEGER)=NEW.bet);
  SELECT RAISE(ABORT,'royal_mode_conflict') WHERE
    (NEW.mode='free')!=(COALESCE((SELECT remaining FROM sharika_royal_ace_free
      WHERE user_uid=NEW.user_uid),0)>0);
  SELECT RAISE(ABORT,'royal_mode_conflict') WHERE
    NEW.mode='bonus_buy' AND COALESCE((SELECT remaining FROM sharika_royal_ace_free
      WHERE user_uid=NEW.user_uid),0)>0;
  SELECT RAISE(ABORT,'royal_locked_bet') WHERE NEW.mode='free' AND
    NEW.bet!=(SELECT bet FROM sharika_royal_ace_free WHERE user_uid=NEW.user_uid);
  SELECT RAISE(ABORT,'royal_invalid_cost') WHERE NEW.cost!=CASE
    WHEN NEW.mode='free' THEN 0
    WHEN NEW.mode='paid' THEN NEW.bet
    ELSE NEW.bet*50 END;
  SELECT RAISE(ABORT,'royal_insufficient') WHERE
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.cost;
  SELECT RAISE(ABORT,'royal_rate_limited') WHERE EXISTS(
    SELECT 1 FROM sharika_royal_ace_rounds
     WHERE user_uid=NEW.user_uid AND created_ms>NEW.created_ms-600 LIMIT 1);
END;

CREATE TRIGGER IF NOT EXISTS royal_ace_settle AFTER INSERT ON sharika_royal_ace_rounds
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.cost,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND NEW.cost>0;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
    SELECT NEW.user_uid,'coins',-NEW.cost,coins,
      CASE WHEN NEW.mode='bonus_buy' THEN 'royal_ace_bonus' ELSE 'royal_ace_bet' END,
      'royal:bet:'||NEW.id
    FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.cost>0;
  UPDATE sharika_users SET coins=coins+NEW.win,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND NEW.win>0;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
    SELECT NEW.user_uid,'coins',NEW.win,coins,'royal_ace_win','royal:win:'||NEW.id
    FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.win>0;
  INSERT OR IGNORE INTO sharika_royal_ace_free(user_uid,remaining,bet)
    VALUES(NEW.user_uid,0,NEW.bet);
  UPDATE sharika_royal_ace_free SET
    remaining=CASE NEW.mode WHEN 'bonus_buy' THEN 10
      WHEN 'free' THEN MIN(1000,MAX(0,remaining-1)+NEW.bonus_spins)
      ELSE MIN(1000,remaining+NEW.bonus_spins) END,
    bet=NEW.bet WHERE user_uid=NEW.user_uid;
  UPDATE sharika_royal_ace_rounds SET
    balance_after=(SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    free_after=(SELECT remaining FROM sharika_royal_ace_free WHERE user_uid=NEW.user_uid)
    WHERE id=NEW.id;
END;
INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('royal-ace',0);
