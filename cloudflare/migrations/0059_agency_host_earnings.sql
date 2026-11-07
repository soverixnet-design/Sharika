-- Additive Agency/BD/Host system. Family records and prior Crystal balances
-- remain untouched. Earnings are pending estimates, never wallet credits.
CREATE TABLE IF NOT EXISTS sharika_agency_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  host_bps INTEGER NOT NULL DEFAULT 4000 CHECK(host_bps BETWEEN 0 AND 8000),
  agency_bps INTEGER NOT NULL DEFAULT 1000 CHECK(agency_bps BETWEEN 0 AND 5000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 3000),
  settlement_mode TEXT NOT NULL DEFAULT 'weekly'
    CHECK(settlement_mode IN ('daily','weekly','monthly')),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(host_bps+agency_bps+bd_bps<=10000)
);
INSERT OR IGNORE INTO sharika_agency_policy(key) VALUES('standard');

-- Hosts must belong to an existing approved Family (displayed as Agency).
CREATE TABLE IF NOT EXISTS sharika_agency_hosts (
  host_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_agency_hosts_family_idx
  ON sharika_agency_hosts(family_id,active);

-- One immutable entry per real settled gift-recipient event and role.
-- 10000 amount_units = 1 estimated coin, so no fractional coins are lost.
CREATE TABLE IF NOT EXISTS sharika_agency_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  host_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('host_salary','agency','bd')),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 10000),
  amount_units INTEGER NOT NULL CHECK(amount_units>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gift_event_id,kind)
);
CREATE INDEX IF NOT EXISTS sharika_agency_earnings_user_idx
  ON sharika_agency_earnings(beneficiary_uid,created_at DESC);
CREATE INDEX IF NOT EXISTS sharika_agency_earnings_host_idx
  ON sharika_agency_earnings(host_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_agency_earnings_no_update
BEFORE UPDATE ON sharika_agency_earnings BEGIN SELECT RAISE(ABORT,'agency_earnings_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_earnings_no_delete
BEFORE DELETE ON sharika_agency_earnings BEGIN SELECT RAISE(ABORT,'agency_earnings_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_agency_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_agency_policy_audit_no_update
BEFORE UPDATE ON sharika_agency_policy_audit BEGIN SELECT RAISE(ABORT,'agency_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_policy_audit_no_delete
BEFORE DELETE ON sharika_agency_policy_audit BEGIN SELECT RAISE(ABORT,'agency_audit_immutable'); END;

-- Only switch the untouched legacy 100:70 rate. A customized admin rate is
-- preserved and must be changed deliberately using the existing rate editor.
UPDATE sharika_exchange_rate
SET diamonds_per_unit=100,coins_per_unit=40,revision=revision+1,
    updated_at=datetime('now')
WHERE id=1 AND diamonds_per_unit=100 AND coins_per_unit=70 AND revision=1;
