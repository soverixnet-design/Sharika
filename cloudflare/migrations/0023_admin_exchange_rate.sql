-- Administrator-editable diamond-to-coin exchange policy.
-- Default terms preserve the original app contract: 100 diamonds => 70 coins.
-- Settings are not applied to D1 staging without a migration preflight.
CREATE TABLE IF NOT EXISTS sharika_exchange_rate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  diamonds_per_unit INTEGER NOT NULL CHECK (diamonds_per_unit BETWEEN 1 AND 10000),
  coins_per_unit INTEGER NOT NULL CHECK (coins_per_unit BETWEEN 1 AND 10000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_exchange_rate
  (id,diamonds_per_unit,coins_per_unit,revision)
VALUES (1,100,70,1);
