-- Staging candidate: Crystal Transfer / Crystal Coin Exchange.
-- 10,000 ledger units represent 1 Crystal; do not rewrite historical entries.
-- Host and Agency entries are immediately eligible. BD entries become eligible
-- only after the calendar month in which they were earned has ended (UTC).
-- Preserve existing idempotency, immutable ledgers, and atomic D1 batches.
-- The legacy settlement_mode column is retained for backward compatibility;
-- it is NOT used to delay Host/Agency Crystal.
DROP TRIGGER IF EXISTS sharika_agency_salary_exchange_guard;
CREATE TRIGGER sharika_agency_salary_exchange_guard BEFORE INSERT ON sharika_agency_salary_exchanges BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sharika_agency_salary_config c JOIN sharika_agency_policy p ON p.key=c.key WHERE c.key='standard' AND c.exchange_enabled=1 AND p.active=1 AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode) THEN RAISE(ABORT,'crystal_policy_changed') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid AND u.status='active' AND u.minor=0) THEN RAISE(ABORT,'crystal_user_ineligible') END;
  
  SELECT CASE WHEN NEW.salary_units > ((SELECT COALESCE(SUM(a.amount_units),0) FROM sharika_agency_earnings a WHERE a.beneficiary_uid=NEW.auth_uid AND (a.kind IN ('host_salary','agency') OR (a.kind='bd' AND a.created_at<datetime('now','start of month')))) - (SELECT COALESCE(SUM(x.salary_units),0) FROM sharika_agency_salary_exchanges x WHERE x.auth_uid=NEW.auth_uid) + (SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t WHERE t.auth_uid=NEW.auth_uid)) THEN RAISE(ABORT,'crystal_insufficient_or_bd_pending') END;
END;

DROP TRIGGER IF EXISTS sharika_agency_salary_seller_guard;
CREATE TRIGGER sharika_agency_salary_seller_guard BEFORE INSERT ON sharika_agency_salary_seller_transfers BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sharika_agency_salary_config c JOIN sharika_agency_policy p ON p.key=c.key WHERE c.key='standard' AND c.exchange_enabled=1 AND p.active=1 AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode) THEN RAISE(ABORT,'crystal_policy_changed') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid AND u.status='active' AND u.minor=0) THEN RAISE(ABORT,'crystal_user_ineligible') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sharika_coin_sellers s JOIN sharika_users u ON u.auth_uid=s.seller_uid WHERE s.seller_uid=NEW.seller_uid AND s.active=1 AND u.status='active' AND u.minor=0 AND s.available_coins BETWEEN 0 AND (1000000000-NEW.credited_coins)) THEN RAISE(ABORT,'crystal_seller_unavailable') END;
  SELECT CASE WHEN NEW.salary_units > ((SELECT COALESCE(SUM(a.amount_units),0) FROM sharika_agency_earnings a WHERE a.beneficiary_uid=NEW.auth_uid AND (a.kind IN ('host_salary','agency') OR (a.kind='bd' AND a.created_at<datetime('now','start of month')))) - (SELECT COALESCE(SUM(x.salary_units),0) FROM sharika_agency_salary_exchanges x WHERE x.auth_uid=NEW.auth_uid) + (SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t WHERE t.auth_uid=NEW.auth_uid)) THEN RAISE(ABORT,'crystal_insufficient_or_bd_pending') END;
END;

