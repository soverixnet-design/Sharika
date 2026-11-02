-- Expand seller request amounts without changing historical ledger rows.
-- Run as one transactional migration before publishing the matching Worker.

CREATE TABLE sharika_coin_seller_allocations_expanded (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
 
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000),
 stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
 request_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sharika_coin_seller_allocations_expanded SELECT * FROM sharika_coin_seller_allocations;
DROP TABLE sharika_coin_seller_allocations;
ALTER TABLE sharika_coin_seller_allocations_expanded RENAME TO sharika_coin_seller_allocations;
CREATE TRIGGER sharika_seller_allocation_no_update
BEFORE UPDATE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;
CREATE TRIGGER sharika_seller_allocation_no_delete
BEFORE DELETE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;

CREATE TABLE sharika_coin_seller_transfers_expanded (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 
 seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
 target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
 stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
 request_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(seller_uid, request_id)
);
INSERT INTO sharika_coin_seller_transfers_expanded SELECT * FROM sharika_coin_seller_transfers;
DROP TABLE sharika_coin_seller_transfers;
ALTER TABLE sharika_coin_seller_transfers_expanded RENAME TO sharika_coin_seller_transfers;
CREATE TRIGGER sharika_seller_transfer_no_update
BEFORE UPDATE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;
CREATE TRIGGER sharika_seller_transfer_no_delete
BEFORE DELETE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;
