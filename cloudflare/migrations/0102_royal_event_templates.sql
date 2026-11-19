-- Sharika Royal Event templates and per-event verified ranking source.
-- Additive staging migration. Existing events remain in royal_gold / gift_points.
-- No user data, wallets, historical prize receipts, or publication flags changed.
ALTER TABLE sharika_events ADD COLUMN template_id TEXT NOT NULL DEFAULT 'royal_gold'
 CHECK(template_id IN ('royal_gold','diamond_luxury','game_tournament','cp_love','festival_special'));
ALTER TABLE sharika_events ADD COLUMN scoring_mode TEXT NOT NULL DEFAULT 'gift_points'
 CHECK(scoring_mode IN ('gift_points','game_wins','cp_gifts'));
