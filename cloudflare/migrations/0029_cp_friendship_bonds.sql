-- Consent-based CP (one active partner) and Friendship (multiple friends).
-- Staging-only additive schema: no existing member, coin or gift row is changed.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sharika_bond_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  cp_enabled INTEGER NOT NULL DEFAULT 1 CHECK(cp_enabled IN (0,1)),
  friendship_enabled INTEGER NOT NULL DEFAULT 1 CHECK(friendship_enabled IN (0,1)),
  expiry_hours INTEGER NOT NULL DEFAULT 24 CHECK(expiry_hours BETWEEN 1 AND 168),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO sharika_bond_policy(key) VALUES('standard');

CREATE TABLE IF NOT EXISTS sharika_bond_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  emoji TEXT NOT NULL CHECK(length(emoji) BETWEEN 1 AND 16),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sharika_bond_gifts(id,type,name,emoji,price_coins,sort_order)
VALUES(1,'cp','Rose Promise','💝',5200,1),
      (2,'cp','Royal Wedding','💍',18800,2),
      (3,'friendship','Blue Promise','💙',1200,3),
      (4,'friendship','Forever Friends','🤝',5200,4);

CREATE TABLE IF NOT EXISTS sharika_bond_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  gift_id INTEGER NOT NULL REFERENCES sharika_bond_gifts(id),
  held_coins INTEGER NOT NULL CHECK(held_coins BETWEEN 1 AND 1000000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
  resolved_at_ms INTEGER,
  refunded_at_ms INTEGER,
  CHECK(sender_uid<>recipient_uid),
  UNIQUE(sender_uid,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_bond_invites_received
  ON sharika_bond_invites(recipient_uid,status,expires_at_ms);
CREATE INDEX IF NOT EXISTS sharika_bond_invites_sent
  ON sharika_bond_invites(sender_uid,status,expires_at_ms);

CREATE TABLE IF NOT EXISTS sharika_bonds (
  id INTEGER PRIMARY KEY REFERENCES sharika_bond_invites(id),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  uid_a TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  uid_b TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pair_key TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  CHECK(uid_a<uid_b)
);
-- A pair cannot start the same type twice concurrently; after unbinding they can.
CREATE UNIQUE INDEX IF NOT EXISTS sharika_bond_active_pair
  ON sharika_bonds(type,pair_key) WHERE ended_at_ms IS NULL;
CREATE INDEX IF NOT EXISTS sharika_bonds_member_a
  ON sharika_bonds(uid_a,type,ended_at_ms);
CREATE INDEX IF NOT EXISTS sharika_bonds_member_b
  ON sharika_bonds(uid_b,type,ended_at_ms);

-- Two atomic inserts per accepted CP enforce at most one active partner per user.
CREATE TABLE IF NOT EXISTS sharika_active_cp_slots (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id)
);
CREATE INDEX IF NOT EXISTS sharika_active_cp_bond ON sharika_active_cp_slots(bond_id);

CREATE TABLE IF NOT EXISTS sharika_bond_gift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id),
  invite_id INTEGER UNIQUE REFERENCES sharika_bond_invites(id),
  gift_id INTEGER REFERENCES sharika_bond_gifts(id),
  request_id TEXT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  value_coins INTEGER NOT NULL CHECK(value_coins>0),
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sharika_bond_gift_events_rank
  ON sharika_bond_gift_events(type,created_at_ms,bond_id);
CREATE UNIQUE INDEX IF NOT EXISTS sharika_bond_gift_event_requests
  ON sharika_bond_gift_events(sender_uid,request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS sharika_bond_gift_event_active
BEFORE INSERT ON sharika_bond_gift_events BEGIN
  SELECT RAISE(ABORT,'bond_no_longer_active') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_bonds b WHERE b.id=NEW.bond_id
      AND b.ended_at_ms IS NULL AND b.type=NEW.type
      AND ((b.uid_a=NEW.sender_uid AND b.uid_b=NEW.recipient_uid)
        OR (b.uid_b=NEW.sender_uid AND b.uid_a=NEW.recipient_uid))
  );
END;

CREATE TABLE IF NOT EXISTS sharika_bond_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL,
  invite_id INTEGER,
  bond_id INTEGER,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS sharika_bond_audit_no_update
  BEFORE UPDATE ON sharika_bond_audit BEGIN SELECT RAISE(ABORT,'bond_audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_bond_audit_no_delete
  BEFORE DELETE ON sharika_bond_audit BEGIN SELECT RAISE(ABORT,'bond_audit_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_profile_visits (
  visitor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  visited_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  last_seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY(visitor_uid,visited_uid),
  CHECK(visitor_uid<>visited_uid)
);
CREATE INDEX IF NOT EXISTS sharika_profile_visits_received
  ON sharika_profile_visits(visited_uid,last_seen_at_ms DESC);
