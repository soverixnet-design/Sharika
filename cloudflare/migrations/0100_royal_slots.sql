-- Staging-only Royal Slots (virtual coins). Disabled until QA.
CREATE TABLE IF NOT EXISTS sharika_royal_slots_settings(
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 bets_json TEXT NOT NULL CHECK(json_valid(bets_json)),
 max_win INTEGER NOT NULL DEFAULT 1000000000 CHECK(max_win BETWEEN 1 AND 1000000000),
 jackpot_pool INTEGER NOT NULL DEFAULT 13880717 CHECK(jackpot_pool BETWEEN 0 AND 1000000000000),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_royal_slots_settings(id,enabled,bets_json,max_win,jackpot_pool)
 VALUES(1,0,'[1000,10000,100000,1000000,10000000]',1000000000,13880717);
INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('royal-slots',0);
CREATE TABLE IF NOT EXISTS sharika_royal_slots_free(
 user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
 remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining BETWEEN 0 AND 1000),
 bet INTEGER NOT NULL CHECK(bet>0)
);
CREATE TABLE IF NOT EXISTS sharika_royal_slots_rounds(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 100),
 bet INTEGER NOT NULL CHECK(bet>0),
 mode TEXT NOT NULL CHECK(mode IN('paid','free')),
 cost INTEGER NOT NULL CHECK(cost>=0),
 grid_json TEXT NOT NULL CHECK(json_valid(grid_json)),
 lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
 total_win INTEGER NOT NULL CHECK(total_win>=0),
 jackpot_win INTEGER NOT NULL DEFAULT 0 CHECK(jackpot_win>=0),
 free_awarded INTEGER NOT NULL DEFAULT 0 CHECK(free_awarded BETWEEN 0 AND 8),
 created_ms INTEGER NOT NULL,
 balance_after INTEGER,
 free_after INTEGER,
 jackpot_after INTEGER,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_uid,request_id)
);
CREATE INDEX IF NOT EXISTS royal_slots_user_history ON sharika_royal_slots_rounds(user_uid,id DESC);
CREATE TRIGGER IF NOT EXISTS royal_slots_validate BEFORE INSERT ON sharika_royal_slots_rounds
BEGIN
 SELECT RAISE(ABORT,'slots_disabled') WHERE
  COALESCE((SELECT enabled FROM sharika_royal_slots_settings WHERE id=1),0)!=1 OR
  COALESCE((SELECT enabled FROM sharika_game_catalog WHERE id='royal-slots'),0)!=1;
 SELECT RAISE(ABORT,'slots_ineligible') WHERE NOT EXISTS(
  SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
 SELECT RAISE(ABORT,'slots_invalid_bet') WHERE NOT EXISTS(
  SELECT 1 FROM sharika_royal_slots_settings s,json_each(s.bets_json) b
  WHERE s.id=1 AND CAST(b.value AS INTEGER)=NEW.bet);
 SELECT RAISE(ABORT,'slots_mode_conflict') WHERE
  (NEW.mode='free')!=(COALESCE((SELECT remaining FROM sharika_royal_slots_free
    WHERE user_uid=NEW.user_uid),0)>0);
 SELECT RAISE(ABORT,'slots_locked_bet') WHERE NEW.mode='free' AND
  NEW.bet!=(SELECT bet FROM sharika_royal_slots_free WHERE user_uid=NEW.user_uid);
 SELECT RAISE(ABORT,'slots_invalid_cost') WHERE NEW.cost!=
  CASE WHEN NEW.mode='free' THEN 0 ELSE NEW.bet END;
 SELECT RAISE(ABORT,'slots_insufficient') WHERE
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.cost;
 SELECT RAISE(ABORT,'slots_invalid_win') WHERE
  NEW.total_win>MIN(NEW.bet*200,(SELECT max_win FROM sharika_royal_slots_settings WHERE id=1))
  OR NEW.jackpot_win>NEW.total_win OR NEW.total_win<0 OR NEW.free_awarded>8;
 SELECT RAISE(ABORT,'slots_pool_conflict') WHERE NEW.jackpot_win>
  (SELECT jackpot_pool FROM sharika_royal_slots_settings WHERE id=1);
 SELECT RAISE(ABORT,'slots_balance_overflow') WHERE
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)+NEW.total_win-NEW.cost>9007199254740991;
 SELECT RAISE(ABORT,'slots_rate_limited') WHERE EXISTS(
  SELECT 1 FROM sharika_royal_slots_rounds WHERE user_uid=NEW.user_uid
  AND created_ms>NEW.created_ms-600 LIMIT 1);
END;
CREATE TRIGGER IF NOT EXISTS royal_slots_settle AFTER INSERT ON sharika_royal_slots_rounds
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.cost,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND NEW.cost>0;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.user_uid,'coins',-NEW.cost,coins,'royal_slots_bet','slots:bet:'||NEW.id
  FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.cost>0;
 UPDATE sharika_users SET coins=coins+NEW.total_win,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND NEW.total_win>0;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.user_uid,'coins',NEW.total_win,coins,'royal_slots_win','slots:win:'||NEW.id
  FROM sharika_users WHERE auth_uid=NEW.user_uid AND NEW.total_win>0;
 INSERT OR IGNORE INTO sharika_royal_slots_free(user_uid,remaining,bet)
  VALUES(NEW.user_uid,0,NEW.bet);
 UPDATE sharika_royal_slots_free SET remaining=MIN(1000,
   MAX(0,remaining-(NEW.mode='free'))+NEW.free_awarded),bet=NEW.bet
   WHERE user_uid=NEW.user_uid;
 UPDATE sharika_royal_slots_settings SET
   jackpot_pool=MIN(1000000000000,MAX(5000000,jackpot_pool+
    CAST(NEW.cost/100 AS INTEGER)-NEW.jackpot_win)),
   updated_at=datetime('now') WHERE id=1;
 UPDATE sharika_royal_slots_rounds SET
  balance_after=(SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  free_after=(SELECT remaining FROM sharika_royal_slots_free WHERE user_uid=NEW.user_uid),
  jackpot_after=(SELECT jackpot_pool FROM sharika_royal_slots_settings WHERE id=1)
  WHERE id=NEW.id;
END;
