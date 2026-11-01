-- Staging-only: owner-editable future reward rules, device participation gate,
-- and encrypted bank payment instructions. No automatic transfer is enabled.
CREATE TABLE IF NOT EXISTS sharika_invite_reward_rules (
  id INTEGER PRIMARY KEY CHECK(id=1),
  inviter_coins INTEGER NOT NULL CHECK(inviter_coins BETWEEN 0 AND 1000000),
  invitee_coins INTEGER NOT NULL CHECK(invitee_coins BETWEEN 2000 AND 1000000),
  invite_usd_cents INTEGER NOT NULL CHECK(invite_usd_cents BETWEEN 0 AND 10000),
  inviter_recharge_percent INTEGER NOT NULL CHECK(inviter_recharge_percent BETWEEN 0 AND 50),
  first_recharge_percent INTEGER NOT NULL CHECK(first_recharge_percent BETWEEN 0 AND 100),
  recharge_coins_per_usd INTEGER NOT NULL CHECK(recharge_coins_per_usd BETWEEN 1000 AND 1000000),
  withdrawal_option_1_cents INTEGER NOT NULL CHECK(withdrawal_option_1_cents BETWEEN 1000 AND 1000000),
  withdrawal_option_2_cents INTEGER NOT NULL CHECK(withdrawal_option_2_cents BETWEEN 1000 AND 1000000),
  claim_window_hours INTEGER NOT NULL CHECK(claim_window_hours BETWEEN 1 AND 168),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(withdrawal_option_1_cents < withdrawal_option_2_cents)
);
INSERT OR IGNORE INTO sharika_invite_reward_rules
  (id,inviter_coins,invitee_coins,invite_usd_cents,inviter_recharge_percent,
   first_recharge_percent,recharge_coins_per_usd,withdrawal_option_1_cents,
   withdrawal_option_2_cents,claim_window_hours)
VALUES (1,100000,100000,10,5,40,500000,5000,10000,48);

-- Device digests must be HMACed with a server-side pepper before storage.
-- A second account from the same official Android installation is ineligible
-- for invite coins and USD, even when it can create a basic account.
CREATE TABLE IF NOT EXISTS sharika_invite_devices (
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  device_digest TEXT NOT NULL CHECK(length(device_digest)=64),
  invite_eligible INTEGER NOT NULL CHECK(invite_eligible IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sharika_invite_eligible_device
  ON sharika_invite_devices(device_digest) WHERE invite_eligible=1;

ALTER TABLE sharika_invite_withdrawals ADD COLUMN bank_details_ciphertext TEXT;
ALTER TABLE sharika_invite_withdrawals ADD COLUMN bank_details_iv TEXT;
ALTER TABLE sharika_invite_withdrawals ADD COLUMN payout_method TEXT;
ALTER TABLE sharika_invite_withdrawals ADD COLUMN bank_account_last4 TEXT;

-- Separate owner/finance inbox: never contains banking instructions or raw
-- device identifiers; full bank details are encrypted and fetched on demand.
CREATE TABLE IF NOT EXISTS sharika_invite_admin_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_id INTEGER NOT NULL UNIQUE REFERENCES sharika_invite_withdrawals(id),
  type TEXT NOT NULL DEFAULT 'bank_withdrawal' CHECK(type='bank_withdrawal'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
