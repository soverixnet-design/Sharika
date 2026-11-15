CREATE TABLE IF NOT EXISTS sharika_admin_cosmetic_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL CHECK(length(actor_id)=22 AND substr(actor_id,1,14)='staging-super:' AND
    substr(actor_id,15) NOT GLOB '*[^0-9]*'),
  action TEXT NOT NULL CHECK(action IN ('cosmetic_grant_revoke','cosmetic_catalog_add','cosmetic_catalog_update')),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  request_id TEXT CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_id,request_id)
);

CREATE TRIGGER IF NOT EXISTS sharika_admin_cosmetic_actions_immutable_update
BEFORE UPDATE ON sharika_admin_cosmetic_actions
BEGIN SELECT RAISE(ABORT,'admin_cosmetic_action_immutable'); END;

CREATE TRIGGER IF NOT EXISTS sharika_admin_cosmetic_actions_immutable_delete
BEFORE DELETE ON sharika_admin_cosmetic_actions
BEGIN SELECT RAISE(ABORT,'admin_cosmetic_action_immutable'); END;
