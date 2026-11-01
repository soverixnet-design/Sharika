-- Staging-only, opt-in CP top-seven weekly rewards. No wallet changes on migration.
-- Each recipient's award is backed by an immutable receipt and wallet ledger.
CREATE TABLE IF NOT EXISTS sharika_cp_reward_policy (
  key TEXT PRIMARY KEY CHECK(key='weekly'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  auto_award INTEGER NOT NULL DEFAULT 0 CHECK(auto_award IN (0,1)),
  auto_start_week_ms INTEGER NOT NULL DEFAULT 0 CHECK(auto_start_week_ms>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_cp_reward_policy(key) VALUES('weekly');

CREATE TABLE IF NOT EXISTS sharika_cp_reward_rules (
  rank INTEGER PRIMARY KEY CHECK(rank BETWEEN 1 AND 7),
  coins_each INTEGER NOT NULL DEFAULT 0 CHECK(coins_each BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_cp_reward_rules(rank) VALUES(1),(2),(3),(4),(5),(6),(7);

CREATE TABLE IF NOT EXISTS sharika_cp_reward_batches (
  week_start_ms INTEGER PRIMARY KEY CHECK(week_start_ms>0),
  week_end_ms INTEGER NOT NULL CHECK(week_end_ms=week_start_ms+604800000),
  issued_by TEXT NOT NULL,
  awarded_at_ms INTEGER NOT NULL,
  winner_count INTEGER NOT NULL CHECK(winner_count BETWEEN 0 AND 7)
);
CREATE TABLE IF NOT EXISTS sharika_cp_reward_winners (
  week_start_ms INTEGER NOT NULL REFERENCES sharika_cp_reward_batches(week_start_ms),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id),
  uid_a TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  uid_b TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  score INTEGER NOT NULL CHECK(score>=0),
  coins_each INTEGER NOT NULL CHECK(coins_each BETWEEN 0 AND 1000000),
  frame_item_id TEXT,
  medal_item_id TEXT,
  PRIMARY KEY(week_start_ms,rank),
  UNIQUE(week_start_ms,bond_id),
  CHECK(uid_a<>uid_b)
);
CREATE TABLE IF NOT EXISTS sharika_cp_reward_member_awards (
  week_start_ms INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT,
  medal_item_id TEXT,
  awarded_at_ms INTEGER NOT NULL,
  PRIMARY KEY(week_start_ms,auth_uid),
  FOREIGN KEY(week_start_ms,rank) REFERENCES sharika_cp_reward_winners(week_start_ms,rank)
);
CREATE INDEX IF NOT EXISTS sharika_cp_reward_member_history
  ON sharika_cp_reward_member_awards(auth_uid,week_start_ms DESC);

CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_batches_no_update
BEFORE UPDATE ON sharika_cp_reward_batches BEGIN SELECT RAISE(ABORT,'cp_reward_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_batches_no_delete
BEFORE DELETE ON sharika_cp_reward_batches BEGIN SELECT RAISE(ABORT,'cp_reward_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_winners_no_update
BEFORE UPDATE ON sharika_cp_reward_winners BEGIN SELECT RAISE(ABORT,'cp_reward_winner_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_winners_no_delete
BEFORE DELETE ON sharika_cp_reward_winners BEGIN SELECT RAISE(ABORT,'cp_reward_winner_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_member_awards_no_update
BEFORE UPDATE ON sharika_cp_reward_member_awards BEGIN SELECT RAISE(ABORT,'cp_reward_receipt_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_cp_reward_member_awards_no_delete
BEFORE DELETE ON sharika_cp_reward_member_awards BEGIN SELECT RAISE(ABORT,'cp_reward_receipt_immutable'); END;
