-- Off-app deletion request intake. Only verified staff may view the queue.
-- Request rows never cause automatic user or wallet deletion.
CREATE TABLE IF NOT EXISTS sharika_account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL CHECK(length(public_id) BETWEEN 1 AND 10),
  contact_email TEXT NOT NULL CHECK(length(contact_email) BETWEEN 5 AND 180),
  reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 400),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','completed','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_account_deletion_recent
  ON sharika_account_deletion_requests(public_id,contact_email,created_at DESC);
