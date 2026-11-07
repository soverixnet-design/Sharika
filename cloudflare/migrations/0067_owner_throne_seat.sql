-- The owner throne is a separate, explicitly claimed microphone position.
-- Keep the existing 1..20 numbered seats and their uniqueness constraint
-- intact; a nullable owner throne flag avoids rebuilding the live D1 table.
ALTER TABLE sharika_room_members ADD COLUMN owner_throne_active INTEGER NOT NULL DEFAULT 0
  CHECK (owner_throne_active IN (0,1));
