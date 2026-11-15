CREATE TABLE IF NOT EXISTS sharika_seller_stock_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000),
  stock_after INTEGER NOT NULL CHECK(stock_after BETWEEN 0 AND 1000000000),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid, request_id)
);
CREATE INDEX IF NOT EXISTS sharika_seller_deductions_history
  ON sharika_seller_stock_deductions(seller_uid, id DESC);
CREATE TRIGGER IF NOT EXISTS sharika_apply_seller_stock_deduction
AFTER INSERT ON sharika_seller_stock_deductions
BEGIN
  UPDATE sharika_coin_sellers SET available_coins=NEW.stock_after, updated_at=datetime('now')
    WHERE seller_uid=NEW.seller_uid;
END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_deduction_no_update
BEFORE UPDATE ON sharika_seller_stock_deductions
BEGIN SELECT RAISE(ABORT,'immutable seller deduction'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_deduction_no_delete
BEFORE DELETE ON sharika_seller_stock_deductions
BEGIN SELECT RAISE(ABORT,'immutable seller deduction'); END;
