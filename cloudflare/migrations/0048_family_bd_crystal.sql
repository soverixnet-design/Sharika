-- Royal Family + Business Developer: staging-only, additive schema.
-- Does not alter existing user balances, gift history, or seller stock.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_family_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  owner_bps INTEGER NOT NULL DEFAULT 1000 CHECK(owner_bps BETWEEN 0 AND 2000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 1000),
  settlement_mode TEXT NOT NULL DEFAULT 'monthly' CHECK(settlement_mode IN ('daily','monthly')),
  max_members INTEGER NOT NULL DEFAULT 20 CHECK(max_members BETWEEN 2 AND 200),
  conversion_enabled INTEGER NOT NULL DEFAULT 0 CHECK(conversion_enabled IN (0,1)),
  coins_per_crystal INTEGER NOT NULL DEFAULT 1 CHECK(coins_per_crystal BETWEEN 1 AND 10000),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(owner_bps+bd_bps<=2500)
);
INSERT OR IGNORE INTO sharika_family_policy(key) VALUES('standard');

CREATE TABLE IF NOT EXISTS sharika_bd_agents (
  bd_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  can_grant INTEGER NOT NULL DEFAULT 0 CHECK(can_grant IN (0,1)),
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 3 AND 40),
  owner_uid TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_families_bd_idx ON sharika_families(bd_uid,created_at DESC);
CREATE TABLE IF NOT EXISTS sharika_family_members (
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('leader','co_leader','elder','member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_family_members_family_idx ON sharika_family_members(family_id);
CREATE TABLE IF NOT EXISTS sharika_family_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  applicant_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE(family_id,applicant_uid)
);
CREATE TABLE IF NOT EXISTS sharika_family_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL UNIQUE REFERENCES sharika_families(id),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bd_uid,request_id)
);
CREATE TRIGGER IF NOT EXISTS sharika_family_grants_immutable_update
BEFORE UPDATE ON sharika_family_grants BEGIN SELECT RAISE(ABORT,'family_grant_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_family_grants_immutable_delete
BEFORE DELETE ON sharika_family_grants BEGIN SELECT RAISE(ABORT,'family_grant_immutable'); END;

-- 10000 crystal_units = 1 Crystal; never use floats for financial ledgers.
-- Gift value in coins multiplied by basis points yields exact crystal units.
CREATE TABLE IF NOT EXISTS sharika_family_crystal_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('family_owner','bd')),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 2500),
  crystal_units INTEGER NOT NULL CHECK(crystal_units>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gift_event_id,kind)
);
CREATE INDEX IF NOT EXISTS sharika_crystal_ledger_user_idx
  ON sharika_family_crystal_ledger(beneficiary_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_family_crystal_immutable_update
BEFORE UPDATE ON sharika_family_crystal_ledger BEGIN SELECT RAISE(ABORT,'crystal_ledger_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_family_crystal_immutable_delete
BEFORE DELETE ON sharika_family_crystal_ledger BEGIN SELECT RAISE(ABORT,'crystal_ledger_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_family_crystal_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  crystal_units INTEGER NOT NULL CHECK(crystal_units>=10000 AND crystal_units%10000=0),
  coins_to_seller INTEGER NOT NULL DEFAULT 0 CHECK(coins_to_seller>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  approved_by TEXT REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(sender_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_crystal_transfers_seller_idx
  ON sharika_family_crystal_transfers(seller_uid,status,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_family_transfer_balance_guard
BEFORE INSERT ON sharika_family_crystal_transfers
BEGIN
  SELECT RAISE(ABORT,'crystal_insufficient')
  WHERE NEW.crystal_units > (
    SELECT COALESCE(SUM(crystal_units),0) FROM sharika_family_crystal_ledger
      WHERE beneficiary_uid=NEW.sender_uid
  ) - (
    SELECT COALESCE(SUM(crystal_units),0) FROM sharika_family_crystal_transfers
      WHERE sender_uid=NEW.sender_uid AND status IN ('pending','approved')
  );
  SELECT RAISE(ABORT,'seller_not_approved')
  WHERE NOT EXISTS (SELECT 1 FROM sharika_coin_sellers
    WHERE seller_uid=NEW.seller_uid AND active=1);
END;
CREATE TABLE IF NOT EXISTS sharika_family_transfer_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL UNIQUE REFERENCES sharika_family_crystal_transfers(id),
  admin_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('approved','rejected')),
  coins_added INTEGER NOT NULL DEFAULT 0 CHECK(coins_added>=0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_family_transfer_audit_immutable_update
BEFORE UPDATE ON sharika_family_transfer_audit BEGIN SELECT RAISE(ABORT,'transfer_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_family_transfer_audit_immutable_delete
BEFORE DELETE ON sharika_family_transfer_audit BEGIN SELECT RAISE(ABORT,'transfer_audit_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_family_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_family_policy_audit_no_update
BEFORE UPDATE ON sharika_family_policy_audit BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_family_policy_audit_no_delete
BEFORE DELETE ON sharika_family_policy_audit BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;
