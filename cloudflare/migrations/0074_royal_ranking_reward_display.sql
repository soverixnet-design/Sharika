-- Read-only reward announcements for verified weekly leaderboards.
-- Deliberately no wallet updates, grants or automatic payout triggers.
CREATE TABLE IF NOT EXISTS sharika_rank_reward_policy (
  kind TEXT PRIMARY KEY CHECK(kind IN ('lucky','rich','charm','room','recharge')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_rank_reward_policy(kind)
VALUES ('lucky');
INSERT OR IGNORE INTO sharika_rank_reward_policy(kind) VALUES ('rich');
INSERT OR IGNORE INTO sharika_rank_reward_policy(kind) VALUES ('charm');
INSERT OR IGNORE INTO sharika_rank_reward_policy(kind) VALUES ('room');
INSERT OR IGNORE INTO sharika_rank_reward_policy(kind) VALUES ('recharge');

CREATE TABLE IF NOT EXISTS sharika_rank_reward_rules (
  kind TEXT NOT NULL REFERENCES sharika_rank_reward_policy(kind),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  entry_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  display_days INTEGER NOT NULL DEFAULT 7 CHECK(display_days BETWEEN 1 AND 30),
  PRIMARY KEY(kind,rank)
);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank)
VALUES ('lucky',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('lucky',7);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('rich',7);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('charm',7);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('room',7);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',1);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',2);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',3);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',4);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',5);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',6);
INSERT OR IGNORE INTO sharika_rank_reward_rules(kind,rank) VALUES ('recharge',7);

CREATE TABLE IF NOT EXISTS sharika_rank_reward_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  old_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
