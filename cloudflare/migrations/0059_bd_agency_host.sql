-- BD -> Agency -> Host. New namespace: no legacy Family rows are deleted or
-- renamed and no existing wallet / Diamond Exchange balances are touched.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_agency_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  host_bps INTEGER NOT NULL DEFAULT 4000 CHECK(host_bps BETWEEN 0 AND 10000),
  agency_bps INTEGER NOT NULL DEFAULT 1000 CHECK(agency_bps BETWEEN 0 AND 10000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 10000),
  settlement_mode TEXT NOT NULL DEFAULT 'monthly'
    CHECK(settlement_mode IN ('daily','weekly','monthly')),
  payout_enabled INTEGER NOT NULL DEFAULT 0 CHECK(payout_enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(host_bps+agency_bps+bd_bps<=10000)
);
INSERT OR IGNORE INTO sharika_agency_policy(key) VALUES('standard');
-- Old Family accrual must be OFF before any new Agency accrual can start.
CREATE TRIGGER IF NOT EXISTS sharika_agency_legacy_exclusion
BEFORE UPDATE OF active ON sharika_agency_policy
WHEN NEW.active=1 AND (SELECT active FROM sharika_family_policy WHERE key='standard')!=0
BEGIN SELECT RAISE(ABORT,'legacy_family_commission_still_active'); END;

CREATE TABLE IF NOT EXISTS sharika_agency_targets (
  role TEXT NOT NULL CHECK(role IN ('host','agency','bd')),
  period TEXT NOT NULL CHECK(period IN ('daily','weekly','monthly')),
  target_coins INTEGER NOT NULL DEFAULT 5000000
    CHECK(target_coins BETWEEN 1 AND 1000000000000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  PRIMARY KEY(role,period)
);
INSERT OR IGNORE INTO sharika_agency_targets(role,period,target_coins)
VALUES('host','daily',5000000),('host','weekly',5000000),
 ('host','monthly',5000000),('agency','daily',5000000),
 ('agency','weekly',5000000),('agency','monthly',5000000),
 ('bd','daily',5000000),('bd','weekly',5000000),('bd','monthly',5000000);

CREATE TABLE IF NOT EXISTS sharika_agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 3 AND 40),
  owner_uid TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_agencies_bd ON sharika_agencies(bd_uid,status);
CREATE TABLE IF NOT EXISTS sharika_agency_hosts (
  host_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  agency_id INTEGER NOT NULL REFERENCES sharika_agencies(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed'))
);
CREATE INDEX IF NOT EXISTS sharika_agency_hosts_agency
  ON sharika_agency_hosts(agency_id,status);
-- The Agency Owner is automatically their own Host, without a second click.
CREATE TRIGGER IF NOT EXISTS sharika_agency_owner_auto_host
AFTER INSERT ON sharika_agencies
BEGIN
  INSERT INTO sharika_agency_hosts(host_uid,agency_id)
    VALUES(NEW.owner_uid,NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_protect_owner_host
BEFORE UPDATE OF status,agency_id ON sharika_agency_hosts
WHEN OLD.host_uid=(SELECT owner_uid FROM sharika_agencies WHERE id=OLD.agency_id)
BEGIN SELECT RAISE(ABORT,'agency_owner_host_protected'); END;

CREATE TABLE IF NOT EXISTS sharika_agency_host_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES sharika_agencies(id),
  applicant_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(agency_id,applicant_uid)
);
-- An owner approval racing another Agency's approval must not create two
-- affirmative receipts for one actual Host membership.
CREATE TRIGGER IF NOT EXISTS sharika_agency_host_approval_guard
BEFORE UPDATE OF state ON sharika_agency_host_requests
WHEN OLD.state='pending' AND NEW.state='approved'
BEGIN
  SELECT RAISE(ABORT,'host_membership_conflict') WHERE EXISTS (
    SELECT 1 FROM sharika_agency_hosts h WHERE h.host_uid=NEW.applicant_uid
      AND h.status='active');
  SELECT RAISE(ABORT,'agency_unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_agencies a WHERE a.id=NEW.agency_id AND a.status='active');
  SELECT RAISE(ABORT,'host_not_active') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.applicant_uid
      AND u.status='active');
END;
CREATE TABLE IF NOT EXISTS sharika_agency_grants (
  agency_id INTEGER NOT NULL UNIQUE REFERENCES sharika_agencies(id),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bd_uid,request_id)
);
CREATE TRIGGER IF NOT EXISTS sharika_agency_grants_immutable_update
BEFORE UPDATE ON sharika_agency_grants
BEGIN SELECT RAISE(ABORT,'agency_grant_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_grants_immutable_delete
BEFORE DELETE ON sharika_agency_grants
BEGIN SELECT RAISE(ABORT,'agency_grant_immutable'); END;

-- Exactly 10,000 accrual units represent one coin. Never move coins from or
-- into user wallets here; a future salary exchange needs separate approval.
CREATE TABLE IF NOT EXISTS sharika_agency_commission_ledger (
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  kind TEXT NOT NULL CHECK(kind IN ('host','agency','bd')),
  agency_id INTEGER NOT NULL REFERENCES sharika_agencies(id),
  bd_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  host_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  gift_coins INTEGER NOT NULL CHECK(gift_coins>0),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 10000),
  units INTEGER NOT NULL CHECK(units>0),
  policy_revision INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(gift_event_id,kind)
);
CREATE INDEX IF NOT EXISTS sharika_agency_ledger_beneficiary
  ON sharika_agency_commission_ledger(beneficiary_uid,occurred_at);
