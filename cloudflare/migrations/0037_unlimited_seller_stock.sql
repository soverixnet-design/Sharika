-- Sharika staging: opt-in non-depleting stock for Super Admin approved sellers.
-- Existing sellers remain limited; no user balances or past transactions change.
ALTER TABLE sharika_coin_sellers
  ADD COLUMN unlimited_stock INTEGER NOT NULL DEFAULT 0
    CHECK(unlimited_stock IN (0,1));

CREATE TABLE IF NOT EXISTS sharika_coin_seller_stock_mode_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  unlimited_stock INTEGER NOT NULL CHECK(unlimited_stock IN (0,1)),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_seller_stock_mode_time
  ON sharika_coin_seller_stock_mode_audit(seller_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_seller_stock_mode_no_update
  BEFORE UPDATE ON sharika_coin_seller_stock_mode_audit
  BEGIN SELECT RAISE(ABORT,'immutable seller stock mode'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_stock_mode_no_delete
  BEFORE DELETE ON sharika_coin_seller_stock_mode_audit
  BEGIN SELECT RAISE(ABORT,'immutable seller stock mode'); END;
