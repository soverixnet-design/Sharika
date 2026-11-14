-- Share the existing 30-day cycle across settled recharge channels.
DROP TRIGGER sharika_svip_assign_recharge_cycle;
DROP VIEW sharika_svip_recharge_status;

CREATE TABLE sharika_svip_recharge_orders_v2 (
  id INTEGER PRIMARY KEY,
  token_hash TEXT UNIQUE REFERENCES sharika_google_play_purchases(token_hash) ON DELETE CASCADE,
  seller_transfer_id INTEGER UNIQUE REFERENCES sharika_coin_seller_transfers(id) ON DELETE CASCADE,
  manual_recharge_id INTEGER UNIQUE REFERENCES sharika_manual_recharge_reviews(support_message_id) ON DELETE CASCADE,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  credited_at_ms INTEGER NOT NULL,
  base_coins INTEGER NOT NULL CHECK(base_coins>0),
  cycle_id INTEGER REFERENCES sharika_svip_recharge_cycles(id) ON DELETE CASCADE,
  CHECK((token_hash IS NOT NULL)+(seller_transfer_id IS NOT NULL)+(manual_recharge_id IS NOT NULL)=1)
);
INSERT INTO sharika_svip_recharge_orders_v2(token_hash,auth_uid,credited_at_ms,base_coins,cycle_id)
SELECT token_hash,auth_uid,credited_at_ms,base_coins,cycle_id FROM sharika_svip_recharge_orders;
DROP TABLE sharika_svip_recharge_orders;
ALTER TABLE sharika_svip_recharge_orders_v2 RENAME TO sharika_svip_recharge_orders;
CREATE INDEX sharika_svip_orders_cycle ON sharika_svip_recharge_orders(cycle_id);

CREATE VIEW sharika_svip_recharge_status AS
SELECT c.id,c.auth_uid,c.started_at_ms,c.expires_at_ms,
  COALESCE(SUM(CASE WHEN v.token_hash IS NULL THEN o.base_coins ELSE 0 END),0) AS base_coins
FROM sharika_svip_recharge_cycles c
JOIN sharika_svip_recharge_orders o ON o.cycle_id=c.id
LEFT JOIN sharika_svip_voided_orders v ON v.token_hash=o.token_hash
GROUP BY c.id;

CREATE TRIGGER sharika_svip_assign_recharge_cycle
AFTER INSERT ON sharika_svip_recharge_orders
BEGIN
  INSERT INTO sharika_svip_recharge_cycles(auth_uid)
  SELECT NEW.auth_uid WHERE NOT EXISTS (
    SELECT 1 FROM sharika_svip_recharge_cycles
    WHERE auth_uid=NEW.auth_uid AND (expires_at_ms IS NULL OR expires_at_ms>NEW.credited_at_ms)
  );
  UPDATE sharika_svip_recharge_orders SET cycle_id=(
    SELECT id FROM sharika_svip_recharge_cycles
    WHERE auth_uid=NEW.auth_uid AND (expires_at_ms IS NULL OR expires_at_ms>NEW.credited_at_ms)
    ORDER BY id DESC LIMIT 1
  ) WHERE id=NEW.id;
  UPDATE sharika_svip_recharge_cycles
  SET started_at_ms=NEW.credited_at_ms, expires_at_ms=NEW.credited_at_ms+2592000000
  WHERE started_at_ms IS NULL
    AND id=(SELECT cycle_id FROM sharika_svip_recharge_orders WHERE id=NEW.id)
    AND (SELECT base_coins FROM sharika_svip_recharge_status WHERE id=sharika_svip_recharge_cycles.id)
      >= (SELECT recharge_usd*500000 FROM sharika_svip_levels WHERE level=1);
END;

-- These triggers run in the existing committed wallet batches. Legacy rows
-- and changes to stock or bonuses are never replayed as new recharges.
CREATE TRIGGER sharika_svip_seller_recharge
AFTER INSERT ON sharika_coin_seller_transfers
WHEN NEW.seller_uid<>NEW.target_uid AND EXISTS (
  SELECT 1 FROM sharika_premium_policy WHERE key='standard' AND svip_recharge_enabled=1
)
BEGIN
  INSERT INTO sharika_svip_recharge_orders(seller_transfer_id,auth_uid,credited_at_ms,base_coins)
  VALUES(NEW.id,NEW.target_uid,unixepoch(NEW.created_at)*1000,NEW.amount);
END;

CREATE TRIGGER sharika_svip_manual_recharge
AFTER INSERT ON sharika_manual_recharge_reviews
WHEN NEW.status='approved' AND NEW.admin_uid<>NEW.user_uid AND EXISTS (
  SELECT 1 FROM sharika_premium_policy WHERE key='standard' AND svip_recharge_enabled=1
)
BEGIN
  INSERT INTO sharika_svip_recharge_orders(manual_recharge_id,auth_uid,credited_at_ms,base_coins)
  VALUES(NEW.support_message_id,NEW.user_uid,unixepoch(NEW.created_at)*1000,NEW.coins);
END;
