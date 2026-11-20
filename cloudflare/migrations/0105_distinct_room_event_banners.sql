-- A room event banner may target exactly one independently published Sharika Event.
-- Existing room artwork remains valid; no user, wallet, gift, game or award data changes.
ALTER TABLE sharika_room_banners ADD COLUMN event_id INTEGER
  REFERENCES sharika_events(id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_sharika_room_event_one_banner
  ON sharika_room_banners(event_id)
  WHERE event_id IS NOT NULL AND placement='event';
CREATE INDEX IF NOT EXISTS ix_sharika_room_event_publication
  ON sharika_room_banners(active,placement,event_id,sort_order);
