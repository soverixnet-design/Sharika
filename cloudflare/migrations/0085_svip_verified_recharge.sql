-- Legacy entitlements remain available during rollout.
ALTER TABLE sharika_premium_policy ADD COLUMN svip_recharge_enabled INTEGER NOT NULL DEFAULT 0
  CHECK(svip_recharge_enabled IN (0,1));
ALTER TABLE sharika_svip_levels ADD COLUMN recharge_usd INTEGER NOT NULL DEFAULT 10
  CHECK(recharge_usd BETWEEN 1 AND 1000000);
UPDATE sharika_svip_levels SET recharge_usd=CASE level
  WHEN 1 THEN 10 WHEN 2 THEN 25 WHEN 3 THEN 50 WHEN 4 THEN 100
  WHEN 5 THEN 300 WHEN 6 THEN 500 WHEN 7 THEN 1000 WHEN 8 THEN 3000 END;

CREATE TABLE sharika_svip_recharge_cycles (
  id INTEGER PRIMARY KEY,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  started_at_ms INTEGER,
  expires_at_ms INTEGER
);
CREATE INDEX sharika_svip_cycles_user ON sharika_svip_recharge_cycles(auth_uid,id DESC);
CREATE TABLE sharika_svip_recharge_orders (
  token_hash TEXT PRIMARY KEY REFERENCES sharika_google_play_purchases(token_hash) ON DELETE CASCADE,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  credited_at_ms INTEGER NOT NULL,
  base_coins INTEGER NOT NULL CHECK(base_coins>0),
  cycle_id INTEGER REFERENCES sharika_svip_recharge_cycles(id) ON DELETE CASCADE
);
CREATE INDEX sharika_svip_orders_cycle ON sharika_svip_recharge_orders(cycle_id);
-- A void can arrive before a delayed claim. Keep the receipt hash independently.
CREATE TABLE sharika_svip_voided_orders (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64)
);
CREATE TABLE sharika_svip_refund_sync (
  id INTEGER PRIMARY KEY CHECK(id=1),
  checked_at_ms INTEGER NOT NULL
);

CREATE VIEW sharika_svip_recharge_status AS
SELECT c.id,c.auth_uid,c.started_at_ms,c.expires_at_ms,
  COALESCE(SUM(CASE WHEN v.token_hash IS NULL THEN o.base_coins ELSE 0 END),0) AS base_coins
FROM sharika_svip_recharge_cycles c
JOIN sharika_svip_recharge_orders o ON o.cycle_id=c.id
LEFT JOIN sharika_svip_voided_orders v ON v.token_hash=o.token_hash
GROUP BY c.id;

-- Same transaction as the verified Play receipt and coin ledger. Concurrent
-- claims share a cycle. A refund can lower its level without rewriting dates.
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
  ) WHERE token_hash=NEW.token_hash;
  UPDATE sharika_svip_recharge_cycles
  SET started_at_ms=NEW.credited_at_ms, expires_at_ms=NEW.credited_at_ms+2592000000
  WHERE started_at_ms IS NULL
    AND id=(SELECT cycle_id FROM sharika_svip_recharge_orders WHERE token_hash=NEW.token_hash)
    AND (SELECT base_coins FROM sharika_svip_recharge_status WHERE id=sharika_svip_recharge_cycles.id)
      >= (SELECT recharge_usd*500000 FROM sharika_svip_levels WHERE level=1);
END;
