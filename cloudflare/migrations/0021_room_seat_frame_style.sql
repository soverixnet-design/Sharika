-- Sharika isolated staging: persist the owner's chosen decorative seat ring
-- for every member of the room. Existing rooms default to the original frame.
-- Visual setting only: no wallet, seat occupant or role data is changed.
ALTER TABLE sharika_rooms
  ADD COLUMN seat_frame_style TEXT NOT NULL DEFAULT 'grad'
  CHECK (seat_frame_style IN ('grad','gold','neon','sq'));
