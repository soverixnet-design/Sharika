-- Avoid duplicate coin holds, invitation spam and multiple open CP proposals.
-- Additive staging schema only: existing coins, profiles and relationships are untouched.
PRAGMA foreign_keys=ON;

CREATE INDEX IF NOT EXISTS sharika_bond_invites_sender_time
  ON sharika_bond_invites(sender_uid,created_at_ms DESC);

CREATE TRIGGER IF NOT EXISTS sharika_bond_invite_guardrails
BEFORE INSERT ON sharika_bond_invites BEGIN
  SELECT RAISE(ABORT,'bond_invite_pair_pending') WHERE EXISTS (
    SELECT 1 FROM sharika_bond_invites i
    WHERE i.status='pending' AND i.type=NEW.type
      AND i.expires_at_ms>NEW.created_at_ms
      AND ((i.sender_uid=NEW.sender_uid AND i.recipient_uid=NEW.recipient_uid)
        OR (i.sender_uid=NEW.recipient_uid AND i.recipient_uid=NEW.sender_uid))
  );
  SELECT RAISE(ABORT,'cp_invite_already_pending')
  WHERE NEW.type='cp' AND EXISTS (
    SELECT 1 FROM sharika_bond_invites i
    WHERE i.type='cp' AND i.status='pending'
      AND i.expires_at_ms>NEW.created_at_ms
      AND (i.sender_uid IN (NEW.sender_uid,NEW.recipient_uid)
        OR i.recipient_uid IN (NEW.sender_uid,NEW.recipient_uid))
  );
  SELECT RAISE(ABORT,'bond_invite_rate_limited') WHERE (
    SELECT COUNT(*) FROM sharika_bond_invites i
    WHERE i.sender_uid=NEW.sender_uid
      AND i.created_at_ms>=NEW.created_at_ms-86400000
  )>=20;
END;
