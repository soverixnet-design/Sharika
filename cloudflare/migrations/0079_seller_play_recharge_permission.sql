-- Seller-specific Play recharge permission. Defaults OFF for every existing/new seller.
-- This permission is not itself a purchase or coin grant.
ALTER TABLE sharika_coin_sellers ADD COLUMN play_recharge_allowed INTEGER NOT NULL DEFAULT 0 CHECK(play_recharge_allowed IN (0,1));
CREATE TABLE IF NOT EXISTS sharika_seller_recharge_permission_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
 allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS seller_recharge_permission_audit_no_update BEFORE UPDATE ON sharika_seller_recharge_permission_audit BEGIN SELECT RAISE(ABORT,'immutable seller recharge permission audit'); END;
CREATE TRIGGER IF NOT EXISTS seller_recharge_permission_audit_no_delete BEFORE DELETE ON sharika_seller_recharge_permission_audit BEGIN SELECT RAISE(ABORT,'immutable seller recharge permission audit'); END;
