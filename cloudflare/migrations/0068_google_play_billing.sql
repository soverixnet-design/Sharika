-- Google Play one-time product receipts. No existing wallets or ledger rows
-- are rewritten. A purchase token hash is globally unique and immutable.
CREATE TABLE IF NOT EXISTS sharika_play_billing_purchases (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  product_id TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins>0),
  order_id TEXT,
  test_purchase INTEGER NOT NULL DEFAULT 0 CHECK(test_purchase IN (0,1)),
  credited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_play_billing_user_idx
  ON sharika_play_billing_purchases(auth_uid,credited_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_play_billing_no_update
BEFORE UPDATE ON sharika_play_billing_purchases BEGIN
  SELECT RAISE(ABORT,'play_purchase_immutable');
END;
CREATE TRIGGER IF NOT EXISTS sharika_play_billing_no_delete
BEFORE DELETE ON sharika_play_billing_purchases BEGIN
  SELECT RAISE(ABORT,'play_purchase_immutable');
END;
