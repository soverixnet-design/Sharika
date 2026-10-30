-- Sovera original cosmetic choices for Sharika staging profiles.
-- These are decorative selections, never staff roles or paid entitlements.
-- IDs are an explicit server allowlist. Old accounts default to no effect.
ALTER TABLE sharika_users ADD COLUMN frame_style TEXT NOT NULL DEFAULT ''
  CHECK (frame_style IN (
    '', 'phoenix-fire', 'ice-wings', 'royal-dragon', 'vip7',
    'royal-gold', 'violet-love', 'ice-admin', 'golden-dragon',
    'ice-dragon', 'violet-phoenix', 'castle-flag',
    'lion-queen', 'phoenix-queen', 'tiger-queen'
  ));
ALTER TABLE sharika_users ADD COLUMN entry_style TEXT NOT NULL DEFAULT ''
  CHECK (entry_style IN (
    '', 'phoenix', 'dragon-queen', 'ice-king', 'castle-flag',
    'lion-queen', 'phoenix-queen', 'tiger-queen'
  ));
