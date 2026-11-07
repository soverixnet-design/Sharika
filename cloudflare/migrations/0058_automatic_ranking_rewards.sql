-- Optional, versioned ranking rewards backed only by 0057 verified activity.
-- No seed rules, historical payments, balance edits or automatic payouts.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_ranking_reward_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('sending','recharge','game')),
  period TEXT NOT NULL CHECK(period IN ('daily','weekly','monthly')),
  metric TEXT NOT NULL CHECK(metric IN ('coins','wins','stake','payout')),
  game_code TEXT,
  targets_json TEXT NOT NULL CHECK(json_valid(targets_json)),
  prizes_json TEXT NOT NULL CHECK(json_valid(prizes_json)),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  auto_award INTEGER NOT NULL CHECK(auto_award IN (0,1)),
  effective_from TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind='game' AND metric IN ('wins','stake','payout')) OR
    (kind IN ('sending','recharge') AND metric='coins' AND game_code IS NULL))
);
CREATE INDEX IF NOT EXISTS sharika_ranking_reward_policy_lookup
  ON sharika_ranking_reward_policies(policy_key,effective_from DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS sharika_ranking_policy_no_update
BEFORE UPDATE ON sharika_ranking_reward_policies
BEGIN SELECT RAISE(ABORT,'ranking_policy_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_ranking_policy_no_delete
BEFORE DELETE ON sharika_ranking_reward_policies
BEGIN SELECT RAISE(ABORT,'ranking_policy_immutable'); END;

-- An entire period closes in one transaction. A duplicate cron/manual retry
-- cannot credit the same period twice, even under concurrent invocations.
CREATE TABLE IF NOT EXISTS sharika_ranking_reward_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  policy_id INTEGER NOT NULL REFERENCES sharika_ranking_reward_policies(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  winner_count INTEGER NOT NULL DEFAULT 0 CHECK(winner_count BETWEEN 0 AND 7),
  awarded_coins INTEGER NOT NULL DEFAULT 0 CHECK(awarded_coins>=0),
  issued_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(policy_key,period_start)
);
CREATE TABLE IF NOT EXISTS sharika_ranking_reward_awards (
  batch_id INTEGER NOT NULL REFERENCES sharika_ranking_reward_batches(id),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  score TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000),
  PRIMARY KEY(batch_id,rank),
  UNIQUE(batch_id,user_uid)
);
CREATE TRIGGER IF NOT EXISTS sharika_ranking_batch_no_update
BEFORE UPDATE ON sharika_ranking_reward_batches
BEGIN SELECT RAISE(ABORT,'ranking_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_ranking_batch_no_delete
BEFORE DELETE ON sharika_ranking_reward_batches
BEGIN SELECT RAISE(ABORT,'ranking_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_ranking_award_no_update
BEFORE UPDATE ON sharika_ranking_reward_awards
BEGIN SELECT RAISE(ABORT,'ranking_award_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_ranking_award_no_delete
BEFORE DELETE ON sharika_ranking_reward_awards
BEGIN SELECT RAISE(ABORT,'ranking_award_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_ranking_reward_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_ranking_reward_control(id,paused) VALUES(1,1);

-- Re-check the kill switch in the same transaction as the batch receipt.
-- This closes the read/insert race with a concurrent Super Admin pause.
CREATE TRIGGER IF NOT EXISTS sharika_ranking_batch_paused_guard
BEFORE INSERT ON sharika_ranking_reward_batches
WHEN (SELECT paused FROM sharika_ranking_reward_control WHERE id=1)!=0
BEGIN SELECT RAISE(ABORT,'ranking_rewards_paused'); END;
