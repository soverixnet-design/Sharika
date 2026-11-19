-- Preserve the original round, user and wallet checks for repeated taps.
DROP TRIGGER IF EXISTS sharika_greedy_bet_validate;
CREATE TRIGGER IF NOT EXISTS sharika_greedy_bet_validate
BEFORE INSERT ON sharika_greedy_bets
BEGIN
  SELECT RAISE(ABORT,'greedy_round_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_rounds
    WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'greedy_betting_closed') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_rounds WHERE id=NEW.round_id
    AND starts_ms <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND bet_closes_ms > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
  SELECT RAISE(ABORT,'greedy_user_ineligible') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
    AND status='active' AND minor=0);
END;
DROP TRIGGER IF EXISTS sharika_greedy_classic_bet_validate;
CREATE TRIGGER IF NOT EXISTS sharika_greedy_classic_bet_validate
BEFORE INSERT ON sharika_greedy_classic_bets
BEGIN
  SELECT RAISE(ABORT,'greedy_classic_round_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_classic_rounds
    WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'greedy_classic_betting_closed') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_greedy_classic_rounds WHERE id=NEW.round_id
    AND starts_ms <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND bet_closes_ms > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
  SELECT RAISE(ABORT,'greedy_classic_user_ineligible') WHERE NOT EXISTS (
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
    AND status='active' AND minor=0);
END;
