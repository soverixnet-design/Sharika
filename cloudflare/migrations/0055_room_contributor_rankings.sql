-- Read-only daily, weekly and monthly contribution leaderboards.
-- Index existing settled gifts; never change balances or existing rows.
CREATE INDEX IF NOT EXISTS idx_sharika_gift_transactions_room_time
  ON sharika_gift_transactions(room_id, created_at DESC, sender_uid);
