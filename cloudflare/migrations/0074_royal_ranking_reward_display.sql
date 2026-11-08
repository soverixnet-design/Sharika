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
VALUES ('lucky'),('rich'),('charm'),('room'),('recharge');

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
SELECT p.kind,n.rank FROM sharika_rank_reward_policy p
CROSS JOIN (SELECT 1 AS rank UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7) n;

CREATE TABLE IF NOT EXISTS sharika_rank_reward_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  old_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
