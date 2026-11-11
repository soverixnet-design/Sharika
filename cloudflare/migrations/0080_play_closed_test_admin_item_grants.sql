-- Play closed-test-only audit receipts. This table is inert on normal staging:
-- only the separately authenticated admin frontend is permitted to write to
-- the isolated Play D1 binding, never to the staging or production wallet.
CREATE TABLE IF NOT EXISTS sharika_play_admin_item_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL CHECK(length(actor_id)=22 AND
    substr(actor_id,1,14)='staging-super:' AND
    substr(actor_id,15) NOT GLOB '*[^0-9]*'),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL REFERENCES sharika_cosmetics_catalog(id),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_id, request_id)
);

CREATE INDEX IF NOT EXISTS sharika_play_admin_item_grants_recipient
  ON sharika_play_admin_item_grants(recipient_uid,created_at DESC);

CREATE TRIGGER IF NOT EXISTS sharika_play_admin_item_grants_immutable_update
BEFORE UPDATE ON sharika_play_admin_item_grants
BEGIN SELECT RAISE(ABORT,'play_grant_immutable'); END;

CREATE TRIGGER IF NOT EXISTS sharika_play_admin_item_grants_immutable_delete
BEFORE DELETE ON sharika_play_admin_item_grants
BEGIN SELECT RAISE(ABORT,'play_grant_immutable'); END;
