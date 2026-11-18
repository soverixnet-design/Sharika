-- SHARIKA STAGING ONLY. Do not apply to production or reset other migrations.
-- The source slot charges 50x for only 10 bonus spins, grossly below ordinary spin RTP.
-- Cost is adjusted to 10x; 10 spins remain unchanged; historical debits are untouched.
-- Run only after validating target D1 identifier and staging lockout.
-- Protect every insert throughout an interrupted migration: reject bets, never unvalidated debit.
CREATE TRIGGER IF NOT EXISTS royal_ace_validate_transition BEFORE INSERT ON sharika_royal_ace_rounds
BEGIN SELECT RAISE(ABORT,'royal_migrating'); END;
DROP TRIGGER IF EXISTS royal_ace_validate;
CREATE TRIGGER royal_ace_validate BEFORE INSERT ON sharika_royal_ace_rounds
BEGIN
  SELECT RAISE(ABORT,'royal_disabled') WHERE
    (SELECT enabled FROM sharika_royal_ace_settings WHERE id=1)!=1 OR
    COALESCE((SELECT enabled FROM sharika_game_catalog WHERE id='royal-ace'),0)!=1;
  SELECT RAISE(ABORT,'royal_ineligible') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
  SELECT RAISE(ABORT,'royal_invalid_bet') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_royal_ace_settings s,json_each(s.bets_json) b
    WHERE s.id=1 AND CAST(b.value AS INTEGER)=NEW.bet);
  SELECT RAISE(ABORT,'royal_mode_conflict') WHERE
    (NEW.mode='free')!=(COALESCE((SELECT remaining FROM sharika_royal_ace_free
      WHERE user_uid=NEW.user_uid),0)>0);
  SELECT RAISE(ABORT,'royal_mode_conflict') WHERE
    NEW.mode='bonus_buy' AND COALESCE((SELECT remaining FROM sharika_royal_ace_free
      WHERE user_uid=NEW.user_uid),0)>0;
  SELECT RAISE(ABORT,'royal_locked_bet') WHERE NEW.mode='free' AND
    NEW.bet!=(SELECT bet FROM sharika_royal_ace_free WHERE user_uid=NEW.user_uid);
  SELECT RAISE(ABORT,'royal_invalid_cost') WHERE NEW.cost!=CASE
    WHEN NEW.mode='free' THEN 0
    WHEN NEW.mode='paid' THEN NEW.bet
    ELSE NEW.bet*10 END;
  SELECT RAISE(ABORT,'royal_insufficient') WHERE
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid)<NEW.cost;
  SELECT RAISE(ABORT,'royal_rate_limited') WHERE EXISTS(
    SELECT 1 FROM sharika_royal_ace_rounds
     WHERE user_uid=NEW.user_uid AND created_ms>NEW.created_ms-600 LIMIT 1);
END;
DROP TRIGGER IF EXISTS royal_ace_validate_transition;
