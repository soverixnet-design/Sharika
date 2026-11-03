-- Staging-only Family invitations and reporting frequency. Preserves all
-- existing Family owners, BD relations, member records and immutable ledgers.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sharika_family_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  source TEXT NOT NULL DEFAULT 'owner' CHECK(source IN ('owner','admin')),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','accepted','declined','cancelled','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days')),
  responded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sharika_family_invite_pending_unique
  ON sharika_family_invites(family_id,recipient_uid) WHERE state='pending';
CREATE INDEX IF NOT EXISTS sharika_family_invite_recipient_idx
  ON sharika_family_invites(recipient_uid,state,created_at DESC);
CREATE TABLE IF NOT EXISTS sharika_family_settlement_preferences (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  mode TEXT NOT NULL DEFAULT 'monthly' CHECK(mode IN ('daily','weekly','monthly')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_family_settlement_preferences(key,mode)
SELECT key,settlement_mode FROM sharika_family_policy WHERE key='standard';
-- An owner-invited, user-accepted rejoin (or audited Super Admin addition)
-- is the only exception to the original 24-hour leave cooldown. The
-- pending invitation is consumed to accepted in the same D1 batch as INSERT.
DROP TRIGGER IF EXISTS sharika_family_member_join_guard;
CREATE TRIGGER sharika_family_member_join_guard
BEFORE INSERT ON sharika_family_members
BEGIN
  SELECT RAISE(ABORT,'family_join_cooldown')
  WHERE EXISTS (SELECT 1 FROM sharika_family_leaves
    WHERE user_uid=NEW.user_uid AND left_at>datetime('now','-1 day'))
    AND NOT EXISTS (SELECT 1 FROM sharika_family_invites i
      WHERE i.family_id=NEW.family_id AND i.recipient_uid=NEW.user_uid
        AND i.state='pending' AND i.expires_at>datetime('now'));
  SELECT RAISE(ABORT,'family_full')
    WHERE (SELECT COUNT(*) FROM sharika_family_members
      WHERE family_id=NEW.family_id) >=
      (SELECT max_members FROM sharika_family_policy WHERE key='standard');
END;
