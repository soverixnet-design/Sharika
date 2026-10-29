-- Sharika D1 preview: new/isolated tables, never pointed at existing Supabase data.
-- The production migration must import accounts/balances under an approved identity map.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sharika_users (
  public_no INTEGER PRIMARY KEY CHECK (public_no BETWEEN 10000001 AND 99999999),
  auth_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  birthdate TEXT NOT NULL,
  minor INTEGER NOT NULL CHECK (minor IN (0,1)),
  country TEXT NOT NULL DEFAULT '',
  pic TEXT,
  cover TEXT,
  bio TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  diamonds INTEGER NOT NULL DEFAULT 0 CHECK (diamonds >= 0),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  wealth_level INTEGER NOT NULL DEFAULT 1,
  charm_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_users_status_idx ON sharika_users(status);

CREATE TABLE IF NOT EXISTS sharika_wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  currency TEXT NOT NULL CHECK (currency IN ('coins','diamonds')),
  delta INTEGER NOT NULL CHECK (delta != 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,currency,request_id)
);
CREATE INDEX IF NOT EXISTS sharika_ledger_user_time ON sharika_wallet_ledger(auth_uid,created_at DESC);
-- Auditable history must not be edited in place.
CREATE TRIGGER IF NOT EXISTS sharika_ledger_no_update BEFORE UPDATE ON sharika_wallet_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_ledger_no_delete BEFORE DELETE ON sharika_wallet_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;

CREATE TABLE IF NOT EXISTS sharika_rooms (
  id TEXT PRIMARY KEY CHECK (length(id) = 8),
  owner_id TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  emoji TEXT NOT NULL DEFAULT '🎙️',
  theme TEXT NOT NULL DEFAULT 'mid',
  seat_count INTEGER NOT NULL DEFAULT 12 CHECK (seat_count BETWEEN 1 AND 20),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_room_members (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  seat_no INTEGER CHECK (seat_no BETWEEN 1 AND 20),
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sharika_one_user_per_seat ON sharika_room_members(room_id,seat_no) WHERE seat_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS sharika_members_user_idx ON sharika_room_members(user_id);

CREATE TABLE IF NOT EXISTS sharika_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁',
  tab INTEGER NOT NULL DEFAULT 0 CHECK (tab BETWEEN 0 AND 2),
  price_coins INTEGER NOT NULL CHECK (price_coins > 0),
  image_url TEXT,
  animation_url TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS sharika_admin_roles (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL CHECK (role IN ('super','support','finance')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- No seed admins, user balances, demo rooms, or paid games.
