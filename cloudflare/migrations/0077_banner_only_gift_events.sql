-- Additive staging-only event campaigns. Existing event awards and wallets are untouched.
ALTER TABLE sharika_events ADD COLUMN banner_id INTEGER REFERENCES sharika_banners(id);
ALTER TABLE sharika_events ADD COLUMN gift_rules_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sharika_events ADD COLUMN reward_labels_json TEXT NOT NULL DEFAULT '[]';

-- Gift rankings use genuine settled gift events, bounded by configured gift and UTC window.
CREATE INDEX IF NOT EXISTS idx_sharika_gift_events_campaign
  ON sharika_gift_events(gift_id,created_at,sender_uid);
