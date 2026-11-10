-- Phase 1: immutable, server-verified activity feed for future ranking/reward rules.
-- This is additive: never adjusts wallets, existing source rows or prior awards.
-- Existing history is intentionally NOT backfilled by this migration.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sharika_verified_activity_events (
  source_ref TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('gift_sent','recharge_approved','game_settled')),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  scope_id TEXT,
  game_code TEXT,
  amount_coins INTEGER NOT NULL CHECK(amount_coins>0),
  payout_coins INTEGER NOT NULL DEFAULT 0 CHECK(payout_coins>=0),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_verified_activity_type_period
  ON sharika_verified_activity_events(event_type,occurred_at);
CREATE INDEX IF NOT EXISTS sharika_verified_activity_user_period
  ON sharika_verified_activity_events(user_uid,event_type,occurred_at);

CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_no_update
BEFORE UPDATE ON sharika_verified_activity_events
BEGIN SELECT RAISE(ABORT,'verified_activity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_no_delete
BEFORE DELETE ON sharika_verified_activity_events
BEGIN SELECT RAISE(ABORT,'verified_activity_immutable'); END;

-- Gift source: one entry per settled transaction (not one per recipient).
-- The existing gift settlement uses a D1 batch: a later batch error rolls
-- this entry back together with the gift and all wallet changes.
CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_gift
AFTER INSERT ON sharika_gift_transactions
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,scope_id,amount_coins,occurred_at)
  VALUES('gift:'||NEW.id,'gift_sent',NEW.sender_uid,NEW.room_id,
    NEW.total_coins,NEW.created_at);
END;

-- Only finance-verified manual receipts and seller transfers count here.
-- Admin test grants, welcome coins, game wins and referral bonuses do not.
CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_recharge
AFTER INSERT ON sharika_wallet_ledger
WHEN NEW.currency='coins' AND NEW.delta>0
  AND NEW.reason IN ('manual_recharge','seller_recharge')
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,amount_coins,occurred_at)
  VALUES('recharge:'||NEW.id,'recharge_approved',NEW.auth_uid,
    NEW.delta,NEW.created_at);
END;

-- A game counts only when its server-owned bet transitions to settled.
-- Losers are retained (payout=0), so valid-bet and win-count rankings can
-- later be derived without trusting the user's client-side animation.
CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_legacy_game
AFTER UPDATE OF status ON sharika_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:legacy:'||NEW.id,'game_settled',NEW.user_uid,
    NEW.game,NEW.stake,NEW.payout,NEW.settled_at);
END;

CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_original_game
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:original:'||NEW.id,'game_settled',NEW.user_uid,
    NEW.game,NEW.amount,NEW.payout,NEW.settled_at);
END;

CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_greedy_game
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:greedy:'||NEW.id,'game_settled',NEW.user_uid,
    'greedy-wheel',NEW.amount,NEW.payout,NEW.settled_at);
END;

CREATE TRIGGER IF NOT EXISTS sharika_verified_activity_fruit_game
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:fruit:'||NEW.id,'game_settled',NEW.user_uid,
    'fruit-royale',NEW.amount,NEW.payout,NEW.settled_at);
END;
