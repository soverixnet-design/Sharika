-- Verified daily check-in: only new tables; no existing balances are changed.
CREATE TABLE IF NOT EXISTS sharika_daily_reward_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  day1 INTEGER NOT NULL CHECK(day1 BETWEEN 1 AND 1000),
  day2 INTEGER NOT NULL CHECK(day2 BETWEEN 1 AND 1000),
  day3 INTEGER NOT NULL CHECK(day3 BETWEEN 1 AND 1000),
  day4 INTEGER NOT NULL CHECK(day4 BETWEEN 1 AND 1000),
  day5 INTEGER NOT NULL CHECK(day5 BETWEEN 1 AND 1000),
  day6 INTEGER NOT NULL CHECK(day6 BETWEEN 1 AND 1000),
  day7 INTEGER NOT NULL CHECK(day7 BETWEEN 1 AND 1000),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_daily_reward_config(key,day1,day2,day3,day4,day5,day6,day7)
VALUES('standard',100,150,200,300,400,600,1000);
CREATE TABLE IF NOT EXISTS sharika_daily_checkins (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  streak INTEGER NOT NULL CHECK(streak BETWEEN 1 AND 7),
  reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,utc_day)
);
CREATE INDEX IF NOT EXISTS idx_sharika_daily_checkins_day ON sharika_daily_checkins(utc_day);
CREATE TABLE IF NOT EXISTS sharika_daily_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_rewards TEXT NOT NULL,
  new_rewards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_daily_claim_no_update
BEFORE UPDATE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_claim_no_delete
BEFORE DELETE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_config_audit_no_update
BEFORE UPDATE ON sharika_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;
CREATE TRIGGER IF NOT EXISTS sharika_daily_config_audit_no_delete
BEFORE DELETE ON sharika_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;
