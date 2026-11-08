-- Two additional ranking categories; preserve the existing 0074 policies,
-- rules and audit history without rebuilding constrained tables.
CREATE TABLE IF NOT EXISTS sharika_rank_reward_policy_extra (
  kind TEXT PRIMARY KEY CHECK(kind IN ('noble','games')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_rank_reward_policy_extra(kind) VALUES('noble');
INSERT OR IGNORE INTO sharika_rank_reward_policy_extra(kind) VALUES('games');
CREATE TABLE IF NOT EXISTS sharika_rank_reward_rules_extra (
  kind TEXT NOT NULL REFERENCES sharika_rank_reward_policy_extra(kind),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  entry_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  display_days INTEGER NOT NULL DEFAULT 7 CHECK(display_days BETWEEN 1 AND 30),
  PRIMARY KEY(kind,rank)
);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('noble',7);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules_extra(kind,rank) VALUES('games',7);
