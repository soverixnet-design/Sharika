CREATE TABLE IF NOT EXISTS sharika_room_reward_claims (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_room_reward_claim_owner
  ON sharika_room_reward_claims(room_id,owner_uid);
CREATE INDEX IF NOT EXISTS idx_sharika_room_accrual_by_owner
  ON sharika_room_weekly_accruals(room_id,owner_uid);

CREATE TRIGGER IF NOT EXISTS sharika_room_reward_claim_credit
AFTER INSERT ON sharika_room_reward_claims
BEGIN
  UPDATE sharika_users SET coins=CASE WHEN status='active'
    AND coins<=1000000000000-NEW.coins THEN coins+NEW.coins ELSE -1 END,
    updated_at=datetime('now') WHERE auth_uid=NEW.owner_uid;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.owner_uid,'coins',NEW.coins,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.owner_uid),
    'room_reward_claim','roomclaim:'||NEW.id);
END;

-- A legacy cron already in flight must not pay an accrual after a manual claim.
CREATE TRIGGER IF NOT EXISTS sharika_room_reward_prevent_legacy_overlap
BEFORE INSERT ON sharika_room_weekly_payouts
WHEN EXISTS (
  SELECT 1 FROM sharika_room_reward_claims
  WHERE room_id=NEW.room_id AND owner_uid=NEW.owner_uid
)
BEGIN
  SELECT RAISE(ABORT,'room_reward_manual_claim_active');
END;
