-- Reference room settings: descriptive introduction and tag, separate from
-- room access policy, wallet ledger, seats, cover art, and admission controls.
CREATE TABLE IF NOT EXISTS sharika_room_details (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  introduction TEXT NOT NULL DEFAULT '' CHECK(length(introduction)<=300),
  tag TEXT NOT NULL DEFAULT 'general'
    CHECK(tag IN ('general','music','chat','friends','games')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
