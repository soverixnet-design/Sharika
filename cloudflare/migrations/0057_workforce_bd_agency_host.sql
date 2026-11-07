-- Separate BD > Agency > Host workforce; never erase legacy Family history.
-- Salary units = eligible gift coins * basis points (10,000 units = 1 coin).
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_workforce_policy (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  host_bps INTEGER NOT NULL DEFAULT 4000 CHECK(host_bps BETWEEN 0 AND 10000),
  agency_bps INTEGER NOT NULL DEFAULT 1000 CHECK(agency_bps BETWEEN 0 AND 10000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 10000),
  direct_exchange_bps INTEGER NOT NULL DEFAULT 3000 CHECK(direct_exchange_bps BETWEEN 0 AND 10000),
  coins_per_usd INTEGER NOT NULL DEFAULT 500000 CHECK(coins_per_usd BETWEEN 1 AND 1000000000),
  settlement_mode TEXT NOT NULL DEFAULT 'weekly' CHECK(settlement_mode IN ('daily','weekly','monthly')),
  salary_exchange_enabled INTEGER NOT NULL DEFAULT 0 CHECK(salary_exchange_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(host_bps+agency_bps+bd_bps+direct_exchange_bps<=10000)
);
INSERT OR IGNORE INTO sharika_workforce_policy(id) VALUES(1);

CREATE TABLE IF NOT EXISTS sharika_workforce_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_coins INTEGER NOT NULL UNIQUE CHECK(target_coins>=5000000 AND target_coins<=1000000000000),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_workforce_targets(target_coins,label) VALUES
 (5000000,'5M'),(10000000,'10M'),(20000000,'20M'),(50000000,'50M');

CREATE TABLE IF NOT EXISTS sharika_workforce_members (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL CHECK(role IN ('bd','agency','host','assistant_bd','assistant_agency')),
  parent_uid TEXT REFERENCES sharika_users(auth_uid),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((role='bd' AND parent_uid IS NULL) OR (role!='bd' AND parent_uid IS NOT NULL)),
  CHECK(auth_uid != parent_uid)
);
CREATE INDEX IF NOT EXISTS sharika_workforce_members_parent_idx
 ON sharika_workforce_members(parent_uid,role,active);
CREATE TRIGGER IF NOT EXISTS sharika_workforce_member_hierarchy_insert
BEFORE INSERT ON sharika_workforce_members WHEN NEW.role!='bd'
BEGIN
 SELECT RAISE(ABORT,'workforce_parent_invalid') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_workforce_members p JOIN sharika_users u ON u.auth_uid=p.auth_uid
   WHERE p.auth_uid=NEW.parent_uid AND p.active=1 AND u.status='active' AND
   ((NEW.role IN ('agency','assistant_bd') AND p.role='bd') OR
    (NEW.role IN ('host','assistant_agency') AND p.role='agency'))
 );
END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_member_hierarchy_update
BEFORE UPDATE OF role,parent_uid,active ON sharika_workforce_members
BEGIN
 SELECT RAISE(ABORT,'workforce_member_reparent_forbidden')
   WHERE NEW.role!=OLD.role OR NEW.parent_uid IS NOT OLD.parent_uid;
 SELECT RAISE(ABORT,'workforce_parent_invalid') WHERE NEW.active=1 AND NEW.role!='bd'
   AND NOT EXISTS(SELECT 1 FROM sharika_workforce_members p WHERE p.auth_uid=NEW.parent_uid
   AND p.active=1);
 SELECT RAISE(ABORT,'workforce_descendants_active') WHERE NEW.active=0 AND EXISTS(
   SELECT 1 FROM sharika_workforce_members child WHERE child.parent_uid=NEW.auth_uid
   AND child.active=1
 );
END;

