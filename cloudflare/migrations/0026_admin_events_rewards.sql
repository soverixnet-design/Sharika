-- Staging-only, auditable event prizes. No seeded events or balance changes.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sharika_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
  kind TEXT NOT NULL CHECK(kind IN ('gift_race','room_battle','recharge_bonus','game_tournament','invite_campaign','checkin_festival','festival','custom')),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
  starts_at TEXT NOT NULL CHECK(length(starts_at)=24),
  ends_at TEXT NOT NULL CHECK(length(ends_at)=24 AND ends_at>starts_at),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  prize_1 INTEGER NOT NULL DEFAULT 0 CHECK(prize_1 BETWEEN 0 AND 1000000),
  prize_2 INTEGER NOT NULL DEFAULT 0 CHECK(prize_2 BETWEEN 0 AND 1000000),
  prize_3 INTEGER NOT NULL DEFAULT 0 CHECK(prize_3 BETWEEN 0 AND 1000000),
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_events_dates ON sharika_events(status,ends_at);
CREATE TABLE IF NOT EXISTS sharika_event_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES sharika_events(id),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000),
  request_id TEXT NOT NULL UNIQUE CHECK(length(request_id) BETWEEN 12 AND 80),
  granted_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id,rank),
  UNIQUE(event_id,auth_uid)
);
CREATE INDEX IF NOT EXISTS idx_sharika_event_awards_user ON sharika_event_awards(auth_uid,created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_event_award_guard
BEFORE INSERT ON sharika_event_awards
BEGIN
  SELECT RAISE(ABORT,'event_not_payable') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_events e WHERE e.id=NEW.event_id
      AND e.status='published' AND e.ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NEW.coins>0
      AND NEW.coins=CASE NEW.rank WHEN 1 THEN e.prize_1 WHEN 2 THEN e.prize_2 ELSE e.prize_3 END
  );
  SELECT RAISE(ABORT,'event_recipient_unavailable') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid AND u.status='active'
  );
END;
CREATE TRIGGER IF NOT EXISTS sharika_event_lock_after_award
BEFORE UPDATE ON sharika_events
WHEN EXISTS(SELECT 1 FROM sharika_event_awards a WHERE a.event_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'awarded_event_locked'); END;
CREATE TRIGGER IF NOT EXISTS sharika_event_award_no_update
BEFORE UPDATE ON sharika_event_awards BEGIN SELECT RAISE(ABORT,'event_award_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_event_award_no_delete
BEFORE DELETE ON sharika_event_awards BEGIN SELECT RAISE(ABORT,'event_award_immutable'); END;
