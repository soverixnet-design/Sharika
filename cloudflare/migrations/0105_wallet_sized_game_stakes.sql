-- Apply as one D1 migration. Copy historical receipts before installing debit triggers.

CREATE TABLE sharika_food_deluxe_bets_copy AS SELECT * FROM sharika_food_deluxe_bets;

CREATE TABLE sharika_food_deluxe_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_food_deluxe_bets';

DROP TABLE sharika_food_deluxe_bets;

CREATE TABLE sharika_food_deluxe_bets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 round_id TEXT NOT NULL REFERENCES sharika_food_deluxe_rounds(id),
 round_no INTEGER NOT NULL,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 stakes_json TEXT NOT NULL CHECK(json_valid(stakes_json)),
 total INTEGER NOT NULL CHECK(typeof(total)='integer' AND total BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_food_deluxe_bets SELECT * FROM sharika_food_deluxe_bets_copy;

DROP TABLE sharika_food_deluxe_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_food_deluxe_bets_seq),0)) WHERE name='sharika_food_deluxe_bets';

DROP TABLE sharika_food_deluxe_bets_seq;

CREATE INDEX sharika_food_deluxe_pending ON sharika_food_deluxe_bets(status,round_no);

CREATE INDEX sharika_food_deluxe_user ON sharika_food_deluxe_bets(user_uid,round_no DESC);

CREATE INDEX sharika_food_deluxe_wins ON sharika_food_deluxe_bets(status,settled_at,payout DESC);

CREATE TRIGGER sharika_food_deluxe_validate BEFORE INSERT ON sharika_food_deluxe_bets
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
    WHERE type!='integer' OR CAST(value AS INTEGER)<0);
 SELECT RAISE(ABORT,'food_user_ineligible') WHERE NOT EXISTS (
  SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0
 );
END;

CREATE TRIGGER sharika_food_deluxe_debit AFTER INSERT ON sharika_food_deluxe_bets
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.total,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND coins>=NEW.total AND status='active' AND minor=0;
 SELECT RAISE(ABORT,'food_insufficient_coins') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',-NEW.total,
 (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
 'food_deluxe_bet','food-deluxe:bet:'||NEW.id);
END;

CREATE TRIGGER sharika_food_deluxe_pay AFTER UPDATE OF status ON sharika_food_deluxe_bets
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

CREATE TABLE sharika_original_game_bets_copy AS SELECT * FROM sharika_original_game_bets;

CREATE TABLE sharika_original_game_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_original_game_bets';

DROP TABLE sharika_original_game_bets;

CREATE TABLE sharika_original_game_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK(game IN ('sovera-food','night-food','jackpot-fruit')),
  round_no INTEGER NOT NULL,
  round_id TEXT NOT NULL REFERENCES sharika_original_game_rounds(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 9),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_original_game_bets SELECT * FROM sharika_original_game_bets_copy;

DROP TABLE sharika_original_game_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_original_game_bets_seq),0)) WHERE name='sharika_original_game_bets';

DROP TABLE sharika_original_game_bets_seq;

CREATE INDEX sharika_original_bets_status
  ON sharika_original_game_bets(status,round_no);

CREATE INDEX sharika_original_bets_user
  ON sharika_original_game_bets(user_uid,game,id DESC);

CREATE INDEX sharika_original_bets_rank
  ON sharika_original_game_bets(game,status,settled_at,payout DESC);

CREATE INDEX sharika_original_bets_round
  ON sharika_original_game_bets(game,round_no,amount DESC);

CREATE TRIGGER sharika_original_bet_validate
BEFORE INSERT ON sharika_original_game_bets
BEGIN
  SELECT RAISE(ABORT,'original_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_original_game_rounds
      WHERE id=NEW.round_id AND game=NEW.game AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'original_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR
    (SELECT starts_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
  SELECT RAISE(ABORT,'original_invalid_pick') WHERE
    (NEW.game!='night-food' AND NEW.pick_index>7);
  SELECT RAISE(ABORT,'original_user_ineligible') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
      AND status='active' AND minor=0);
END;

CREATE TRIGGER sharika_original_bet_debit
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

CREATE TRIGGER sharika_original_bet_payout
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

CREATE TABLE sharika_greedy_bets_copy AS SELECT * FROM sharika_greedy_bets;

CREATE TABLE sharika_greedy_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_greedy_bets';

DROP TABLE sharika_greedy_bets;

CREATE TABLE sharika_greedy_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_greedy_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL CHECK(item_id IN
    ('shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato')),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_greedy_bets SELECT * FROM sharika_greedy_bets_copy;

DROP TABLE sharika_greedy_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_greedy_bets_seq),0)) WHERE name='sharika_greedy_bets';

