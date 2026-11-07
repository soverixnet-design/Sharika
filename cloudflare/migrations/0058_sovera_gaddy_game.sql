-- Separate 30-second Sovera Gaddy rounds. Existing original-game, wallet and
-- family records are untouched. Every wager and payout is accounted in D1.
CREATE TABLE IF NOT EXISTS sharika_gaddy_rounds (
 id TEXT PRIMARY KEY,
 round_no INTEGER NOT NULL UNIQUE CHECK(round_no>=0),
 starts_ms INTEGER NOT NULL,
 bet_closes_ms INTEGER NOT NULL,
 closes_ms INTEGER NOT NULL,
 seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
 commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
 weights_json TEXT NOT NULL,
 multipliers_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);
CREATE TABLE IF NOT EXISTS sharika_gaddy_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 weights_json TEXT NOT NULL,
 multipliers_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_gaddy_config(id,weights_json,multipliers_json)
 VALUES(1,'[20,36,60,90,180,180,180,180,37,37]',
 '[45,25,15,10,5,5,5,5,2,2]');
CREATE TABLE IF NOT EXISTS sharika_gaddy_bets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 round_id TEXT NOT NULL REFERENCES sharika_gaddy_rounds(id),
 round_no INTEGER NOT NULL,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
 amount INTEGER NOT NULL CHECK(amount IN (50,500,2000,10000)),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
 payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
 result_key TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 settled_at TEXT,
 UNIQUE(user_uid,request_id),
 CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
       (status='settled' AND settled_at IS NOT NULL AND result_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sharika_gaddy_bets_unsettled
 ON sharika_gaddy_bets(status,round_no);
CREATE INDEX IF NOT EXISTS sharika_gaddy_bets_user
 ON sharika_gaddy_bets(user_uid,id DESC);
CREATE INDEX IF NOT EXISTS sharika_gaddy_bets_winners
 ON sharika_gaddy_bets(round_id,payout DESC);
CREATE TRIGGER IF NOT EXISTS sharika_gaddy_validate BEFORE INSERT ON sharika_gaddy_bets
BEGIN
 SELECT RAISE(ABORT,'gaddy_round_mismatch') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_gaddy_rounds WHERE id=NEW.round_id AND round_no=NEW.round_no);
 SELECT RAISE(ABORT,'gaddy_betting_closed') WHERE
   (SELECT bet_closes_ms FROM sharika_gaddy_rounds WHERE id=NEW.round_id)
     <=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR
   (SELECT starts_ms FROM sharika_gaddy_rounds WHERE id=NEW.round_id)
     >CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
 SELECT RAISE(ABORT,'gaddy_ineligible') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
END;
CREATE TRIGGER IF NOT EXISTS sharika_gaddy_debit AFTER INSERT ON sharika_gaddy_bets
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND status='active' AND minor=0;
 SELECT RAISE(ABORT,'gaddy_insufficient_coins') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',-NEW.amount,
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  'gaddy_game_bet','gaddy:bet:'||NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sharika_gaddy_payout AFTER UPDATE OF status ON sharika_gaddy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
 UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid;
 SELECT RAISE(ABORT,'gaddy_payout_user_missing') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',NEW.payout,
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  'gaddy_game_win','gaddy:win:'||NEW.id);
END;
INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES('sovera-gaddy',1);
