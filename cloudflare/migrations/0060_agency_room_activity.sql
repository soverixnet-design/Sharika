-- Server-observed voice-room activity for verified Host, Agency and BD roles.
-- Separate from wallet, earnings, microphone and room membership state.
CREATE TABLE IF NOT EXISTS sharika_agency_presence_cursor (
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  room_id TEXT REFERENCES sharika_rooms(id) ON DELETE SET NULL,
  utc_day TEXT NOT NULL,
  last_seen_ms INTEGER NOT NULL CHECK (last_seen_ms >= 0)
);

CREATE TABLE IF NOT EXISTS sharika_agency_room_activity (
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  -- Preserve historical time even if the room is later deleted.
  room_id TEXT NOT NULL,
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK(active_seconds>=0),
  PRIMARY KEY(user_uid,room_id,utc_day)
);
CREATE INDEX IF NOT EXISTS sharika_agency_activity_date_idx
  ON sharika_agency_room_activity(utc_day,user_uid);
