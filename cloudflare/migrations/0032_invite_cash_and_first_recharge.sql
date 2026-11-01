-- Staging-only: referral USD earnings are separate from non-redeemable coins.
-- No payment rail, automatic cash disbursement, or coin-to-cash conversion.
CREATE TABLE IF NOT EXISTS sharika_invite_usd_earnings (
  referred_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by TEXT REFERENCES sharika_users(auth_uid),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(referred_uid <> inviter_uid)
);
CREATE INDEX IF NOT EXISTS idx_invite_usd_earner_status
  ON sharika_invite_usd_earnings(inviter_uid,status,created_at);

CREATE TABLE IF NOT EXISTS sharika_invite_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1000 AND 1000000),
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
  payment_reference TEXT,
  reviewed_by TEXT REFERENCES sharika_users(auth_uid),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_withdrawals_user
  ON sharika_invite_withdrawals(inviter_uid,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invite_paid_payment_reference
  ON sharika_invite_withdrawals(payment_reference) WHERE status='paid';

CREATE TABLE IF NOT EXISTS sharika_first_recharge_bonuses (
  recipient_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  recharge_kind TEXT NOT NULL CHECK(recharge_kind IN ('seller','manual')),
  recharge_reference TEXT NOT NULL,
  recharge_coins INTEGER NOT NULL CHECK(recharge_coins > 0),
  bonus_coins INTEGER NOT NULL CHECK(bonus_coins >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recharge_kind,recharge_reference)
);