CREATE INDEX IF NOT EXISTS sharika_agency_ledger_scope
  ON sharika_agency_commission_ledger(agency_id,kind,occurred_at);
CREATE INDEX IF NOT EXISTS sharika_agency_ledger_bd
  ON sharika_agency_commission_ledger(bd_uid,kind,occurred_at);
CREATE TRIGGER IF NOT EXISTS sharika_agency_ledger_immutable_update
BEFORE UPDATE ON sharika_agency_commission_ledger
BEGIN SELECT RAISE(ABORT,'agency_commission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_ledger_immutable_delete
BEFORE DELETE ON sharika_agency_commission_ledger
BEGIN SELECT RAISE(ABORT,'agency_commission_immutable'); END;

-- Triggers run inside the original verified gift batch. Client-submitted
-- scores and retries cannot mint commissions. Disabled policy yields no rows.
CREATE TRIGGER IF NOT EXISTS sharika_agency_gift_host
AFTER INSERT ON sharika_gift_events
BEGIN
  INSERT OR IGNORE INTO sharika_agency_commission_ledger
    (gift_event_id,kind,agency_id,bd_uid,host_uid,beneficiary_uid,
      gift_coins,rate_bps,units,policy_revision,occurred_at)
  SELECT NEW.id,'host',a.id,a.bd_uid,h.host_uid,h.host_uid,
    NEW.quantity*NEW.price_coins,p.host_bps,
    NEW.quantity*NEW.price_coins*p.host_bps,p.revision,NEW.created_at
  FROM sharika_agency_hosts h JOIN sharika_agencies a ON a.id=h.agency_id
  JOIN sharika_agency_policy p ON p.key='standard' AND p.active=1
  WHERE h.host_uid=NEW.recipient_uid AND h.status='active'
    AND a.status='active' AND p.host_bps>0;
  INSERT OR IGNORE INTO sharika_agency_commission_ledger
    (gift_event_id,kind,agency_id,bd_uid,host_uid,beneficiary_uid,
      gift_coins,rate_bps,units,policy_revision,occurred_at)
  SELECT NEW.id,'agency',a.id,a.bd_uid,h.host_uid,a.owner_uid,
    NEW.quantity*NEW.price_coins,p.agency_bps,
    NEW.quantity*NEW.price_coins*p.agency_bps,p.revision,NEW.created_at
  FROM sharika_agency_hosts h JOIN sharika_agencies a ON a.id=h.agency_id
  JOIN sharika_agency_policy p ON p.key='standard' AND p.active=1
  WHERE h.host_uid=NEW.recipient_uid AND h.status='active'
    AND a.status='active' AND p.agency_bps>0;
  INSERT OR IGNORE INTO sharika_agency_commission_ledger
    (gift_event_id,kind,agency_id,bd_uid,host_uid,beneficiary_uid,
      gift_coins,rate_bps,units,policy_revision,occurred_at)
  SELECT NEW.id,'bd',a.id,a.bd_uid,h.host_uid,a.bd_uid,
    NEW.quantity*NEW.price_coins,p.bd_bps,
    NEW.quantity*NEW.price_coins*p.bd_bps,p.revision,NEW.created_at
  FROM sharika_agency_hosts h JOIN sharika_agencies a ON a.id=h.agency_id
  JOIN sharika_bd_agents b ON b.bd_uid=a.bd_uid AND b.active=1
  JOIN sharika_agency_policy p ON p.key='standard' AND p.active=1
  WHERE h.host_uid=NEW.recipient_uid AND h.status='active'
    AND a.status='active' AND a.bd_uid!=h.host_uid
    AND a.bd_uid!=a.owner_uid AND p.bd_bps>0;
END;

CREATE TABLE IF NOT EXISTS sharika_agency_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_agency_policy_audit_immutable_update
BEFORE UPDATE ON sharika_agency_policy_audit
BEGIN SELECT RAISE(ABORT,'agency_policy_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_policy_audit_immutable_delete
BEFORE DELETE ON sharika_agency_policy_audit
BEGIN SELECT RAISE(ABORT,'agency_policy_audit_immutable'); END;
