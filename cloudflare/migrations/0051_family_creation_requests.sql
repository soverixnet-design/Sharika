-- Royal Family creation requests; staging-only additive schema.
-- No changes to Family ownership, members, balances, grants or Crystal ledger.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sharika_family_creation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 40),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=240),
  country TEXT NOT NULL DEFAULT '' CHECK(length(country)<=80),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','cancelled')),
  family_id INTEGER REFERENCES sharika_families(id),
  assigned_bd_uid TEXT REFERENCES sharika_bd_agents(bd_uid),
  reviewed_by TEXT,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK(length(decision_reason)<=240),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sharika_family_creation_pending_user_unique
  ON sharika_family_creation_requests(requester_uid) WHERE state='pending';
CREATE INDEX IF NOT EXISTS sharika_family_creation_pending_idx
  ON sharika_family_creation_requests(state,created_at DESC);
