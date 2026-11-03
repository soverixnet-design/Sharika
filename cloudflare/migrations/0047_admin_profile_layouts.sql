-- Additive staging-only design settings. Never touches user accounts,
-- cosmetic inventory, wallet balances, or profiles.
CREATE TABLE IF NOT EXISTS sharika_profile_layouts (
  screen TEXT PRIMARY KEY CHECK (screen IN ('main','public')),
  draft_json TEXT NOT NULL,
  published_json TEXT NOT NULL,
  previous_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
