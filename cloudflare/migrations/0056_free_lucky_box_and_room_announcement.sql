-- Free two-hour Lucky Box, separate from paid Lucky Gifts and room rewards.
-- Additive only: no resets to Sharika users, wallets, gifts or existing cosmetics.
CREATE TABLE IF NOT EXISTS sharika_lucky_box_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  coin_reward INTEGER NOT NULL DEFAULT 200 CHECK(coin_reward BETWEEN 1 AND 1000000),
  coin_weight INTEGER NOT NULL DEFAULT 40 CHECK(coin_weight BETWEEN 0 AND 100),
  frame_weight INTEGER NOT NULL DEFAULT 25 CHECK(frame_weight BETWEEN 0 AND 100),
  entry_weight INTEGER NOT NULL DEFAULT 15 CHECK(entry_weight BETWEEN 0 AND 100),
  empty_weight INTEGER NOT NULL DEFAULT 20 CHECK(empty_weight BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(coin_weight+frame_weight+entry_weight+empty_weight=100)
);
INSERT OR IGNORE INTO sharika_lucky_box_settings
  (id,enabled,coin_reward,coin_weight,frame_weight,entry_weight,empty_weight)
VALUES (1,1,200,40,25,15,20);

CREATE TABLE IF NOT EXISTS sharika_lucky_box_pool (
  item_id TEXT PRIMARY KEY REFERENCES sharika_cosmetics_catalog(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
-- Reuse existing supported royalty art without giving away staff or SVIP roles.
INSERT OR IGNORE INTO sharika_lucky_box_pool(item_id,active)
SELECT id,1 FROM sharika_cosmetics_catalog
WHERE active=1 AND kind IN ('frame_style','entry_style')
  AND art_key NOT LIKE 'role-frame-%'
  AND art_key NOT LIKE 'svip-%'
  AND art_key NOT IN ('cs-royal-wings','coin-seller-royal','noble-gold-microphone')
ORDER BY kind,id;

CREATE TABLE IF NOT EXISTS sharika_lucky_box_state (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  next_open_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(next_open_at_ms>=0),
  last_request_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sharika_lucky_box_claims (
  request_id TEXT PRIMARY KEY,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  outcome TEXT NOT NULL CHECK(outcome IN ('coins','frame','entry','empty')),
  item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  item_name TEXT,
  coins_awarded INTEGER NOT NULL DEFAULT 0 CHECK(coins_awarded>=0),
  expires_at_ms INTEGER CHECK(expires_at_ms IS NULL OR expires_at_ms>0),
  opened_at_ms INTEGER NOT NULL CHECK(opened_at_ms>0),
  CHECK((outcome='coins' AND coins_awarded>0 AND item_id IS NULL AND expires_at_ms IS NULL)
    OR (outcome IN ('frame','entry') AND coins_awarded=0 AND item_id IS NOT NULL AND expires_at_ms IS NOT NULL)
    OR (outcome='empty' AND coins_awarded=0 AND item_id IS NULL AND expires_at_ms IS NULL))
);
CREATE INDEX IF NOT EXISTS sharika_lucky_box_claims_user_time
  ON sharika_lucky_box_claims(auth_uid,opened_at_ms DESC);

-- Room owner announcements, shown to newcomers in the room header.
ALTER TABLE sharika_rooms ADD COLUMN announcement TEXT NOT NULL DEFAULT '' CHECK(length(announcement)<=300);