DROP TABLE sharika_greedy_bets_seq;

CREATE INDEX sharika_greedy_pending ON sharika_greedy_bets(status,round_no,id);

CREATE INDEX sharika_greedy_user ON sharika_greedy_bets(user_uid,round_no DESC,id DESC);

CREATE INDEX sharika_greedy_winners ON sharika_greedy_bets(round_id,status,payout DESC);

CREATE TRIGGER sharika_greedy_bet_debit
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

CREATE TRIGGER sharika_greedy_bet_payout
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

CREATE TRIGGER sharika_greedy_bet_validate
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
END;

CREATE TABLE sharika_greedy_classic_bets_copy AS SELECT * FROM sharika_greedy_classic_bets;

CREATE TABLE sharika_greedy_classic_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_greedy_classic_bets';

DROP TABLE sharika_greedy_classic_bets;

CREATE TABLE sharika_greedy_classic_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_greedy_classic_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL CHECK(item_id IN
    ('chicken','fish','hotdog','steak','grape','lettuce','pepper','watermelon')),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_greedy_classic_bets SELECT * FROM sharika_greedy_classic_bets_copy;

DROP TABLE sharika_greedy_classic_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_greedy_classic_bets_seq),0)) WHERE name='sharika_greedy_classic_bets';

DROP TABLE sharika_greedy_classic_bets_seq;

CREATE INDEX sharika_greedy_classic_pending ON sharika_greedy_classic_bets(status,round_no,id);

CREATE INDEX sharika_greedy_classic_user ON sharika_greedy_classic_bets(user_uid,round_no DESC,id DESC);

CREATE INDEX sharika_greedy_classic_winners ON sharika_greedy_classic_bets(round_id,status,payout DESC);

CREATE TRIGGER sharika_greedy_classic_bet_debit
AFTER INSERT ON sharika_greedy_classic_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND minor=0 AND status='active';
  SELECT RAISE(ABORT,'greedy_classic_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_classic_bet','greedy-classic:bet:'||NEW.id);
END;

CREATE TRIGGER sharika_greedy_classic_bet_payout
AFTER UPDATE OF status ON sharika_greedy_classic_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'greedy_classic_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_classic_win','greedy-classic:win:'||NEW.id);
END;

CREATE TRIGGER sharika_greedy_classic_bet_validate
BEFORE INSERT ON sharika_greedy_classic_bets
BEGIN
  SELECT RAISE(ABORT,'greedy_classic_round_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_classic_rounds
    WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'greedy_classic_betting_closed') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_classic_rounds WHERE id=NEW.round_id
    AND starts_ms <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND bet_closes_ms > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
  SELECT RAISE(ABORT,'greedy_classic_user_ineligible') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
    AND status='active' AND minor=0);
END;

CREATE TABLE sharika_gaddy_bets_copy AS SELECT * FROM sharika_gaddy_bets;

CREATE TABLE sharika_gaddy_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_gaddy_bets';

DROP TABLE sharika_gaddy_bets;

CREATE TABLE sharika_gaddy_bets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 round_id TEXT NOT NULL REFERENCES sharika_gaddy_rounds(id),
 round_no INTEGER NOT NULL,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_gaddy_bets SELECT * FROM sharika_gaddy_bets_copy;

DROP TABLE sharika_gaddy_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_gaddy_bets_seq),0)) WHERE name='sharika_gaddy_bets';

DROP TABLE sharika_gaddy_bets_seq;

CREATE INDEX sharika_gaddy_bets_unsettled
 ON sharika_gaddy_bets(status,round_no);

CREATE INDEX sharika_gaddy_bets_user
 ON sharika_gaddy_bets(user_uid,id DESC);

CREATE INDEX sharika_gaddy_bets_winners
 ON sharika_gaddy_bets(round_id,payout DESC);

CREATE TRIGGER sharika_gaddy_validate BEFORE INSERT ON sharika_gaddy_bets
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

