-- Sharika staging: 10% room share on regular (non-Lucky) gifts only.
-- Coins come from the original gift value; the sender pays no extra.
-- Store hundredths exactly, including small gifts; room rewards are
-- auditable room-only credits and never auto-credit a user/seller wallet.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sharika_regular_room_rewards (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  reward_hundredths INTEGER NOT NULL CHECK (reward_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_regular_room_rewards_room
  ON sharika_regular_room_rewards(room_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS sharika_regular_room_reward_validate
BEFORE INSERT ON sharika_regular_room_rewards
BEGIN
  SELECT RAISE(ABORT,'invalid_regular_room_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    WHERE t.id=NEW.transaction_id AND t.room_id=NEW.room_id
      AND g.tab IN (0,1)
      AND NEW.reward_hundredths=t.total_coins*10
  );
END;
CREATE TRIGGER IF NOT EXISTS sharika_regular_room_reward_no_update
BEFORE UPDATE ON sharika_regular_room_rewards
BEGIN SELECT RAISE(ABORT,'room_reward_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_regular_room_reward_no_delete
BEFORE DELETE ON sharika_regular_room_rewards
BEGIN SELECT RAISE(ABORT,'room_reward_immutable'); END;
