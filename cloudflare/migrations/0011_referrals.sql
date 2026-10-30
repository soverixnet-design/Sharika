-- Sharika staging: verified, immutable one-time referral attribution.
-- No coin rewards or wallet mutations are performed by this migration.
CREATE TABLE IF NOT EXISTS sharika_referrals (
  referred_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(referred_uid <> inviter_uid)
);
CREATE INDEX IF NOT EXISTS idx_sharika_referrals_inviter
ON sharika_referrals(inviter_uid,created_at);
CREATE TRIGGER IF NOT EXISTS sharika_referrals_no_update
BEFORE UPDATE ON sharika_referrals BEGIN SELECT RAISE(ABORT,'immutable referral'); END;
CREATE TRIGGER IF NOT EXISTS sharika_referrals_no_delete
BEFORE DELETE ON sharika_referrals BEGIN SELECT RAISE(ABORT,'immutable referral'); END;