CREATE TABLE IF NOT EXISTS sharika_workforce_salary_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  host_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('host','agency','bd')),
  gift_coins INTEGER NOT NULL CHECK(gift_coins>0),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 10000),
  salary_units INTEGER NOT NULL CHECK(salary_units>0),
  policy_version INTEGER NOT NULL CHECK(policy_version>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gift_event_id,kind),
  CHECK(salary_units=gift_coins*rate_bps)
);
CREATE INDEX IF NOT EXISTS sharika_workforce_salary_beneficiary_idx
 ON sharika_workforce_salary_ledger(beneficiary_uid,created_at);
CREATE INDEX IF NOT EXISTS sharika_workforce_salary_host_idx
 ON sharika_workforce_salary_ledger(host_uid,created_at);
CREATE TABLE IF NOT EXISTS sharika_workforce_host_gifts (
  gift_event_id INTEGER PRIMARY KEY REFERENCES sharika_gift_events(id),
  host_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  gift_coins INTEGER NOT NULL CHECK(gift_coins>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_workforce_host_gifts_uid_idx
 ON sharika_workforce_host_gifts(host_uid,created_at);
CREATE TRIGGER IF NOT EXISTS sharika_workforce_host_gifts_immutable_update BEFORE UPDATE ON sharika_workforce_host_gifts
BEGIN SELECT RAISE(ABORT,'workforce_gift_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_host_gifts_immutable_delete BEFORE DELETE ON sharika_workforce_host_gifts
BEGIN SELECT RAISE(ABORT,'workforce_gift_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_salary_immutable_update BEFORE UPDATE ON sharika_workforce_salary_ledger
BEGIN SELECT RAISE(ABORT,'workforce_salary_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_salary_immutable_delete BEFORE DELETE ON sharika_workforce_salary_ledger
BEGIN SELECT RAISE(ABORT,'workforce_salary_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_workforce_salary_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  salary_units INTEGER NOT NULL CHECK(salary_units>=10000 AND salary_units%10000=0),
  credited_coins INTEGER NOT NULL CHECK(credited_coins>0),
  settlement_mode TEXT NOT NULL CHECK(settlement_mode IN ('daily','weekly','monthly')),
  policy_version INTEGER NOT NULL CHECK(policy_version>0),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,request_id),
  CHECK(salary_units=credited_coins*10000)
);
CREATE TRIGGER IF NOT EXISTS sharika_workforce_exchange_guard BEFORE INSERT ON sharika_workforce_salary_exchanges
BEGIN
 SELECT RAISE(ABORT,'salary_exchange_disabled') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_workforce_policy WHERE id=1 AND enabled=1
   AND salary_exchange_enabled=1 AND version=NEW.policy_version
   AND settlement_mode=NEW.settlement_mode
 );
 SELECT RAISE(ABORT,'salary_exchange_ineligible') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_users u JOIN sharika_workforce_members w ON w.auth_uid=u.auth_uid
   WHERE u.auth_uid=NEW.auth_uid AND u.status='active' AND u.minor=0 AND w.active=1
 );
 SELECT RAISE(ABORT,'salary_not_matured_or_insufficient') WHERE NEW.salary_units >
   (SELECT COALESCE(SUM(salary_units),0) FROM sharika_workforce_salary_ledger
    WHERE beneficiary_uid=NEW.auth_uid AND created_at < CASE NEW.settlement_mode
      WHEN 'daily' THEN datetime('now','start of day')
      WHEN 'weekly' THEN datetime('now','weekday 0','-6 days','start of day')
      ELSE datetime('now','start of month') END)
   - (SELECT COALESCE(SUM(salary_units),0) FROM sharika_workforce_salary_exchanges
      WHERE auth_uid=NEW.auth_uid);
END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_exchange_immutable_update BEFORE UPDATE ON sharika_workforce_salary_exchanges
BEGIN SELECT RAISE(ABORT,'salary_exchange_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_exchange_immutable_delete BEFORE DELETE ON sharika_workforce_salary_exchanges
BEGIN SELECT RAISE(ABORT,'salary_exchange_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_workforce_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_json TEXT NOT NULL,
  new_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_workforce_assignment_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('assign','deactivate','reactivate')),
  role TEXT NOT NULL,
  parent_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_workforce_policy_audit_immutable_update BEFORE UPDATE ON sharika_workforce_policy_audit
BEGIN SELECT RAISE(ABORT,'workforce_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_policy_audit_immutable_delete BEFORE DELETE ON sharika_workforce_policy_audit
BEGIN SELECT RAISE(ABORT,'workforce_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_assignment_audit_immutable_update BEFORE UPDATE ON sharika_workforce_assignment_audit
BEGIN SELECT RAISE(ABORT,'workforce_assignment_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_workforce_assignment_audit_immutable_delete BEFORE DELETE ON sharika_workforce_assignment_audit
BEGIN SELECT RAISE(ABORT,'workforce_assignment_audit_immutable'); END;

-- The single authoritative gift event creates all three salaries from that
-- same Host gift base. No client-calculated earnings or double settlements.
-- Lucky Gift tab 2 never generates a salary. Self gifts are eligible.
CREATE TRIGGER IF NOT EXISTS sharika_workforce_settle_host
AFTER INSERT ON sharika_gift_events
WHEN EXISTS(SELECT 1 FROM sharika_gifts g WHERE g.id=NEW.gift_id AND g.tab IN (0,1))
BEGIN
 INSERT INTO sharika_workforce_host_gifts(gift_event_id,host_uid,gift_coins)
 SELECT NEW.id,NEW.recipient_uid,NEW.quantity*NEW.price_coins
 FROM sharika_workforce_members h CROSS JOIN sharika_workforce_policy p
 WHERE h.auth_uid=NEW.recipient_uid AND h.role='host' AND h.active=1
   AND p.enabled=1;
 INSERT INTO sharika_workforce_salary_ledger(gift_event_id,host_uid,beneficiary_uid,kind,gift_coins,rate_bps,salary_units,policy_version)
 SELECT NEW.id,NEW.recipient_uid,h.auth_uid,'host',NEW.quantity*NEW.price_coins,p.host_bps,
   NEW.quantity*NEW.price_coins*p.host_bps,p.version
 FROM sharika_workforce_members h CROSS JOIN sharika_workforce_policy p
 WHERE h.auth_uid=NEW.recipient_uid AND h.role='host' AND h.active=1
   AND p.enabled=1 AND p.host_bps>0;
 INSERT INTO sharika_workforce_salary_ledger(gift_event_id,host_uid,beneficiary_uid,kind,gift_coins,rate_bps,salary_units,policy_version)
 SELECT NEW.id,NEW.recipient_uid,a.auth_uid,'agency',NEW.quantity*NEW.price_coins,p.agency_bps,
   NEW.quantity*NEW.price_coins*p.agency_bps,p.version
 FROM sharika_workforce_members h JOIN sharika_workforce_members a ON a.auth_uid=h.parent_uid
 CROSS JOIN sharika_workforce_policy p
 WHERE h.auth_uid=NEW.recipient_uid AND h.role='host' AND h.active=1
   AND a.role='agency' AND a.active=1 AND p.enabled=1 AND p.agency_bps>0;
 INSERT INTO sharika_workforce_salary_ledger(gift_event_id,host_uid,beneficiary_uid,kind,gift_coins,rate_bps,salary_units,policy_version)
 SELECT NEW.id,NEW.recipient_uid,b.auth_uid,'bd',NEW.quantity*NEW.price_coins,p.bd_bps,
   NEW.quantity*NEW.price_coins*p.bd_bps,p.version
 FROM sharika_workforce_members h
 JOIN sharika_workforce_members a ON a.auth_uid=h.parent_uid
 JOIN sharika_workforce_members b ON b.auth_uid=a.parent_uid
 CROSS JOIN sharika_workforce_policy p
 WHERE h.auth_uid=NEW.recipient_uid AND h.role='host' AND h.active=1
   AND a.role='agency' AND a.active=1 AND b.role='bd' AND b.active=1
   AND p.enabled=1 AND p.bd_bps>0;
END;
