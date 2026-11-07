-- Salary Wallet has two mutually exclusive settlement paths:
-- exchange -> user's Main Coin Wallet, or transfer -> an approved Coin Seller's stock.
-- No user coins/diamonds are debited by seller transfer. This migration is additive,
-- preserves all existing earnings/exchanges, and starts seller transfer disabled.
ALTER TABLE sharika_agency_salary_config
  ADD COLUMN seller_transfer_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(seller_transfer_enabled IN (0,1));

CREATE TABLE IF NOT EXISTS sharika_agency_salary_seller_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  request_id TEXT NOT NULL,
  salary_units INTEGER NOT NULL CHECK(salary_units>0 AND salary_units%10000=0),
  credited_stock_coins INTEGER NOT NULL CHECK(credited_stock_coins BETWEEN 1 AND 100000000),
  stock_after INTEGER NOT NULL CHECK(stock_after BETWEEN 0 AND 1000000000),
  settlement_mode TEXT NOT NULL CHECK(settlement_mode IN ('daily','weekly','monthly')),
  policy_version INTEGER NOT NULL CHECK(policy_version>=1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,request_id),
  CHECK(salary_units=credited_stock_coins*10000)
);
CREATE INDEX IF NOT EXISTS sharika_agency_salary_seller_user_idx
  ON sharika_agency_salary_seller_transfers(auth_uid,created_at DESC);
CREATE INDEX IF NOT EXISTS sharika_agency_salary_seller_recipient_idx
  ON sharika_agency_salary_seller_transfers(seller_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_seller_no_update
BEFORE UPDATE ON sharika_agency_salary_seller_transfers BEGIN
  SELECT RAISE(ABORT,'agency_salary_seller_transfer_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_seller_no_delete
BEFORE DELETE ON sharika_agency_salary_seller_transfers BEGIN
  SELECT RAISE(ABORT,'agency_salary_seller_transfer_immutable');
END;

-- Guard transfer and seller-stock credit in the same D1 batch.
-- This also enforces permission, maturity, target, and single spending of Salary.
CREATE TRIGGER IF NOT EXISTS sharika_agency_salary_seller_guard
BEFORE INSERT ON sharika_agency_salary_seller_transfers BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_agency_salary_config c
    JOIN sharika_agency_policy p ON p.key=c.key
    WHERE c.key='standard' AND c.seller_transfer_enabled=1 AND p.active=1
      AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode
  ) THEN RAISE(ABORT,'agency_salary_seller_transfer_disabled_or_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid
      AND u.status='active' AND u.minor=0
  ) THEN RAISE(ABORT,'agency_salary_seller_transfer_ineligible') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_coin_sellers s
    JOIN sharika_users u ON u.auth_uid=s.seller_uid
    WHERE s.seller_uid=NEW.seller_uid AND s.active=1 AND u.status='active'
      AND u.minor=0 AND s.available_coins=NEW.stock_after
  ) THEN RAISE(ABORT,'agency_salary_seller_unavailable') END;
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
  ) - (
    SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t
    WHERE t.auth_uid=NEW.auth_uid
  ) THEN RAISE(ABORT,'agency_salary_not_matured_or_insufficient') END;
END;

-- Replace the exchange guard so an Exchange cannot reuse Salary sent to a Seller.
DROP TRIGGER IF EXISTS sharika_agency_salary_exchange_guard;
CREATE TRIGGER sharika_agency_salary_exchange_guard
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
  ) - (
    SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t
    WHERE t.auth_uid=NEW.auth_uid
  ) THEN RAISE(ABORT,'agency_salary_not_matured_or_insufficient') END;
END;
