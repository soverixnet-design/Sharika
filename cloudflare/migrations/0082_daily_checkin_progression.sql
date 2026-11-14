-- Expand future check-in amounts and preserve every existing reward receipt.
CREATE TABLE sharika_daily_reward_config_new (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  day1 INTEGER NOT NULL CHECK(day1 BETWEEN 1 AND 1000000),
  day2 INTEGER NOT NULL CHECK(day2 BETWEEN 1 AND 1000000),
  day3 INTEGER NOT NULL CHECK(day3 BETWEEN 1 AND 1000000),
  day4 INTEGER NOT NULL CHECK(day4 BETWEEN 1 AND 1000000),
  day5 INTEGER NOT NULL CHECK(day5 BETWEEN 1 AND 1000000),
  day6 INTEGER NOT NULL CHECK(day6 BETWEEN 1 AND 1000000),
  day7 INTEGER NOT NULL CHECK(day7 BETWEEN 1 AND 1000000),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sharika_daily_reward_config_new SELECT * FROM sharika_daily_reward_config;
DROP TABLE sharika_daily_reward_config;
ALTER TABLE sharika_daily_reward_config_new RENAME TO sharika_daily_reward_config;
CREATE TABLE sharika_daily_checkins_new (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  streak INTEGER NOT NULL CHECK(streak BETWEEN 1 AND 7),
  reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,utc_day)
);
INSERT INTO sharika_daily_checkins_new SELECT * FROM sharika_daily_checkins;
DROP TRIGGER sharika_daily_claim_no_update;
DROP TRIGGER sharika_daily_claim_no_delete;
DROP TABLE sharika_daily_checkins;
ALTER TABLE sharika_daily_checkins_new RENAME TO sharika_daily_checkins;
CREATE INDEX idx_sharika_daily_checkins_day ON sharika_daily_checkins(utc_day);
CREATE TRIGGER IF NOT EXISTS sharika_daily_claim_no_update
BEFORE UPDATE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_claim_no_delete
BEFORE DELETE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;
CREATE TABLE sharika_play_daily_config_audit (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL,
  old_rewards TEXT NOT NULL,
  new_rewards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER sharika_play_daily_audit_no_update
BEFORE UPDATE ON sharika_play_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;
CREATE TRIGGER sharika_play_daily_audit_no_delete
BEFORE DELETE ON sharika_play_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;
