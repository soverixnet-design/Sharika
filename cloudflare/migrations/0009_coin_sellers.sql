-- Isolated staging seller inventory. Existing user balances and ledger rows are untouched.
CREATE TABLE IF NOT EXISTS sharika_coin_sellers (
  seller_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  available_coins INTEGER NOT NULL DEFAULT 0 CHECK(available_coins BETWEEN 0 AND 1000000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_coin_seller_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
  stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_coin_seller_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
  stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(seller_uid, request_id)
);
CREATE TABLE IF NOT EXISTS sharika_coin_seller_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  action TEXT NOT NULL CHECK(action IN ('approve','suspend','allocate')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS sharika_seller_allocation_no_update
BEFORE UPDATE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_allocation_no_delete
BEFORE DELETE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_transfer_no_update
BEFORE UPDATE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_transfer_no_delete
BEFORE DELETE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_audit_no_update
BEFORE UPDATE ON sharika_coin_seller_admin_audit BEGIN SELECT RAISE(ABORT,'immutable seller audit'); END;
CREATE TRIGGER IF NOT EXISTS sharika_seller_audit_no_delete
BEFORE DELETE ON sharika_coin_seller_admin_audit BEGIN SELECT RAISE(ABORT,'immutable seller audit'); END;
