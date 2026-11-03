-- VIP / SVIP / Noble membership for isolated Sharika staging.
-- Configurable automatic qualification, admin grants and coin purchases.
-- Existing users and wallet balances are never changed by this migration.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sharika_premium_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  purchase_enabled INTEGER NOT NULL DEFAULT 1 CHECK(purchase_enabled IN (0,1)),
  admin_grant_enabled INTEGER NOT NULL DEFAULT 1 CHECK(admin_grant_enabled IN (0,1)),
  auto_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_enabled IN (0,1)),
  auto_by_level INTEGER NOT NULL DEFAULT 1 CHECK(auto_by_level IN (0,1)),
  auto_by_gifts INTEGER NOT NULL DEFAULT 1 CHECK(auto_by_gifts IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_premium_policy(key) VALUES('standard');

CREATE TABLE IF NOT EXISTS sharika_premium_tiers (
  tier TEXT PRIMARY KEY CHECK(tier IN ('vip','svip','noble')),
  rank INTEGER NOT NULL UNIQUE CHECK(rank BETWEEN 1 AND 3),
  min_wealth_level INTEGER NOT NULL CHECK(min_wealth_level BETWEEN 1 AND 500),
  min_gift_coins INTEGER NOT NULL CHECK(min_gift_coins BETWEEN 1 AND 1000000000000),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 365),
  daily_bonus_coins INTEGER NOT NULL CHECK(daily_bonus_coins BETWEEN 0 AND 10000)
);
INSERT OR IGNORE INTO sharika_premium_tiers
  (tier,rank,min_wealth_level,min_gift_coins,price_coins,duration_days,daily_bonus_coins)
VALUES ('vip',1,10,10000,10000,30,100),
       ('svip',2,25,100000,50000,30,300),
       ('noble',3,50,1000000,200000,30,1000);

CREATE TABLE IF NOT EXISTS sharika_premium_memberships (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  source TEXT NOT NULL CHECK(source IN ('purchase','admin')),
  starts_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>starts_at_ms),
  granted_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_premium_expiry ON sharika_premium_memberships(expires_at_ms);

CREATE TABLE IF NOT EXISTS sharika_premium_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  request_id TEXT NOT NULL,
  price_coins INTEGER NOT NULL CHECK(price_coins>0),
  starts_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(auth_uid,request_id)
);

CREATE TABLE IF NOT EXISTS sharika_premium_daily_claims (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL,
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  reward_coins INTEGER NOT NULL CHECK(reward_coins>0),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(auth_uid,utc_day)
);

CREATE TABLE IF NOT EXISTS sharika_premium_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_premium_audit_immutable_update
BEFORE UPDATE ON sharika_premium_audit BEGIN SELECT RAISE(ABORT,'premium_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_premium_audit_immutable_delete
BEFORE DELETE ON sharika_premium_audit BEGIN SELECT RAISE(ABORT,'premium_audit_immutable'); END;

CREATE INDEX IF NOT EXISTS sharika_gift_events_sender_premium
  ON sharika_gift_events(sender_uid,id DESC);