CREATE TRIGGER sharika_gaddy_debit AFTER INSERT ON sharika_gaddy_bets
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND status='active' AND minor=0;
 SELECT RAISE(ABORT,'gaddy_insufficient_coins') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',-NEW.amount,
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  'gaddy_game_bet','gaddy:bet:'||NEW.id);
END;

CREATE TRIGGER sharika_gaddy_payout AFTER UPDATE OF status ON sharika_gaddy_bets
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

CREATE TABLE sharika_fruit_royale_bets_copy AS SELECT * FROM sharika_fruit_royale_bets;

CREATE TABLE sharika_fruit_royale_bets_seq AS SELECT seq FROM sqlite_sequence WHERE name='sharika_fruit_royale_bets';

DROP TABLE sharika_fruit_royale_bets;

CREATE TABLE sharika_fruit_royale_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_fruit_royale_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
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

INSERT INTO sharika_fruit_royale_bets SELECT * FROM sharika_fruit_royale_bets_copy;

DROP TABLE sharika_fruit_royale_bets_copy;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sharika_fruit_royale_bets_seq),0)) WHERE name='sharika_fruit_royale_bets';

DROP TABLE sharika_fruit_royale_bets_seq;

CREATE INDEX sharika_fruit_bets_status
  ON sharika_fruit_royale_bets(status,round_no);

CREATE INDEX sharika_fruit_bets_user
  ON sharika_fruit_royale_bets(user_uid,id DESC);

CREATE INDEX sharika_fruit_bets_round
  ON sharika_fruit_royale_bets(round_id,id);

CREATE INDEX sharika_fruit_bets_rank
  ON sharika_fruit_royale_bets(status,settled_at,payout DESC);

CREATE TRIGGER sharika_fruit_bet_validate
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

CREATE TRIGGER sharika_fruit_settlement_immutable
BEFORE UPDATE ON sharika_fruit_royale_bets
WHEN OLD.status='settled'
BEGIN
  SELECT RAISE(ABORT,'fruit_settlement_immutable');
END;

CREATE TRIGGER sharika_fruit_history_no_delete
BEFORE DELETE ON sharika_fruit_royale_bets
BEGIN
  SELECT RAISE(ABORT,'fruit_history_immutable');
END;

CREATE TRIGGER sharika_fruit_bet_debit
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

CREATE TRIGGER sharika_fruit_bet_credit
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

DROP TRIGGER royal_slots_validate;

CREATE TRIGGER royal_slots_validate BEFORE INSERT ON sharika_royal_slots_rounds
BEGIN
 SELECT RAISE(ABORT,'slots_disabled') WHERE
  COALESCE((SELECT enabled FROM sharika_royal_slots_settings WHERE id=1),0)!=1 OR
  COALESCE((SELECT enabled FROM sharika_game_catalog WHERE id='royal-slots'),0)!=1;
 SELECT RAISE(ABORT,'slots_ineligible') WHERE NOT EXISTS(
  SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
 SELECT RAISE(ABORT,'invalid_bet') WHERE typeof(NEW.bet)!='integer' OR NEW.bet NOT BETWEEN 1 AND 9007199254740991;
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
END;

DROP TRIGGER royal_ace_validate;

CREATE TRIGGER royal_ace_validate BEFORE INSERT ON sharika_royal_ace_rounds
BEGIN
  SELECT RAISE(ABORT,'royal_disabled') WHERE
    (SELECT enabled FROM sharika_royal_ace_settings WHERE id=1)!=1 OR
    COALESCE((SELECT enabled FROM sharika_game_catalog WHERE id='royal-ace'),0)!=1;
  SELECT RAISE(ABORT,'royal_ineligible') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
  SELECT RAISE(ABORT,'invalid_bet') WHERE typeof(NEW.bet)!='integer' OR NEW.bet NOT BETWEEN 1 AND 9007199254740991;
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
    ELSE NEW.bet*10 END;
  SELECT RAISE(ABORT,'royal_insufficient') WHERE
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.cost;
END;

DROP TRIGGER sharika_cleopatra_validate;

CREATE TRIGGER sharika_cleopatra_validate BEFORE INSERT ON sharika_cleopatra_rounds
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
 SELECT RAISE(ABORT,'invalid_bet') WHERE typeof(NEW.bet)!='integer' OR NEW.bet NOT BETWEEN 1 AND 9007199254740991;
 SELECT RAISE(ABORT,'cleopatra_insufficient_balance') WHERE NEW.is_free_spin=0 AND
   (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.bet;
END;
