-- Real Super Admin switches for bundled games. Existing bets/rounds are never removed.
CREATE TABLE IF NOT EXISTS sharika_game_catalog (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_game_catalog(id,enabled) VALUES
 ('sovera-food',1),
 ('night-food',1),
 ('jackpot-fruit',1),
 ('greedy-wheel',1),
 ('food-wheel',1);
