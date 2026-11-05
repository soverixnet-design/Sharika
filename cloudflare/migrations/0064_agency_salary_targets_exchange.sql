-- Add salary exchange to the existing Agency earnings ledger (0059).
-- Keep historic Family data, gift events, and immutable Agency earnings intact.
-- Salary exchange is intentionally disabled until Super Admin enables it.
CREATE TABLE IF NOT EXISTS sharika_agency_salary_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  coins_per_usd INTEGER NOT NULL DEFAULT 500000 CHECK(coins_per_usd BETWEEN 1 AND 1000000000),
  min_host_target_coins INTEGER NOT NULL DEFAULT 5000000 CHECK(min_host_target_coins>=1),
  exchange_enabled INTEGER NOT NULL DEFAULT 0 CHECK(exchange_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_agency_salary_config(key) VALUES('standard');

CREATE TABLE IF NOT EXISTS sharika_agency_salary_targets (
  target_coins INTEGER PRIMARY KEY CHECK(target_coins>=1),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_agency_salary_targets(target_coins) VALUES
  (5000000),(10000000),(20000000),(50000000),(100000000);

-- Salary uses the existing immutable Agency ledger. 10,000 units = 1 coin.
-- Entries retain historical rate_bps, independent of subsequent policy edits.
CREATE TABLE IF NOT EXISTS sharika_agency_salary_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL,
  salary_units INTEGER NOT NULL CHECK(salary_units>0 AND salary_units%10000=0),
  credited_coins INTEGER NOT NULL CHECK(credited_coins>0 AND credited_coins<=100000000),
  settlement_mode TEXT NOT NULL CHECK(settlement_mode IN ('daily','weekly','monthly')),
  policy_version INTEGER NOT NULL CHECK(policy_version>=1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,request_id),
  CHECK(salary_units=credited_coins*10000)
);
CREATE INDEX IF NOT EXISTS sharika_agency_salary_exchanges_user_idx
  ON sharika_agency_salary_exchanges(auth_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_exchanges_no_update
BEFORE UPDATE ON sharika_agency_salary_exchanges BEGIN
  SELECT RAISE(ABORT,'agency_salary_exchange_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_exchanges_no_delete
BEFORE DELETE ON sharika_agency_salary_exchanges BEGIN
  SELECT RAISE(ABORT,'agency_salary_exchange_immutable');
END;

-- Server-enforced maturity and balance guard. The protected INSERT must be
-- batched atomically with the wallet credit and coin ledger receipt.
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_exchange_guard
BEFORE INSERT ON sharika_agency_salary_exchanges BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_agency_salary_config c
    JOIN sharika_agency_policy p ON p.key=c.key
    WHERE c.key='standard' AND c.exchange_enabled=1 AND p.active=1
      AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode
  ) THEN RAISE(ABORT,'agency_salary_exchange_disabled_or_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid
      AND u.status='active' AND u.minor=0
  ) THEN RAISE(ABORT,'agency_salary_exchange_ineligible') END;
  SELECT CASE WHEN NEW.salary_units > (
    SELECT COALESCE(SUM(a.amount_units),0)
    FROM sharika_agency_earnings a
    JOIN sharika_agency_salary_config c ON c.key='standard'
    WHERE a.beneficiary_uid=NEW.auth_uid
      AND a.created_at < CASE NEW.settlement_mode
        WHEN 'daily' THEN datetime('now','start of day')
        WHEN 'weekly' THEN datetime('now','weekday 0','-6 days','start of day')
        ELSE datetime('now','start of month') END
      AND (
        SELECT COALESCE(SUM(e.quantity*e.price_coins),0)
        FROM sharika_agency_earnings h
        JOIN sharika_gift_events e ON e.id=h.gift_event_id
        WHERE h.kind='host_salary' AND h.host_uid=a.host_uid
      ) >= c.min_host_target_coins
  ) - (
    SELECT COALESCE(SUM(x.salary_units),0) FROM sharika_agency_salary_exchanges x
    WHERE x.auth_uid=NEW.auth_uid
  ) THEN RAISE(ABORT,'agency_salary_not_matured_or_insufficient') END;
END;

CREATE TABLE IF NOT EXISTS sharika_agency_salary_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_json TEXT NOT NULL,
  new_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_policy_audit_no_update
BEFORE UPDATE ON sharika_agency_salary_policy_audit BEGIN
  SELECT RAISE(ABORT,'agency_salary_policy_audit_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_policy_audit_no_delete
BEFORE DELETE ON sharika_agency_salary_policy_audit BEGIN
  SELECT RAISE(ABORT,'agency_salary_policy_audit_immutable');
END;

-- A customized main-wallet rate stays untouched. The historical default
-- 100 diamonds -> 40 coins is switched to the approved 30% only once.
UPDATE sharika_exchange_rate SET coins_per_unit=30,revision=revision+1,
  updated_at=datetime('now')
WHERE id=1 AND diamonds_per_unit=100 AND coins_per_unit=40 AND revision=2;
