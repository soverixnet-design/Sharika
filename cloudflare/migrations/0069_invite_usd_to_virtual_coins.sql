-- Keep legacy approved invite USD-equivalent credits as a non-cash ledger.
-- New conversions only move those credits into Sharika's virtual coin wallet.
-- Historical withdrawal requests and encrypted records are retained unchanged.
CREATE TABLE IF NOT EXISTS sharika_invite_usd_coin_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
  coins INTEGER NOT NULL CHECK(coins > 0),
  coins_per_usd INTEGER NOT NULL CHECK(coins_per_usd BETWEEN 1000 AND 1000000),
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_invite_usd_coin_conversions_uid
  ON sharika_invite_usd_coin_conversions(inviter_uid,created_at);
CREATE TRIGGER IF NOT EXISTS immutable_sharika_invite_usd_coin_conversions_update
BEFORE UPDATE ON sharika_invite_usd_coin_conversions BEGIN
  SELECT RAISE(ABORT,'invite_conversion_receipt_immutable');
END;
CREATE TRIGGER IF NOT EXISTS immutable_sharika_invite_usd_coin_conversions_delete
BEFORE DELETE ON sharika_invite_usd_coin_conversions BEGIN
  SELECT RAISE(ABORT,'invite_conversion_receipt_immutable');
END;
