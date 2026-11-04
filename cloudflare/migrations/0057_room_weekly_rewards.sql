-- New gifts accrue room-owner rewards and settle at the end of each UTC week.
-- Historical gifts remain untouched: old roomgift:* ledger credits are NOT paid again.
CREATE TABLE IF NOT EXISTS sharika_room_weekly_accruals (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  week_start_utc TEXT NOT NULL CHECK(length(week_start_utc)=10),
  reward_hundredths INTEGER NOT NULL CHECK(reward_hundredths>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sharika_room_weekly_pending
  ON sharika_room_weekly_accruals(week_start_utc,room_id,owner_uid);

CREATE TABLE IF NOT EXISTS sharika_room_weekly_payouts (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  week_start_utc TEXT NOT NULL CHECK(length(week_start_utc)=10),
  earned_hundredths INTEGER NOT NULL CHECK(earned_hundredths>0),
  coins_paid INTEGER NOT NULL CHECK(coins_paid>=0),
  carry_hundredths INTEGER NOT NULL CHECK(carry_hundredths BETWEEN 0 AND 99),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id,owner_uid,week_start_utc)
);
CREATE INDEX IF NOT EXISTS idx_sharika_room_weekly_payout_owner
  ON sharika_room_weekly_payouts(owner_uid,paid_at DESC);
