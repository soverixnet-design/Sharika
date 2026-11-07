-- A Google Play token may grant coins only once, after Google purchase verification.
-- This table is additive: existing users, balances and transactions stay intact.
CREATE TABLE IF NOT EXISTS sharika_google_play_purchases (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  product_id TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins>0),
  order_id TEXT NOT NULL UNIQUE,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_google_play_user_time
  ON sharika_google_play_purchases(user_uid,created_at DESC);
