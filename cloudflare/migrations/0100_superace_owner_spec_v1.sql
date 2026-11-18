-- Sharika STAGING ONLY. Owner's "Super Ace Deluxe Server Integration Spec" v1,
-- Section 12 overrides Section 2 tuning. Do not replay against production/Play.
-- 0098 and 0099 must exist. 465+ historical staging rounds remain untouched.
-- Disable new wagers until spec tuning and wallet/room QA are approved.
CREATE TRIGGER IF NOT EXISTS royal_ace_spec_migration_guard
BEFORE INSERT ON sharika_royal_ace_rounds
BEGIN SELECT RAISE(ABORT,'superace_spec_migrating'); END;

UPDATE sharika_royal_ace_settings
SET enabled=0,bets_json='[100,200,500,1000,2000,5000,10000,50000]',
    max_win=500000000,updated_at=datetime('now')
WHERE id=1;
UPDATE sharika_game_catalog SET enabled=0 WHERE id='royal-ace';

ALTER TABLE sharika_royal_ace_rounds ADD COLUMN result_json TEXT;

CREATE TABLE IF NOT EXISTS sharika_royal_ace_sessions(
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 12 AND 72),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  bet INTEGER NOT NULL CHECK(bet>0),
  spins_total INTEGER NOT NULL CHECK(spins_total BETWEEN 0 AND 1000),
  spins_done INTEGER NOT NULL CHECK(spins_done BETWEEN 0 AND 1000),
  total_win INTEGER NOT NULL DEFAULT 0 CHECK(total_win>=0),
  status TEXT NOT NULL CHECK(status IN('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS sharika_superace_one_open_session
 ON sharika_royal_ace_sessions(user_uid) WHERE status='open';
CREATE INDEX IF NOT EXISTS sharika_superace_session_user_history
 ON sharika_royal_ace_sessions(user_uid,created_at DESC);

-- Preserve any pre-migration free games. New session rows are appended without
-- retroactively rewriting old ledger rows or changing old balances.
INSERT OR IGNORE INTO sharika_royal_ace_sessions
(id,user_uid,bet,spins_total,spins_done,total_win,status)
SELECT 'sa_'||lower(hex(randomblob(20))),user_uid,bet,remaining,0,0,'open'
FROM sharika_royal_ace_free WHERE remaining>0;

DROP TRIGGER IF EXISTS royal_ace_validate;
CREATE TRIGGER royal_ace_validate BEFORE INSERT ON sharika_royal_ace_rounds
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
 SELECT RAISE(ABORT,'royal_invalid_payout') WHERE
  NEW.win>MIN(NEW.bet*10000,
   (SELECT max_win FROM sharika_royal_ace_settings WHERE id=1))
  OR (NEW.mode='bonus_buy' AND (NEW.win!=0 OR NEW.bonus_spins!=10));
 SELECT RAISE(ABORT,'royal_insufficient') WHERE
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.cost;
 SELECT RAISE(ABORT,'royal_rate_limited') WHERE EXISTS(
  SELECT 1 FROM sharika_royal_ace_rounds WHERE
   user_uid=NEW.user_uid AND created_ms>NEW.created_ms-600 LIMIT 1);
END;

DROP TRIGGER IF EXISTS royal_ace_settle;
CREATE TRIGGER royal_ace_settle AFTER INSERT ON sharika_royal_ace_rounds
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.cost,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND NEW.cost>0;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.user_uid,'coins',-NEW.cost,
   coins,CASE WHEN NEW.mode='bonus_buy' THEN 'royal_ace_bonus'
      ELSE 'royal_ace_bet' END,'royal:bet:'||NEW.id
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
 -- Close old session only when its remaining spins are actually exhausted.
 UPDATE sharika_royal_ace_sessions SET
  spins_done=spins_done+1,spins_total=spins_total+NEW.bonus_spins,
  total_win=total_win+NEW.win,
  status=CASE WHEN (SELECT remaining FROM sharika_royal_ace_free
   WHERE user_uid=NEW.user_uid)=0 THEN 'closed' ELSE 'open' END,
  updated_at=datetime('now')
 WHERE user_uid=NEW.user_uid AND status='open' AND NEW.mode='free';
 -- New bonus or paid-triggered Free Game creates its server-owned session.
 INSERT INTO sharika_royal_ace_sessions
  (id,user_uid,bet,spins_total,spins_done,total_win,status)
 SELECT 'sa_'||lower(hex(randomblob(20))),NEW.user_uid,NEW.bet,
  10,0,0,'open'
 WHERE NEW.mode='bonus_buy' OR (NEW.mode='paid' AND NEW.bonus_spins>=10);
 UPDATE sharika_royal_ace_rounds SET
  balance_after=(SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  free_after=(SELECT remaining FROM sharika_royal_ace_free WHERE user_uid=NEW.user_uid)
 WHERE id=NEW.id;
END;

DROP TRIGGER IF EXISTS royal_ace_spec_migration_guard;
