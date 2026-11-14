ALTER TABLE sharika_exchange_rate ADD COLUMN max_diamonds_per_exchange INTEGER NOT NULL DEFAULT 10000000
  CHECK(max_diamonds_per_exchange BETWEEN 1 AND 100000000);

-- The Play database uses a verified staging admin identity in this audit.
CREATE TABLE IF NOT EXISTS sharika_play_exchange_audit (
  id INTEGER PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
