-- Staging-only, additive invite rewards/withdrawal schema.
-- Apply ONLY after a backup and reconciliation of the existing D1 migration journal.
CREATE TABLE IF NOT EXISTS sharika_invite_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  claim_hours INTEGER NOT NULL DEFAULT 48 CHECK(claim_hours BETWEEN 1 AND 168),
  inviter_coins INTEGER NOT NULL DEFAULT 5000 CHECK(inviter_coins BETWEEN 0 AND 1000000),
  invitee_total_coins INTEGER NOT NULL DEFAULT 10000 CHECK(invitee_total_coins BETWEEN 2000 AND 1000000),
  recharge_percent INTEGER NOT NULL DEFAULT 5 CHECK(recharge_percent BETWEEN 0 AND 100),
  cash_enabled INTEGER NOT NULL DEFAULT 0 CHECK(cash_enabled IN (0,1)),
  inviter_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK(inviter_cash_cents BETWEEN 0 AND 100000),
  invitee_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK(invitee_cash_cents BETWEEN 0 AND 100000),
  withdrawals_enabled INTEGER NOT NULL DEFAULT 0 CHECK(withdrawals_enabled IN (0,1)),
  min_withdraw_cents INTEGER NOT NULL DEFAULT 100 CHECK(min_withdraw_cents BETWEEN 100 AND 1000000),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_invite_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sharika_referral_devices (
  device_hash TEXT PRIMARY KEY CHECK(length(device_hash)=64),
  owner_uid TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  bound_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_invite_cash_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  delta_cents INTEGER NOT NULL CHECK(delta_cents<>0),
  kind TEXT NOT NULL CHECK(kind IN ('inviter_bonus','invitee_bonus','cashout_hold','cashout_refund')),
  request_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_invite_cash_by_user
 ON sharika_invite_cash_ledger(auth_uid,id DESC);
CREATE TRIGGER IF NOT EXISTS sharika_invite_cash_nonnegative
 BEFORE INSERT ON sharika_invite_cash_ledger
 WHEN (SELECT COALESCE(SUM(delta_cents),0) FROM sharika_invite_cash_ledger
       WHERE auth_uid=NEW.auth_uid)+NEW.delta_cents<0
 BEGIN SELECT RAISE(ABORT,'invite_cash_insufficient'); END;
CREATE TRIGGER IF NOT EXISTS sharika_invite_cash_no_update
 BEFORE UPDATE ON sharika_invite_cash_ledger
 BEGIN SELECT RAISE(ABORT,'invite_cash_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_invite_cash_no_delete
 BEFORE DELETE ON sharika_invite_cash_ledger
 BEGIN SELECT RAISE(ABORT,'invite_cash_immutable'); END;
CREATE TABLE IF NOT EXISTS sharika_invite_withdrawals (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=100),
  bank_ciphertext TEXT NOT NULL,
  bank_iv TEXT NOT NULL,
  bank_last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
  transfer_reference TEXT,
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_invite_withdrawals_inbox
 ON sharika_invite_withdrawals(status,created_at DESC);
CREATE INDEX IF NOT EXISTS sharika_invite_withdrawals_by_user
 ON sharika_invite_withdrawals(auth_uid,created_at DESC);

-- Referral crediting requires that this user first bound one Android device.
CREATE TRIGGER IF NOT EXISTS sharika_referral_requires_device
 BEFORE INSERT ON sharika_referrals
 WHEN NOT EXISTS (SELECT 1 FROM sharika_referral_devices WHERE owner_uid=NEW.referred_uid)
 BEGIN SELECT RAISE(ABORT,'referral_device_unverified'); END;

CREATE TRIGGER IF NOT EXISTS sharika_invite_refund_guard
 BEFORE INSERT ON sharika_invite_cash_ledger
 WHEN NEW.kind='cashout_refund'
   AND NOT EXISTS(SELECT 1 FROM sharika_invite_withdrawals
                  WHERE id=substr(NEW.request_key,8) AND status='rejected'
                  AND auth_uid=NEW.auth_uid AND amount_cents=NEW.delta_cents)
 BEGIN SELECT RAISE(ABORT,'withdrawal_not_rejected'); END;
CREATE TRIGGER IF NOT EXISTS sharika_invite_hold_guard
 BEFORE INSERT ON sharika_invite_cash_ledger
 WHEN NEW.kind='cashout_hold'
   AND NOT EXISTS(SELECT 1 FROM sharika_invite_withdrawals
                  WHERE id=substr(NEW.request_key,6) AND status='pending'
                  AND auth_uid=NEW.auth_uid AND amount_cents=-NEW.delta_cents)
 BEGIN SELECT RAISE(ABORT,'withdrawal_hold_mismatch'); END;
