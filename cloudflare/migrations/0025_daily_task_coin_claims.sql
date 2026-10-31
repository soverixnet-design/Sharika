-- Staging only: repeatable, server-verified daily tasks.
-- No existing wallet balances or existing check-in streaks are modified.
CREATE TABLE IF NOT EXISTS sharika_daily_task_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  follow_coins INTEGER NOT NULL CHECK(follow_coins BETWEEN 1 AND 1000),
  gift_coins INTEGER NOT NULL CHECK(gift_coins BETWEEN 1 AND 1000),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_daily_task_config(key,follow_coins,gift_coins)
VALUES('standard',50,100);

CREATE TABLE IF NOT EXISTS sharika_daily_task_claims (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  task_key TEXT NOT NULL CHECK(task_key IN ('follow','gift')),
  reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,utc_day,task_key)
);
CREATE INDEX IF NOT EXISTS idx_sharika_daily_task_claims_day
  ON sharika_daily_task_claims(utc_day);

CREATE TABLE IF NOT EXISTS sharika_daily_task_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_rewards TEXT NOT NULL,
  new_rewards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_daily_task_claim_no_update
BEFORE UPDATE ON sharika_daily_task_claims
BEGIN SELECT RAISE(ABORT,'immutable daily task claim'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_task_claim_no_delete
BEFORE DELETE ON sharika_daily_task_claims
BEGIN SELECT RAISE(ABORT,'immutable daily task claim'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_task_config_audit_no_update
BEFORE UPDATE ON sharika_daily_task_config_audit
BEGIN SELECT RAISE(ABORT,'immutable task config audit'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_task_config_audit_no_delete
BEFORE DELETE ON sharika_daily_task_config_audit
BEGIN SELECT RAISE(ABORT,'immutable task config audit'); END;
