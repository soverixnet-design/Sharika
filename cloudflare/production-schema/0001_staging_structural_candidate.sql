-- SHARIKA PRODUCTION SCHEMA CANDIDATE (NOT DEPLOYED)
-- Source: read-only staging sqlite_master snapshot, 2026-11-08; schema definitions only.
-- No user rows, wallets, balances, rooms, or media are copied.
-- 153 staging application tables, 109 explicit indexes, 140 triggers.
-- One extra Google Play purchases table and index from audited migration 0066.
-- WARNING: candidate remains blocked until seed-policy, payment, trigger and production-only validation pass.
-- Never run against staging, or any nonempty database.

-- ===== TABLE definitions =====
-- sharika_account_deletion_requests
CREATE TABLE sharika_account_deletion_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,public_id TEXT NOT NULL CHECK(length(public_id) BETWEEN 1 AND 10),contact_email TEXT NOT NULL CHECK(length(contact_email) BETWEEN 5 AND 180),reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 400),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','completed','rejected')),created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- sharika_active_cp_slots
CREATE TABLE sharika_active_cp_slots (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id)
);

-- sharika_admin_audit
CREATE TABLE sharika_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_admin_coin_adjustments
CREATE TABLE sharika_admin_coin_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid,request_id)
);

-- sharika_admin_direct_recharges
CREATE TABLE "sharika_admin_direct_recharges" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_uid,request_id)
);

-- sharika_admin_roles
CREATE TABLE sharika_admin_roles (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL CHECK (role IN ('super','support','finance')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_admin_staff_accounts
CREATE TABLE sharika_admin_staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL UNIQUE CHECK(length(auth_uid) BETWEEN 20 AND 190),
  login_email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(login_email) BETWEEN 6 AND 254),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  permissions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(permissions_json) AND json_type(permissions_json)='array'),
  daily_coin_limit INTEGER NOT NULL DEFAULT 0 CHECK(daily_coin_limit BETWEEN 0 AND 10000000),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, expires_at_ms INTEGER DEFAULT NULL
    CHECK(expires_at_ms IS NULL OR expires_at_ms>0));

-- sharika_agency_earnings
CREATE TABLE sharika_agency_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  host_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('host_salary','agency','bd')),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 10000),
  amount_units INTEGER NOT NULL CHECK(amount_units>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gift_event_id,kind)
);

-- sharika_agency_hosts
CREATE TABLE sharika_agency_hosts (
  host_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_agency_policy
CREATE TABLE sharika_agency_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  host_bps INTEGER NOT NULL DEFAULT 4000 CHECK(host_bps BETWEEN 0 AND 8000),
  agency_bps INTEGER NOT NULL DEFAULT 1000 CHECK(agency_bps BETWEEN 0 AND 5000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 3000),
  settlement_mode TEXT NOT NULL DEFAULT 'weekly'
    CHECK(settlement_mode IN ('daily','weekly','monthly')),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(host_bps+agency_bps+bd_bps<=10000)
);

-- sharika_agency_policy_audit
CREATE TABLE sharika_agency_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_agency_presence_cursor
CREATE TABLE sharika_agency_presence_cursor (
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  room_id TEXT REFERENCES sharika_rooms(id) ON DELETE SET NULL,
  utc_day TEXT NOT NULL,
  last_seen_ms INTEGER NOT NULL CHECK (last_seen_ms >= 0)
);

-- sharika_agency_room_activity
CREATE TABLE sharika_agency_room_activity (
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  -- Preserve historical time even if the room is later deleted.
  room_id TEXT NOT NULL,
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK(active_seconds>=0),
  PRIMARY KEY(user_uid,room_id,utc_day)
);

-- sharika_agency_salary_config
CREATE TABLE sharika_agency_salary_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  coins_per_usd INTEGER NOT NULL DEFAULT 500000 CHECK(coins_per_usd BETWEEN 1 AND 1000000000),
  min_host_target_coins INTEGER NOT NULL DEFAULT 5000000 CHECK(min_host_target_coins>=1),
  exchange_enabled INTEGER NOT NULL DEFAULT 0 CHECK(exchange_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_agency_salary_exchanges
CREATE TABLE sharika_agency_salary_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL,
  salary_units INTEGER NOT NULL CHECK(salary_units>0 AND salary_units%10000=0),
  credited_coins INTEGER NOT NULL CHECK(credited_coins>0 AND credited_coins<=100000000),
  settlement_mode TEXT NOT NULL CHECK(settlement_mode IN ('daily','weekly','monthly')),
  policy_version INTEGER NOT NULL CHECK(policy_version>=1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,request_id),
  CHECK(salary_units=credited_coins*10000)
);

-- sharika_agency_salary_policy_audit
CREATE TABLE sharika_agency_salary_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_json TEXT NOT NULL,
  new_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_agency_salary_seller_transfers
CREATE TABLE sharika_agency_salary_seller_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  request_id TEXT NOT NULL,
  salary_units INTEGER NOT NULL CHECK(salary_units>0 AND salary_units%10000=0),
  credited_coins INTEGER NOT NULL CHECK(credited_coins BETWEEN 1 AND 100000000),
  settlement_mode TEXT NOT NULL CHECK(settlement_mode IN ('daily','weekly','monthly')),
  policy_version INTEGER NOT NULL CHECK(policy_version>=1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,request_id),
  CHECK(salary_units=credited_coins*10000)
);

-- sharika_agency_salary_targets
CREATE TABLE sharika_agency_salary_targets (
  target_coins INTEGER PRIMARY KEY CHECK(target_coins>=1),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_banner_images
CREATE TABLE sharika_banner_images (
  banner_id INTEGER PRIMARY KEY REFERENCES sharika_banners(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK(mime='image/jpeg'),
  image_base64 TEXT NOT NULL,
  -- Zero means removed; keep the version so re-upload invalidates caches.
  image_bytes INTEGER NOT NULL CHECK(image_bytes BETWEEN 0 AND 360000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_banners
CREATE TABLE sharika_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  subtitle TEXT NOT NULL DEFAULT '' CHECK(length(subtitle)<=160),
  emoji TEXT NOT NULL DEFAULT '🎉' CHECK(length(emoji)<=12),
  color_a TEXT NOT NULL DEFAULT '#9b4dff',
  color_b TEXT NOT NULL DEFAULT '#ff3dc8',
  action TEXT NOT NULL DEFAULT 'none' CHECK(action IN ('none','daily','recharge','rank','invite')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_bd_agents
CREATE TABLE sharika_bd_agents (
  bd_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  can_grant INTEGER NOT NULL DEFAULT 0 CHECK(can_grant IN (0,1)),
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_bond_audit
CREATE TABLE sharika_bond_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL,
  invite_id INTEGER,
  bond_id INTEGER,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL
);

-- sharika_bond_gift_events
CREATE TABLE sharika_bond_gift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id),
  invite_id INTEGER UNIQUE REFERENCES sharika_bond_invites(id),
  gift_id INTEGER REFERENCES sharika_bond_gifts(id),
  request_id TEXT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  value_coins INTEGER NOT NULL CHECK(value_coins>0),
  created_at_ms INTEGER NOT NULL
);

-- sharika_bond_gifts
CREATE TABLE sharika_bond_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  emoji TEXT NOT NULL CHECK(length(emoji) BETWEEN 1 AND 16),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- sharika_bond_invites
CREATE TABLE sharika_bond_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  gift_id INTEGER NOT NULL REFERENCES sharika_bond_gifts(id),
  held_coins INTEGER NOT NULL CHECK(held_coins BETWEEN 1 AND 1000000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
  resolved_at_ms INTEGER,
  refunded_at_ms INTEGER,
  CHECK(sender_uid<>recipient_uid),
  UNIQUE(sender_uid,request_id)
);

-- sharika_bond_policy
CREATE TABLE sharika_bond_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  cp_enabled INTEGER NOT NULL DEFAULT 1 CHECK(cp_enabled IN (0,1)),
  friendship_enabled INTEGER NOT NULL DEFAULT 1 CHECK(friendship_enabled IN (0,1)),
  expiry_hours INTEGER NOT NULL DEFAULT 24 CHECK(expiry_hours BETWEEN 1 AND 168),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_bonds
CREATE TABLE sharika_bonds (
  id INTEGER PRIMARY KEY REFERENCES sharika_bond_invites(id),
  type TEXT NOT NULL CHECK(type IN ('cp','friendship')),
  uid_a TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  uid_b TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pair_key TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  CHECK(uid_a<uid_b)
);

-- sharika_celebration_settings
CREATE TABLE sharika_celebration_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  gift_threshold_coins INTEGER NOT NULL DEFAULT 1000000
    CHECK(gift_threshold_coins BETWEEN 1000 AND 1000000000000),
  win_threshold_coins INTEGER NOT NULL DEFAULT 10000000
    CHECK(win_threshold_coins BETWEEN 1000 AND 1000000000000),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_coin_seller_admin_audit
CREATE TABLE sharika_coin_seller_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  action TEXT NOT NULL CHECK(action IN ('approve','suspend','allocate')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_coin_seller_allocations
CREATE TABLE "sharika_coin_seller_allocations" (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
 
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000),
 stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
 request_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_coin_seller_stock_mode_audit
CREATE TABLE sharika_coin_seller_stock_mode_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  unlimited_stock INTEGER NOT NULL CHECK(unlimited_stock IN (0,1)),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 200),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_coin_seller_transfers
CREATE TABLE "sharika_coin_seller_transfers" (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 
 seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
 target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
 stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
 request_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(seller_uid, request_id)
);

-- sharika_coin_sellers
CREATE TABLE sharika_coin_sellers (
  seller_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  available_coins INTEGER NOT NULL DEFAULT 0 CHECK(available_coins BETWEEN 0 AND 1000000000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, unlimited_stock INTEGER NOT NULL DEFAULT 0
    CHECK(unlimited_stock IN (0,1)));

-- sharika_cosmetic_equipped
CREATE TABLE sharika_cosmetic_equipped (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('frame_style','entry_style','medal_style','name_tag_style')),
  item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  equipped_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,kind)
);

-- sharika_cosmetic_inventory
CREATE TABLE sharika_cosmetic_inventory (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL REFERENCES sharika_cosmetics_catalog(id),
  source TEXT NOT NULL CHECK(source IN ('purchase','admin_grant','legacy')),
  request_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at_ms INTEGER DEFAULT NULL
    CHECK(expires_at_ms IS NULL OR expires_at_ms>0),
  PRIMARY KEY(auth_uid,item_id),
  UNIQUE(auth_uid,request_id)
);

-- sharika_cosmetics_catalog
CREATE TABLE sharika_cosmetics_catalog (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 3 AND 70),
  kind TEXT NOT NULL CHECK(kind IN ('frame_style','entry_style','medal_style','name_tag_style')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  art_key TEXT NOT NULL CHECK(length(art_key) BETWEEN 1 AND 70),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, image_url TEXT NOT NULL DEFAULT '', animation_url TEXT NOT NULL DEFAULT '', audio_url TEXT NOT NULL DEFAULT '');

-- sharika_cp_reward_batches
CREATE TABLE sharika_cp_reward_batches (
  week_start_ms INTEGER PRIMARY KEY CHECK(week_start_ms>0),
  week_end_ms INTEGER NOT NULL CHECK(week_end_ms=week_start_ms+604800000),
  issued_by TEXT NOT NULL,
  awarded_at_ms INTEGER NOT NULL,
  winner_count INTEGER NOT NULL CHECK(winner_count BETWEEN 0 AND 7)
);

-- sharika_cp_reward_member_awards
CREATE TABLE sharika_cp_reward_member_awards (
  week_start_ms INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT,
  medal_item_id TEXT,
  awarded_at_ms INTEGER NOT NULL,
  PRIMARY KEY(week_start_ms,auth_uid),
  FOREIGN KEY(week_start_ms,rank) REFERENCES sharika_cp_reward_winners(week_start_ms,rank)
);

-- sharika_cp_reward_policy
CREATE TABLE sharika_cp_reward_policy (
  key TEXT PRIMARY KEY CHECK(key='weekly'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  auto_award INTEGER NOT NULL DEFAULT 0 CHECK(auto_award IN (0,1)),
  auto_start_week_ms INTEGER NOT NULL DEFAULT 0 CHECK(auto_start_week_ms>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_cp_reward_rules
CREATE TABLE sharika_cp_reward_rules (
  rank INTEGER PRIMARY KEY CHECK(rank BETWEEN 1 AND 7),
  coins_each INTEGER NOT NULL DEFAULT 0 CHECK(coins_each BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_cp_reward_winners
CREATE TABLE sharika_cp_reward_winners (
  week_start_ms INTEGER NOT NULL REFERENCES sharika_cp_reward_batches(week_start_ms),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  bond_id INTEGER NOT NULL REFERENCES sharika_bonds(id),
  uid_a TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  uid_b TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  score INTEGER NOT NULL CHECK(score>=0),
  coins_each INTEGER NOT NULL CHECK(coins_each BETWEEN 0 AND 1000000),
  frame_item_id TEXT,
  medal_item_id TEXT,
  PRIMARY KEY(week_start_ms,rank),
  UNIQUE(week_start_ms,bond_id),
  CHECK(uid_a<>uid_b)
);

-- sharika_daily_checkins
CREATE TABLE sharika_daily_checkins (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  streak INTEGER NOT NULL CHECK(streak BETWEEN 1 AND 7),
  reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,utc_day)
);

-- sharika_daily_config_audit
CREATE TABLE sharika_daily_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_rewards TEXT NOT NULL,
  new_rewards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_daily_reward_config
CREATE TABLE sharika_daily_reward_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  day1 INTEGER NOT NULL CHECK(day1 BETWEEN 1 AND 1000),
  day2 INTEGER NOT NULL CHECK(day2 BETWEEN 1 AND 1000),
  day3 INTEGER NOT NULL CHECK(day3 BETWEEN 1 AND 1000),
  day4 INTEGER NOT NULL CHECK(day4 BETWEEN 1 AND 1000),
  day5 INTEGER NOT NULL CHECK(day5 BETWEEN 1 AND 1000),
  day6 INTEGER NOT NULL CHECK(day6 BETWEEN 1 AND 1000),
  day7 INTEGER NOT NULL CHECK(day7 BETWEEN 1 AND 1000),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_daily_task_claims
CREATE TABLE sharika_daily_task_claims (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL CHECK(length(utc_day)=10),
  task_key TEXT NOT NULL CHECK(task_key IN ('follow','gift')),
  reward_coins INTEGER NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,utc_day,task_key)
);

-- sharika_daily_task_config
CREATE TABLE sharika_daily_task_config (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  follow_coins INTEGER NOT NULL CHECK(follow_coins BETWEEN 1 AND 1000),
  gift_coins INTEGER NOT NULL CHECK(gift_coins BETWEEN 1 AND 1000),
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_daily_task_config_audit
CREATE TABLE sharika_daily_task_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  old_rewards TEXT NOT NULL,
  new_rewards TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_event_awards
CREATE TABLE sharika_event_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES sharika_events(id),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000),
  request_id TEXT NOT NULL UNIQUE CHECK(length(request_id) BETWEEN 12 AND 80),
  granted_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id,rank),
  UNIQUE(event_id,auth_uid)
);

-- sharika_events
CREATE TABLE sharika_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
  kind TEXT NOT NULL CHECK(kind IN ('gift_race','room_battle','recharge_bonus','game_tournament','invite_campaign','checkin_festival','festival','custom')),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
  starts_at TEXT NOT NULL CHECK(length(starts_at)=24),
  ends_at TEXT NOT NULL CHECK(length(ends_at)=24 AND ends_at>starts_at),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  prize_1 INTEGER NOT NULL DEFAULT 0 CHECK(prize_1 BETWEEN 0 AND 1000000),
  prize_2 INTEGER NOT NULL DEFAULT 0 CHECK(prize_2 BETWEEN 0 AND 1000000),
  prize_3 INTEGER NOT NULL DEFAULT 0 CHECK(prize_3 BETWEEN 0 AND 1000000),
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, banner_id INTEGER REFERENCES sharika_banners(id), gift_rules_json TEXT NOT NULL DEFAULT '[]', reward_labels_json TEXT NOT NULL DEFAULT '[]');

-- sharika_exchange_rate
CREATE TABLE sharika_exchange_rate (id INTEGER PRIMARY KEY CHECK (id = 1), diamonds_per_unit INTEGER NOT NULL CHECK (diamonds_per_unit BETWEEN 1 AND 10000), coins_per_unit INTEGER NOT NULL CHECK (coins_per_unit BETWEEN 1 AND 10000), revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), updated_by TEXT REFERENCES sharika_users(auth_uid), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

-- sharika_families
CREATE TABLE sharika_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 3 AND 40),
  owner_uid TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_activity
CREATE TABLE sharika_family_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  subject_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN (
    'owner_transfer','member_role','member_remove','request_reopened','family_status'
  )),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_creation_requests
CREATE TABLE sharika_family_creation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 40),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=240),
  country TEXT NOT NULL DEFAULT '' CHECK(length(country)<=80),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','cancelled')),
  family_id INTEGER REFERENCES sharika_families(id),
  assigned_bd_uid TEXT REFERENCES sharika_bd_agents(bd_uid),
  reviewed_by TEXT,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK(length(decision_reason)<=240),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

-- sharika_family_crystal_ledger
CREATE TABLE sharika_family_crystal_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_event_id INTEGER NOT NULL REFERENCES sharika_gift_events(id),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  beneficiary_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  kind TEXT NOT NULL CHECK(kind IN ('family_owner','bd')),
  rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 1 AND 2500),
  crystal_units INTEGER NOT NULL CHECK(crystal_units>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gift_event_id,kind)
);

-- sharika_family_crystal_transfers
CREATE TABLE sharika_family_crystal_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  seller_uid TEXT NOT NULL REFERENCES sharika_coin_sellers(seller_uid),
  crystal_units INTEGER NOT NULL CHECK(crystal_units>=10000 AND crystal_units%10000=0),
  coins_to_seller INTEGER NOT NULL DEFAULT 0 CHECK(coins_to_seller>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  approved_by TEXT REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(sender_uid,request_id)
);

-- sharika_family_grants
CREATE TABLE sharika_family_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL UNIQUE REFERENCES sharika_families(id),
  bd_uid TEXT NOT NULL REFERENCES sharika_bd_agents(bd_uid),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bd_uid,request_id)
);

-- sharika_family_invites
CREATE TABLE sharika_family_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  source TEXT NOT NULL DEFAULT 'owner' CHECK(source IN ('owner','admin')),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','accepted','declined','cancelled','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days')),
  responded_at TEXT
);

-- sharika_family_join_requests
CREATE TABLE sharika_family_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  applicant_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE(family_id,applicant_uid)
);

-- sharika_family_leaves
CREATE TABLE sharika_family_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  left_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_members
CREATE TABLE sharika_family_members (
  family_id INTEGER NOT NULL REFERENCES sharika_families(id),
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('leader','co_leader','elder','member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_policy
CREATE TABLE sharika_family_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  owner_bps INTEGER NOT NULL DEFAULT 1000 CHECK(owner_bps BETWEEN 0 AND 2000),
  bd_bps INTEGER NOT NULL DEFAULT 500 CHECK(bd_bps BETWEEN 0 AND 1000),
  settlement_mode TEXT NOT NULL DEFAULT 'monthly' CHECK(settlement_mode IN ('daily','monthly')),
  max_members INTEGER NOT NULL DEFAULT 20 CHECK(max_members BETWEEN 2 AND 200),
  conversion_enabled INTEGER NOT NULL DEFAULT 0 CHECK(conversion_enabled IN (0,1)),
  coins_per_crystal INTEGER NOT NULL DEFAULT 1 CHECK(coins_per_crystal BETWEEN 1 AND 10000),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(owner_bps+bd_bps<=2500)
);

-- sharika_family_policy_audit
CREATE TABLE sharika_family_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_settlement_preferences
CREATE TABLE sharika_family_settlement_preferences (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  mode TEXT NOT NULL DEFAULT 'monthly' CHECK(mode IN ('daily','weekly','monthly')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_family_sheet_sync
CREATE TABLE sharika_family_sheet_sync (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  last_synced_day TEXT NOT NULL,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count>=0)
);

-- sharika_family_transfer_audit
CREATE TABLE sharika_family_transfer_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL UNIQUE REFERENCES sharika_family_crystal_transfers(id),
  admin_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('approved','rejected')),
  coins_added INTEGER NOT NULL DEFAULT 0 CHECK(coins_added>=0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_first_recharge_bonuses
CREATE TABLE sharika_first_recharge_bonuses (
  recipient_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  recharge_kind TEXT NOT NULL CHECK(recharge_kind IN ('seller','manual')),
  recharge_reference TEXT NOT NULL,
  recharge_coins INTEGER NOT NULL CHECK(recharge_coins > 0),
  bonus_coins INTEGER NOT NULL CHECK(bonus_coins >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recharge_kind,recharge_reference)
);

-- sharika_follows
CREATE TABLE sharika_follows (
  follower_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  followed_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(follower_uid,followed_uid),
  CHECK(follower_uid <> followed_uid)
);

-- sharika_fruit_royale_bets
CREATE TABLE sharika_fruit_royale_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_fruit_royale_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,request_id),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL AND result_json IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);

-- sharika_fruit_royale_jackpots
CREATE TABLE sharika_fruit_royale_jackpots (
  round_id TEXT PRIMARY KEY REFERENCES sharika_fruit_royale_rounds(id),
  budget INTEGER NOT NULL CHECK(budget>=0),
  total_stake INTEGER NOT NULL CHECK(total_stake>0)
);

-- sharika_fruit_royale_pool
CREATE TABLE sharika_fruit_royale_pool (
  id TEXT PRIMARY KEY CHECK(id='main'),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0)
);

-- sharika_fruit_royale_rounds
CREATE TABLE sharika_fruit_royale_rounds (
  id TEXT PRIMARY KEY,
  round_no INTEGER NOT NULL UNIQUE CHECK(round_no>=0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  closes_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);

-- sharika_gaddy_bets
CREATE TABLE sharika_gaddy_bets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 round_id TEXT NOT NULL REFERENCES sharika_gaddy_rounds(id),
 round_no INTEGER NOT NULL,
 user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
 pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 7),
 amount INTEGER NOT NULL CHECK(amount IN (50,500,2000,10000)),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
 payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
 result_key TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 settled_at TEXT,
 UNIQUE(user_uid,request_id),
 CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
       (status='settled' AND settled_at IS NOT NULL AND result_key IS NOT NULL))
);

-- sharika_gaddy_config
CREATE TABLE sharika_gaddy_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 weights_json TEXT NOT NULL,
 multipliers_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_gaddy_rounds
CREATE TABLE sharika_gaddy_rounds (
 id TEXT PRIMARY KEY,
 round_no INTEGER NOT NULL UNIQUE CHECK(round_no>=0),
 starts_ms INTEGER NOT NULL,
 bet_closes_ms INTEGER NOT NULL,
 closes_ms INTEGER NOT NULL,
 seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
 commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
 weights_json TEXT NOT NULL,
 multipliers_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);

-- sharika_game_bets
CREATE TABLE "sharika_game_bets" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK(game IN ('food-wheel','jackpot-fruit')),
  round_no INTEGER NOT NULL,
  round_id TEXT NOT NULL REFERENCES sharika_game_rounds(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  stake INTEGER NOT NULL CHECK(stake>0 AND stake<=250000000000000),
  pick_index INTEGER CHECK(pick_index BETWEEN 0 AND 8),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0 AND payout<=stake*36),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,game,round_no),
  UNIQUE(user_uid,request_id),
  CHECK((game='food-wheel' AND pick_index IS NOT NULL) OR
        (game='jackpot-fruit' AND pick_index IS NULL)),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);

-- sharika_game_catalog
CREATE TABLE sharika_game_catalog (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_game_rounds
CREATE TABLE sharika_game_rounds (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL CHECK(game IN ('food-wheel','jackpot-fruit')),
  round_no INTEGER NOT NULL CHECK(round_no>=0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  closes_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(game,round_no),
  CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);

-- sharika_gift_events
CREATE TABLE sharika_gift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  gift_id INTEGER NOT NULL REFERENCES sharika_gifts(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
  price_coins INTEGER NOT NULL CHECK(price_coins > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(transaction_id,recipient_uid)
);

-- sharika_gift_transactions
CREATE TABLE sharika_gift_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  gift_id INTEGER NOT NULL REFERENCES sharika_gifts(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
  recipient_ids_json TEXT NOT NULL,
  total_coins INTEGER NOT NULL CHECK(total_coins > 0),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sender_uid,request_id)
);

-- sharika_gifts
CREATE TABLE sharika_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁',
  tab INTEGER NOT NULL DEFAULT 0 CHECK (tab BETWEEN 0 AND 2),
  price_coins INTEGER NOT NULL CHECK (price_coins > 0),
  image_url TEXT,
  animation_url TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1))
, audio_url TEXT NOT NULL DEFAULT '');

-- sharika_global_celebrations
CREATE TABLE sharika_global_celebrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('gift','win')),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT REFERENCES sharika_users(auth_uid),
  gift_id INTEGER REFERENCES sharika_gifts(id),
  game TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount_coins INTEGER NOT NULL CHECK(amount_coins>0),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_greedy_bets
CREATE TABLE sharika_greedy_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT NOT NULL REFERENCES sharika_greedy_rounds(id),
  round_no INTEGER NOT NULL,
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  item_id TEXT NOT NULL CHECK(item_id IN
    ('shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout >= 0),
  result_id TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid, request_id),
  CHECK((status='accepted' AND payout=0 AND result_id IS NULL AND settled_at IS NULL)
    OR (status='settled' AND result_id IS NOT NULL AND settled_at IS NOT NULL))
);

-- sharika_greedy_rounds
CREATE TABLE sharika_greedy_rounds (
  id TEXT PRIMARY KEY,
  round_no INTEGER NOT NULL UNIQUE CHECK(round_no >= 0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  settles_ms INTEGER NOT NULL,
  ends_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex) = 64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256) = 64),
  CHECK(starts_ms < bet_closes_ms AND bet_closes_ms < settles_ms AND settles_ms < ends_ms)
);

-- sharika_invite_admin_inbox
CREATE TABLE sharika_invite_admin_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_id INTEGER NOT NULL UNIQUE REFERENCES sharika_invite_withdrawals(id),
  type TEXT NOT NULL DEFAULT 'bank_withdrawal' CHECK(type='bank_withdrawal'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_invite_devices
CREATE TABLE sharika_invite_devices (
  user_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  device_digest TEXT NOT NULL CHECK(length(device_digest)=64),
  invite_eligible INTEGER NOT NULL CHECK(invite_eligible IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_invite_reward_rules
CREATE TABLE sharika_invite_reward_rules (
  id INTEGER PRIMARY KEY CHECK(id=1),
  inviter_coins INTEGER NOT NULL CHECK(inviter_coins BETWEEN 0 AND 1000000),
  invitee_coins INTEGER NOT NULL CHECK(invitee_coins BETWEEN 2000 AND 1000000),
  invite_usd_cents INTEGER NOT NULL CHECK(invite_usd_cents BETWEEN 0 AND 10000),
  inviter_recharge_percent INTEGER NOT NULL CHECK(inviter_recharge_percent BETWEEN 0 AND 50),
  first_recharge_percent INTEGER NOT NULL CHECK(first_recharge_percent BETWEEN 0 AND 100),
  recharge_coins_per_usd INTEGER NOT NULL CHECK(recharge_coins_per_usd BETWEEN 1000 AND 1000000),
  withdrawal_option_1_cents INTEGER NOT NULL CHECK(withdrawal_option_1_cents BETWEEN 1000 AND 1000000),
  withdrawal_option_2_cents INTEGER NOT NULL CHECK(withdrawal_option_2_cents BETWEEN 1000 AND 1000000),
  claim_window_hours INTEGER NOT NULL CHECK(claim_window_hours BETWEEN 1 AND 168),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(withdrawal_option_1_cents < withdrawal_option_2_cents)
);

-- sharika_invite_usd_coin_conversions
CREATE TABLE sharika_invite_usd_coin_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
  coins INTEGER NOT NULL CHECK(coins > 0),
  coins_per_usd INTEGER NOT NULL CHECK(coins_per_usd BETWEEN 1000 AND 1000000),
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_invite_usd_earnings
CREATE TABLE sharika_invite_usd_earnings (
  referred_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by TEXT REFERENCES sharika_users(auth_uid),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(referred_uid <> inviter_uid)
);

-- sharika_invite_withdrawals
CREATE TABLE sharika_invite_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1000 AND 1000000),
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
  payment_reference TEXT,
  reviewed_by TEXT REFERENCES sharika_users(auth_uid),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, bank_details_ciphertext TEXT, bank_details_iv TEXT, payout_method TEXT, bank_account_last4 TEXT);

-- sharika_lucky_box_claims
CREATE TABLE sharika_lucky_box_claims (
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

-- sharika_lucky_box_pool
CREATE TABLE sharika_lucky_box_pool (
  item_id TEXT PRIMARY KEY REFERENCES sharika_cosmetics_catalog(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

-- sharika_lucky_box_settings
CREATE TABLE sharika_lucky_box_settings (
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

-- sharika_lucky_box_state
CREATE TABLE sharika_lucky_box_state (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  next_open_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(next_open_at_ms>=0),
  last_request_id TEXT NOT NULL DEFAULT ''
);

-- sharika_lucky_diamond_accruals
CREATE TABLE sharika_lucky_diamond_accruals (
  recipient_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  earned_hundredths INTEGER NOT NULL DEFAULT 0 CHECK (earned_hundredths >= 0),
  credited_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (credited_diamonds >= 0),
  CHECK (credited_diamonds * 100 <= earned_hundredths)
);

-- sharika_lucky_gift_outcomes
CREATE TABLE sharika_lucky_gift_outcomes (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  payout_coins INTEGER NOT NULL CHECK (payout_coins >= 0),
  max_multiplier INTEGER NOT NULL CHECK (max_multiplier IN (0,1,2,5,10,50)),
  rolls_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_lucky_recipient_rewards
CREATE TABLE sharika_lucky_recipient_rewards (
  transaction_id INTEGER NOT NULL REFERENCES sharika_gift_transactions(id),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  earned_hundredths INTEGER NOT NULL CHECK (earned_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(transaction_id, recipient_uid)
);

-- sharika_lucky_room_rewards
CREATE TABLE sharika_lucky_room_rewards (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  reward_hundredths INTEGER NOT NULL CHECK (reward_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_manual_recharge_reviews
CREATE TABLE "sharika_manual_recharge_reviews" (
  support_message_id INTEGER PRIMARY KEY REFERENCES sharika_support_messages(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  admin_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected')),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000000000),
  payment_method TEXT NOT NULL DEFAULT '',
  payment_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (status='approved' AND coins>=1
      AND length(payment_method) BETWEEN 2 AND 40
      AND length(payment_reference) BETWEEN 6 AND 120)
    OR
    (status='rejected' AND coins=0
      AND payment_method='' AND payment_reference=''
      AND length(note) BETWEEN 8 AND 250)
  )
);

-- sharika_message_reads
CREATE TABLE sharika_message_reads (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  other_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_id>=0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(auth_uid,other_uid),
  CHECK(auth_uid<>other_uid)
);

-- sharika_notifications
CREATE TABLE sharika_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('official','event','reward','gift','system')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000),
  dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 5 AND 120),
  created_by TEXT REFERENCES sharika_users(auth_uid),
  read_at TEXT,
  push_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(push_status IN ('pending','sent','not_configured','no_device','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recipient_uid,dedupe_key)
);

-- sharika_opening_cursors
CREATE TABLE sharika_opening_cursors (viewer_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),week_key TEXT NOT NULL,opens INTEGER NOT NULL DEFAULT 0 CHECK(opens>=0),updated_at TEXT NOT NULL DEFAULT(datetime('now')));

-- sharika_opening_settings
CREATE TABLE sharika_opening_settings (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),mode TEXT NOT NULL DEFAULT 'automatic' CHECK(mode IN ('automatic','custom')),duration_seconds INTEGER NOT NULL DEFAULT 10 CHECK(duration_seconds BETWEEN 3 AND 30),custom_user_id TEXT NOT NULL DEFAULT '',custom_title TEXT NOT NULL DEFAULT '',custom_subtitle TEXT NOT NULL DEFAULT '',custom_image_url TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),updated_at TEXT NOT NULL DEFAULT(datetime('now')));

-- sharika_original_game_bets
CREATE TABLE sharika_original_game_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK(game IN ('sovera-food','night-food','jackpot-fruit')),
  round_no INTEGER NOT NULL,
  round_id TEXT NOT NULL REFERENCES sharika_original_game_rounds(id),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  pick_index INTEGER NOT NULL CHECK(pick_index BETWEEN 0 AND 9),
  amount INTEGER NOT NULL CHECK(amount>0 AND amount<=100000000),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 12 AND 80),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','settled')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK(payout>=0),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  settled_at TEXT,
  UNIQUE(user_uid,request_id),
  CHECK((status='accepted' AND payout=0 AND settled_at IS NULL) OR
        (status='settled' AND settled_at IS NOT NULL AND result_json IS NOT NULL))
);

-- sharika_original_game_pools
CREATE TABLE sharika_original_game_pools (
  game TEXT PRIMARY KEY CHECK(game='jackpot-fruit'),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0)
);

-- sharika_original_game_rounds
CREATE TABLE sharika_original_game_rounds (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL CHECK(game IN ('sovera-food','night-food','jackpot-fruit')),
  round_no INTEGER NOT NULL CHECK(round_no>=0),
  starts_ms INTEGER NOT NULL,
  bet_closes_ms INTEGER NOT NULL,
  closes_ms INTEGER NOT NULL,
  seed_hex TEXT NOT NULL CHECK(length(seed_hex)=64),
  commit_sha256 TEXT NOT NULL CHECK(length(commit_sha256)=64),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(game,round_no),
  CHECK(starts_ms<bet_closes_ms AND bet_closes_ms<closes_ms)
);

-- sharika_original_jackpot_budgets
CREATE TABLE sharika_original_jackpot_budgets (
  round_id TEXT PRIMARY KEY REFERENCES sharika_original_game_rounds(id),
  budget INTEGER NOT NULL CHECK(budget>=0),
  total_stake INTEGER NOT NULL CHECK(total_stake>0)
);

-- sharika_play_billing_purchases
CREATE TABLE sharika_play_billing_purchases (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  product_id TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins>0),
  order_id TEXT,
  test_purchase INTEGER NOT NULL DEFAULT 0 CHECK(test_purchase IN (0,1)),
  credited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_premium_audit
CREATE TABLE sharika_premium_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_premium_daily_claims
CREATE TABLE sharika_premium_daily_claims (
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  utc_day TEXT NOT NULL,
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  reward_coins INTEGER NOT NULL CHECK(reward_coins>0),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(auth_uid,utc_day)
);

-- sharika_premium_memberships
CREATE TABLE sharika_premium_memberships (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  source TEXT NOT NULL CHECK(source IN ('purchase','admin')),
  starts_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>starts_at_ms),
  granted_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
, svip_level INTEGER NOT NULL DEFAULT 1 CHECK(svip_level BETWEEN 1 AND 8));

-- sharika_premium_policy
CREATE TABLE sharika_premium_policy (
  key TEXT PRIMARY KEY CHECK(key='standard'),
  purchase_enabled INTEGER NOT NULL DEFAULT 1 CHECK(purchase_enabled IN (0,1)),
  admin_grant_enabled INTEGER NOT NULL DEFAULT 1 CHECK(admin_grant_enabled IN (0,1)),
  auto_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_enabled IN (0,1)),
  auto_by_level INTEGER NOT NULL DEFAULT 1 CHECK(auto_by_level IN (0,1)),
  auto_by_gifts INTEGER NOT NULL DEFAULT 1 CHECK(auto_by_gifts IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_premium_purchases
CREATE TABLE sharika_premium_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  tier TEXT NOT NULL REFERENCES sharika_premium_tiers(tier),
  request_id TEXT NOT NULL,
  price_coins INTEGER NOT NULL CHECK(price_coins>0),
  starts_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')), svip_level INTEGER NOT NULL DEFAULT 1
    CHECK(svip_level BETWEEN 1 AND 8),
  UNIQUE(auth_uid,request_id)
);

-- sharika_premium_tiers
CREATE TABLE sharika_premium_tiers (
  tier TEXT PRIMARY KEY CHECK(tier IN ('vip','svip','noble')),
  rank INTEGER NOT NULL UNIQUE CHECK(rank BETWEEN 1 AND 3),
  min_wealth_level INTEGER NOT NULL CHECK(min_wealth_level BETWEEN 1 AND 500),
  min_gift_coins INTEGER NOT NULL CHECK(min_gift_coins BETWEEN 1 AND 1000000000000),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 365),
  daily_bonus_coins INTEGER NOT NULL CHECK(daily_bonus_coins BETWEEN 0 AND 10000)
);

-- sharika_private_messages
CREATE TABLE sharika_private_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  recipient_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000),
  request_id TEXT NOT NULL UNIQUE CHECK(length(request_id) BETWEEN 12 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(sender_uid <> recipient_uid)
);

-- sharika_profile_layouts
CREATE TABLE sharika_profile_layouts (
  screen TEXT PRIMARY KEY CHECK (screen IN ('main','public')),
  draft_json TEXT NOT NULL,
  published_json TEXT NOT NULL,
  previous_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- sharika_profile_visits
CREATE TABLE sharika_profile_visits (
  visitor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  visited_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  last_seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY(visitor_uid,visited_uid),
  CHECK(visitor_uid<>visited_uid)
);

-- sharika_push_devices
CREATE TABLE sharika_push_devices (
  token TEXT PRIMARY KEY CHECK(length(token) BETWEEN 30 AND 512),
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android' CHECK(platform='android'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_rank_reward_audit
CREATE TABLE sharika_rank_reward_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  old_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_rank_reward_policy
CREATE TABLE sharika_rank_reward_policy (
  kind TEXT PRIMARY KEY CHECK(kind IN ('lucky','rich','charm','room','recharge')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_rank_reward_policy_extra
CREATE TABLE sharika_rank_reward_policy_extra (
  kind TEXT PRIMARY KEY CHECK(kind IN ('noble','games')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_rank_reward_rules
CREATE TABLE sharika_rank_reward_rules (
  kind TEXT NOT NULL REFERENCES sharika_rank_reward_policy(kind),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  entry_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  display_days INTEGER NOT NULL DEFAULT 7 CHECK(display_days BETWEEN 1 AND 30),
  PRIMARY KEY(kind,rank)
);

-- sharika_rank_reward_rules_extra
CREATE TABLE sharika_rank_reward_rules_extra (
  kind TEXT NOT NULL REFERENCES sharika_rank_reward_policy_extra(kind),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND 1000000),
  frame_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  medal_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  entry_item_id TEXT REFERENCES sharika_cosmetics_catalog(id),
  display_days INTEGER NOT NULL DEFAULT 7 CHECK(display_days BETWEEN 1 AND 30),
  PRIMARY KEY(kind,rank)
);

-- sharika_ranking_reward_awards
CREATE TABLE sharika_ranking_reward_awards (
  batch_id INTEGER NOT NULL REFERENCES sharika_ranking_reward_batches(id),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 7),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  score TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins BETWEEN 1 AND 1000000),
  PRIMARY KEY(batch_id,rank),
  UNIQUE(batch_id,user_uid)
);

-- sharika_ranking_reward_batches
CREATE TABLE sharika_ranking_reward_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  policy_id INTEGER NOT NULL REFERENCES sharika_ranking_reward_policies(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  winner_count INTEGER NOT NULL DEFAULT 0 CHECK(winner_count BETWEEN 0 AND 7),
  awarded_coins INTEGER NOT NULL DEFAULT 0 CHECK(awarded_coins>=0),
  issued_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(policy_key,period_start)
);

-- sharika_ranking_reward_control
CREATE TABLE sharika_ranking_reward_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_ranking_reward_policies
CREATE TABLE sharika_ranking_reward_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('sending','recharge','game')),
  period TEXT NOT NULL CHECK(period IN ('daily','weekly','monthly')),
  metric TEXT NOT NULL CHECK(metric IN ('coins','wins','stake','payout')),
  game_code TEXT,
  targets_json TEXT NOT NULL CHECK(json_valid(targets_json)),
  prizes_json TEXT NOT NULL CHECK(json_valid(prizes_json)),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  auto_award INTEGER NOT NULL CHECK(auto_award IN (0,1)),
  effective_from TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind='game' AND metric IN ('wins','stake','payout')) OR
    (kind IN ('sending','recharge') AND metric='coins' AND game_code IS NULL))
);

-- sharika_referrals
CREATE TABLE sharika_referrals (
  referred_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid),
  inviter_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(referred_uid <> inviter_uid)
);

-- sharika_regular_room_rewards
CREATE TABLE sharika_regular_room_rewards (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  reward_hundredths INTEGER NOT NULL CHECK (reward_hundredths > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_role_applications
CREATE TABLE sharika_role_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  requested_role TEXT NOT NULL CHECK(requested_role IN
    ('manager','bd','admin','super','coin_seller')),
  country TEXT NOT NULL CHECK(length(country) BETWEEN 2 AND 60),
  contact TEXT NOT NULL CHECK(length(contact) BETWEEN 5 AND 120),
  experience TEXT NOT NULL CHECK(length(experience) BETWEEN 20 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','shortlisted','rejected')),
  reviewer_uid TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

-- sharika_room_access_lock_audit
CREATE TABLE sharika_room_access_lock_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  locked INTEGER NOT NULL CHECK (locked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_access_locks
CREATE TABLE sharika_room_access_locks (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  changed_by_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_admin_audit
CREATE TABLE sharika_room_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_admins
CREATE TABLE sharika_room_admins (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  granted_by_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id,user_id)
);

-- sharika_room_announcements
CREATE TABLE sharika_room_announcements (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 280),
  updated_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_bans
CREATE TABLE sharika_room_bans (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  banned_until_ms INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id)
);

-- sharika_room_block_audit
CREATE TABLE sharika_room_block_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('block','unblock')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_covers
CREATE TABLE sharika_room_covers (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 120000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 90000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_members
CREATE TABLE sharika_room_members (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  seat_no INTEGER CHECK (seat_no BETWEEN 1 AND 20),
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')), owner_throne_active INTEGER NOT NULL DEFAULT 0
  CHECK (owner_throne_active IN (0,1)),
  PRIMARY KEY(room_id,user_id)
);

-- sharika_room_moderation_audit
CREATE TABLE sharika_room_moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  target_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  action TEXT NOT NULL CHECK(action IN ('mute','unmute','remove_seat','kick')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_theme_catalog
CREATE TABLE sharika_room_theme_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  image_base64 TEXT NOT NULL DEFAULT '',
  image_bytes INTEGER NOT NULL DEFAULT 0 CHECK(image_bytes BETWEEN 0 AND 360000),
  image_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_theme_images
CREATE TABLE sharika_room_theme_images (
  room_id TEXT PRIMARY KEY REFERENCES sharika_rooms(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 600000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 450000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_weekly_accruals
CREATE TABLE sharika_room_weekly_accruals (
  transaction_id INTEGER PRIMARY KEY REFERENCES sharika_gift_transactions(id),
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  week_start_utc TEXT NOT NULL CHECK(length(week_start_utc)=10),
  reward_hundredths INTEGER NOT NULL CHECK(reward_hundredths>0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_room_weekly_payouts
CREATE TABLE sharika_room_weekly_payouts (
  room_id TEXT NOT NULL REFERENCES sharika_rooms(id),
  owner_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  week_start_utc TEXT NOT NULL CHECK(length(week_start_utc)=10),
  earned_hundredths INTEGER NOT NULL CHECK(earned_hundredths>0),
  coins_paid INTEGER NOT NULL CHECK(coins_paid>=0),
  carry_hundredths INTEGER NOT NULL CHECK(carry_hundredths BETWEEN 0 AND 99),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id,owner_uid,week_start_utc)
);

-- sharika_rooms
CREATE TABLE sharika_rooms (
  id TEXT PRIMARY KEY CHECK (length(id) = 8),
  owner_id TEXT NOT NULL UNIQUE REFERENCES sharika_users(auth_uid),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  emoji TEXT NOT NULL DEFAULT '🎙️',
  theme TEXT NOT NULL DEFAULT 'mid',
  seat_count INTEGER NOT NULL DEFAULT 12 CHECK (seat_count BETWEEN 1 AND 20),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, seat_frame_style TEXT NOT NULL DEFAULT 'grad' CHECK (seat_frame_style IN ('grad','gold','neon','sq')), announcement TEXT NOT NULL DEFAULT '' CHECK(length(announcement)<=300));

-- sharika_royal_level_v2_baselines
CREATE TABLE sharika_royal_level_v2_baselines (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  sent_baseline_coins INTEGER NOT NULL CHECK(sent_baseline_coins>=0),
  received_baseline_coins INTEGER NOT NULL CHECK(received_baseline_coins>=0),
  old_wealth_level INTEGER NOT NULL CHECK(old_wealth_level>=1),
  old_charm_level INTEGER NOT NULL CHECK(old_charm_level>=1),
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_special_ids
CREATE TABLE "sharika_special_ids" (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  special_id TEXT NOT NULL UNIQUE
    CHECK(length(special_id) BETWEEN 1 AND 10 AND special_id NOT GLOB '*[^0-9]*'),
  frame TEXT NOT NULL DEFAULT 'neon' CHECK(frame IN ('neon')),
  expires_at TEXT,
  assigned_by TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_support_messages
CREATE TABLE sharika_support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES sharika_users(auth_uid), sender_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid), sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')), body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000), request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 12 AND 80), created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- sharika_svip_levels
CREATE TABLE sharika_svip_levels (
  level INTEGER PRIMARY KEY CHECK(level BETWEEN 1 AND 8),
  price_coins INTEGER NOT NULL CHECK(price_coins BETWEEN 1 AND 1000000000),
  daily_bonus_coins INTEGER NOT NULL CHECK(daily_bonus_coins BETWEEN 0 AND 1000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_user_avatars
CREATE TABLE sharika_user_avatars (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 120000),
  image_bytes INTEGER NOT NULL CHECK (image_bytes BETWEEN 1 AND 90000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sharika_user_cover_images
CREATE TABLE sharika_user_cover_images (
  auth_uid TEXT PRIMARY KEY REFERENCES sharika_users(auth_uid) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK(mime='image/jpeg'),
  image_base64 TEXT NOT NULL CHECK(length(image_base64) BETWEEN 16 AND 120000),
  image_bytes INTEGER NOT NULL CHECK(image_bytes BETWEEN 1 AND 90000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000000),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- sharika_users
CREATE TABLE sharika_users (
  public_no INTEGER PRIMARY KEY CHECK (public_no BETWEEN 10000001 AND 99999999),
  auth_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  birthdate TEXT NOT NULL,
  minor INTEGER NOT NULL CHECK (minor IN (0,1)),
  country TEXT NOT NULL DEFAULT '',
  pic TEXT,
  cover TEXT,
  bio TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  diamonds INTEGER NOT NULL DEFAULT 0 CHECK (diamonds >= 0),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  wealth_level INTEGER NOT NULL DEFAULT 1,
  charm_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, entry_style TEXT NOT NULL DEFAULT ''
  CHECK (entry_style IN (
    '', 'phoenix', 'dragon-queen', 'ice-king', 'castle-flag',
    'lion-queen', 'phoenix-queen', 'tiger-queen'
  )), frame_style TEXT NOT NULL DEFAULT ''
  CHECK (frame_style IN (
    '', 'phoenix-fire', 'ice-wings', 'royal-dragon', 'vip7',
    'royal-gold', 'violet-love', 'ice-admin', 'golden-dragon',
    'ice-dragon', 'violet-phoenix', 'castle-flag',
    'lion-queen', 'phoenix-queen', 'tiger-queen'
  )), medal_style TEXT NOT NULL DEFAULT ''
  CHECK (medal_style IN ('', 'bronze', 'silver', 'gold', 'top-host')), name_tag_style TEXT NOT NULL DEFAULT ''
  CHECK (name_tag_style IN ('', 'legend')));

-- sharika_verified_activity_events
CREATE TABLE sharika_verified_activity_events (
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

-- sharika_wallet_ledger
CREATE TABLE sharika_wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  currency TEXT NOT NULL CHECK (currency IN ('coins','diamonds')),
  delta INTEGER NOT NULL CHECK (delta != 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(auth_uid,currency,request_id)
);

-- ===== INDEX definitions =====
-- idx_invite_usd_earner_status
CREATE INDEX idx_invite_usd_earner_status
  ON sharika_invite_usd_earnings(inviter_uid,status,created_at);

-- idx_invite_withdrawals_user
CREATE INDEX idx_invite_withdrawals_user
  ON sharika_invite_withdrawals(inviter_uid,status,created_at);

-- idx_sharika_daily_checkins_day
CREATE INDEX idx_sharika_daily_checkins_day ON sharika_daily_checkins(utc_day);

-- idx_sharika_daily_task_claims_day
CREATE INDEX idx_sharika_daily_task_claims_day
  ON sharika_daily_task_claims(utc_day);

-- idx_sharika_event_awards_user
CREATE INDEX idx_sharika_event_awards_user ON sharika_event_awards(auth_uid,created_at DESC);

-- idx_sharika_events_dates
CREATE INDEX idx_sharika_events_dates ON sharika_events(status,ends_at);

-- idx_sharika_gift_events_campaign
CREATE INDEX idx_sharika_gift_events_campaign
  ON sharika_gift_events(gift_id,created_at,sender_uid);

-- idx_sharika_gift_transactions_room_time
CREATE INDEX idx_sharika_gift_transactions_room_time
  ON sharika_gift_transactions(room_id, created_at DESC, sender_uid);

-- idx_sharika_greedy_daily_wins
CREATE INDEX idx_sharika_greedy_daily_wins
  ON sharika_greedy_bets(user_uid,settled_at) WHERE status='settled';

-- idx_sharika_invite_usd_coin_conversions_uid
CREATE INDEX idx_sharika_invite_usd_coin_conversions_uid
  ON sharika_invite_usd_coin_conversions(inviter_uid,created_at);

-- idx_sharika_referrals_inviter
CREATE INDEX idx_sharika_referrals_inviter
ON sharika_referrals(inviter_uid,created_at);

-- idx_sharika_role_applications_one_pending
CREATE UNIQUE INDEX idx_sharika_role_applications_one_pending
  ON sharika_role_applications(applicant_uid,requested_role)
  WHERE status='pending';

-- idx_sharika_role_applications_review
CREATE INDEX idx_sharika_role_applications_review
  ON sharika_role_applications(status,created_at DESC);

-- idx_sharika_room_theme_catalog_active
CREATE INDEX idx_sharika_room_theme_catalog_active
  ON sharika_room_theme_catalog(active,sort_order,id);

-- idx_sharika_room_weekly_payout_owner
CREATE INDEX idx_sharika_room_weekly_payout_owner
  ON sharika_room_weekly_payouts(owner_uid,paid_at DESC);

-- idx_sharika_room_weekly_pending
CREATE INDEX idx_sharika_room_weekly_pending
  ON sharika_room_weekly_accruals(week_start_utc,room_id,owner_uid);

-- sharika_account_deletion_recent
CREATE INDEX sharika_account_deletion_recent ON sharika_account_deletion_requests(public_id,contact_email,created_at DESC);

-- sharika_active_cp_bond
CREATE INDEX sharika_active_cp_bond ON sharika_active_cp_slots(bond_id);

-- sharika_admin_coin_adjustments_recipient_time
CREATE INDEX sharika_admin_coin_adjustments_recipient_time
  ON sharika_admin_coin_adjustments(recipient_uid,created_at DESC);

-- sharika_admin_direct_recharges_actor_date
CREATE INDEX sharika_admin_direct_recharges_actor_date
  ON sharika_admin_direct_recharges(actor_uid,created_at DESC);

-- sharika_admin_staff_access_expiry
CREATE INDEX sharika_admin_staff_access_expiry
  ON sharika_admin_staff_accounts(active,expires_at_ms);

-- sharika_agency_activity_date_idx
CREATE INDEX sharika_agency_activity_date_idx
  ON sharika_agency_room_activity(utc_day,user_uid);

-- sharika_agency_earnings_host_idx
CREATE INDEX sharika_agency_earnings_host_idx
  ON sharika_agency_earnings(host_uid,created_at DESC);

-- sharika_agency_earnings_user_idx
CREATE INDEX sharika_agency_earnings_user_idx
  ON sharika_agency_earnings(beneficiary_uid,created_at DESC);

-- sharika_agency_hosts_family_idx
CREATE INDEX sharika_agency_hosts_family_idx
  ON sharika_agency_hosts(family_id,active);

-- sharika_agency_salary_exchanges_user_idx
CREATE INDEX sharika_agency_salary_exchanges_user_idx
  ON sharika_agency_salary_exchanges(auth_uid,created_at DESC);

-- sharika_agency_salary_seller_receipts_idx
CREATE INDEX sharika_agency_salary_seller_receipts_idx
  ON sharika_agency_salary_seller_transfers(seller_uid,id DESC);

-- sharika_agency_salary_seller_sender_idx
CREATE INDEX sharika_agency_salary_seller_sender_idx
  ON sharika_agency_salary_seller_transfers(auth_uid,id DESC);

-- sharika_bond_active_pair
CREATE UNIQUE INDEX sharika_bond_active_pair
  ON sharika_bonds(type,pair_key) WHERE ended_at_ms IS NULL;

-- sharika_bond_gift_event_requests
CREATE UNIQUE INDEX sharika_bond_gift_event_requests
  ON sharika_bond_gift_events(sender_uid,request_id) WHERE request_id IS NOT NULL;

-- sharika_bond_gift_events_rank
CREATE INDEX sharika_bond_gift_events_rank
  ON sharika_bond_gift_events(type,created_at_ms,bond_id);

-- sharika_bond_invites_received
CREATE INDEX sharika_bond_invites_received
  ON sharika_bond_invites(recipient_uid,status,expires_at_ms);

-- sharika_bond_invites_sender_time
CREATE INDEX sharika_bond_invites_sender_time
  ON sharika_bond_invites(sender_uid,created_at_ms DESC);

-- sharika_bond_invites_sent
CREATE INDEX sharika_bond_invites_sent
  ON sharika_bond_invites(sender_uid,status,expires_at_ms);

-- sharika_bonds_member_a
CREATE INDEX sharika_bonds_member_a
  ON sharika_bonds(uid_a,type,ended_at_ms);

-- sharika_bonds_member_b
CREATE INDEX sharika_bonds_member_b
  ON sharika_bonds(uid_b,type,ended_at_ms);

-- sharika_cosmetic_inventory_item
CREATE INDEX sharika_cosmetic_inventory_item ON sharika_cosmetic_inventory(item_id);

-- sharika_cp_reward_member_history
CREATE INDEX sharika_cp_reward_member_history
  ON sharika_cp_reward_member_awards(auth_uid,week_start_ms DESC);

-- sharika_crystal_ledger_user_idx
CREATE INDEX sharika_crystal_ledger_user_idx
  ON sharika_family_crystal_ledger(beneficiary_uid,created_at DESC);

-- sharika_crystal_transfers_seller_idx
CREATE INDEX sharika_crystal_transfers_seller_idx
  ON sharika_family_crystal_transfers(seller_uid,status,created_at DESC);

-- sharika_families_bd_idx
CREATE INDEX sharika_families_bd_idx ON sharika_families(bd_uid,created_at DESC);

-- sharika_family_activity_family_idx
CREATE INDEX sharika_family_activity_family_idx
  ON sharika_family_activity(family_id,id DESC);

-- sharika_family_creation_pending_idx
CREATE INDEX sharika_family_creation_pending_idx
  ON sharika_family_creation_requests(state,created_at DESC);

-- sharika_family_creation_pending_user_unique
CREATE UNIQUE INDEX sharika_family_creation_pending_user_unique
  ON sharika_family_creation_requests(requester_uid) WHERE state='pending';

-- sharika_family_invite_pending_unique
CREATE UNIQUE INDEX sharika_family_invite_pending_unique
  ON sharika_family_invites(family_id,recipient_uid) WHERE state='pending';

-- sharika_family_invite_recipient_idx
CREATE INDEX sharika_family_invite_recipient_idx
  ON sharika_family_invites(recipient_uid,state,created_at DESC);

-- sharika_family_leaves_user_time
CREATE INDEX sharika_family_leaves_user_time
  ON sharika_family_leaves(user_uid,left_at DESC);

-- sharika_family_members_family_idx
CREATE INDEX sharika_family_members_family_idx ON sharika_family_members(family_id);

-- sharika_followers_by_user
CREATE INDEX sharika_followers_by_user
  ON sharika_follows(followed_uid,created_at DESC);

-- sharika_fruit_bets_rank
CREATE INDEX sharika_fruit_bets_rank
  ON sharika_fruit_royale_bets(status,settled_at,payout DESC);

-- sharika_fruit_bets_round
CREATE INDEX sharika_fruit_bets_round
  ON sharika_fruit_royale_bets(round_id,id);

-- sharika_fruit_bets_status
CREATE INDEX sharika_fruit_bets_status
  ON sharika_fruit_royale_bets(status,round_no);

-- sharika_fruit_bets_user
CREATE INDEX sharika_fruit_bets_user
  ON sharika_fruit_royale_bets(user_uid,id DESC);

-- sharika_fruit_round_recent
CREATE INDEX sharika_fruit_round_recent
  ON sharika_fruit_royale_rounds(round_no DESC);

-- sharika_gaddy_bets_unsettled
CREATE INDEX sharika_gaddy_bets_unsettled
 ON sharika_gaddy_bets(status,round_no);

-- sharika_gaddy_bets_user
CREATE INDEX sharika_gaddy_bets_user
 ON sharika_gaddy_bets(user_uid,id DESC);

-- sharika_gaddy_bets_winners
CREATE INDEX sharika_gaddy_bets_winners
 ON sharika_gaddy_bets(round_id,payout DESC);

-- sharika_game_bets_pending
CREATE INDEX sharika_game_bets_pending
  ON sharika_game_bets(user_uid,status,round_no);

-- sharika_game_bets_period_rank
CREATE INDEX sharika_game_bets_period_rank
  ON sharika_game_bets(game,status,settled_at,payout DESC);

-- sharika_game_bets_round_rank
CREATE INDEX sharika_game_bets_round_rank
  ON sharika_game_bets(game,round_no,stake DESC);

-- sharika_game_bets_user_time
CREATE INDEX sharika_game_bets_user_time
  ON sharika_game_bets(user_uid,id DESC);

-- sharika_game_rounds_recent
CREATE INDEX sharika_game_rounds_recent
  ON sharika_game_rounds(game,round_no DESC);

-- sharika_gift_events_receiver_time
CREATE INDEX sharika_gift_events_receiver_time
  ON sharika_gift_events(recipient_uid,id DESC);

-- sharika_gift_events_room_time
CREATE INDEX sharika_gift_events_room_time
  ON sharika_gift_events(room_id,id DESC);

-- sharika_gift_events_sender_premium
CREATE INDEX sharika_gift_events_sender_premium
  ON sharika_gift_events(sender_uid,id DESC);

-- sharika_gift_transactions_sender_time
CREATE INDEX sharika_gift_transactions_sender_time
  ON sharika_gift_transactions(sender_uid,created_at DESC);

-- sharika_global_celebrations_recent
CREATE INDEX sharika_global_celebrations_recent
  ON sharika_global_celebrations(created_at DESC,id DESC);

-- sharika_greedy_pending
CREATE INDEX sharika_greedy_pending ON sharika_greedy_bets(status,round_no,id);

-- sharika_greedy_user
CREATE INDEX sharika_greedy_user ON sharika_greedy_bets(user_uid,round_no DESC,id DESC);

-- sharika_greedy_winners
CREATE INDEX sharika_greedy_winners ON sharika_greedy_bets(round_id,status,payout DESC);

-- sharika_ledger_user_time
CREATE INDEX sharika_ledger_user_time ON sharika_wallet_ledger(auth_uid,created_at DESC);

-- sharika_lucky_box_claims_user_time
CREATE INDEX sharika_lucky_box_claims_user_time
  ON sharika_lucky_box_claims(auth_uid,opened_at_ms DESC);

-- sharika_lucky_gift_outcomes_sender
CREATE INDEX sharika_lucky_gift_outcomes_sender
  ON sharika_lucky_gift_outcomes(sender_uid,created_at DESC);

-- sharika_lucky_room_rewards_room
CREATE INDEX sharika_lucky_room_rewards_room
  ON sharika_lucky_room_rewards(room_id,created_at DESC);

-- sharika_members_user_idx
CREATE INDEX sharika_members_user_idx ON sharika_room_members(user_id);

-- sharika_messages_recipient
CREATE INDEX sharika_messages_recipient
  ON sharika_private_messages(recipient_uid,id DESC);

-- sharika_messages_sender
CREATE INDEX sharika_messages_sender
  ON sharika_private_messages(sender_uid,id DESC);

-- sharika_moderation_room_time
CREATE INDEX sharika_moderation_room_time
  ON sharika_room_moderation_audit(room_id,created_at);

-- sharika_notifications_inbox
CREATE INDEX sharika_notifications_inbox
  ON sharika_notifications(recipient_uid,id DESC);

-- sharika_notifications_unread
CREATE INDEX sharika_notifications_unread
  ON sharika_notifications(recipient_uid,read_at,id DESC);

-- sharika_one_user_per_seat
CREATE UNIQUE INDEX sharika_one_user_per_seat ON sharika_room_members(room_id,seat_no) WHERE seat_no IS NOT NULL;

-- sharika_original_bets_rank
CREATE INDEX sharika_original_bets_rank
  ON sharika_original_game_bets(game,status,settled_at,payout DESC);

-- sharika_original_bets_round
CREATE INDEX sharika_original_bets_round
  ON sharika_original_game_bets(game,round_no,amount DESC);

-- sharika_original_bets_status
CREATE INDEX sharika_original_bets_status
  ON sharika_original_game_bets(status,round_no);

-- sharika_original_bets_user
CREATE INDEX sharika_original_bets_user
  ON sharika_original_game_bets(user_uid,game,id DESC);

-- sharika_original_rounds_recent
CREATE INDEX sharika_original_rounds_recent
  ON sharika_original_game_rounds(game,round_no DESC);

-- sharika_play_billing_user_idx
CREATE INDEX sharika_play_billing_user_idx
  ON sharika_play_billing_purchases(auth_uid,credited_at DESC);

-- sharika_premium_active_svip
CREATE INDEX sharika_premium_active_svip
  ON sharika_premium_memberships(tier,expires_at_ms,svip_level);

-- sharika_premium_expiry
CREATE INDEX sharika_premium_expiry ON sharika_premium_memberships(expires_at_ms);

-- sharika_profile_visits_received
CREATE INDEX sharika_profile_visits_received
  ON sharika_profile_visits(visited_uid,last_seen_at_ms DESC);

-- sharika_push_devices_uid
CREATE INDEX sharika_push_devices_uid
  ON sharika_push_devices(auth_uid,updated_at DESC);

-- sharika_ranking_reward_policy_lookup
CREATE INDEX sharika_ranking_reward_policy_lookup
  ON sharika_ranking_reward_policies(policy_key,effective_from DESC,id DESC);

-- sharika_regular_room_rewards_room
CREATE INDEX sharika_regular_room_rewards_room
  ON sharika_regular_room_rewards(room_id, created_at DESC);

-- sharika_room_access_lock_audit_room_time_idx
CREATE INDEX sharika_room_access_lock_audit_room_time_idx
  ON sharika_room_access_lock_audit(room_id,created_at);

-- sharika_room_admin_audit_room_time_idx
CREATE INDEX sharika_room_admin_audit_room_time_idx
  ON sharika_room_admin_audit(room_id,created_at);

-- sharika_room_admins_user_idx
CREATE INDEX sharika_room_admins_user_idx
  ON sharika_room_admins(user_id);

-- sharika_room_bans_expiry
CREATE INDEX sharika_room_bans_expiry ON sharika_room_bans(banned_until_ms);

-- sharika_room_block_audit_room_time
CREATE INDEX sharika_room_block_audit_room_time
  ON sharika_room_block_audit(room_id,created_at DESC);

-- sharika_seller_stock_mode_time
CREATE INDEX sharika_seller_stock_mode_time
  ON sharika_coin_seller_stock_mode_audit(seller_uid,created_at DESC);

-- sharika_special_ids_expiry_idx
CREATE INDEX sharika_special_ids_expiry_idx ON sharika_special_ids(expires_at);

-- sharika_support_by_user
CREATE INDEX sharika_support_by_user ON sharika_support_messages(user_id,id DESC);

-- sharika_support_rate
CREATE INDEX sharika_support_rate ON sharika_support_messages(sender_uid,sender_role,created_at DESC);

-- sharika_svip_inventory_expiry
CREATE INDEX sharika_svip_inventory_expiry
  ON sharika_cosmetic_inventory(auth_uid,expires_at_ms);

-- sharika_users_status_idx
CREATE INDEX sharika_users_status_idx ON sharika_users(status);

-- sharika_verified_activity_type_period
CREATE INDEX sharika_verified_activity_type_period
  ON sharika_verified_activity_events(event_type,occurred_at);

-- sharika_verified_activity_user_period
CREATE INDEX sharika_verified_activity_user_period
  ON sharika_verified_activity_events(user_uid,event_type,occurred_at);

-- uniq_invite_paid_payment_reference
CREATE UNIQUE INDEX uniq_invite_paid_payment_reference
  ON sharika_invite_withdrawals(payment_reference) WHERE status='paid';

-- uniq_sharika_invite_eligible_device
CREATE UNIQUE INDEX uniq_sharika_invite_eligible_device
  ON sharika_invite_devices(device_digest) WHERE invite_eligible=1;

-- uniq_sharika_manual_receipt
CREATE UNIQUE INDEX uniq_sharika_manual_receipt
  ON sharika_manual_recharge_reviews(lower(payment_method),lower(payment_reference))
  WHERE status='approved';

-- ===== TRIGGER definitions =====
-- Additional verified read-performance indexes from repository migration 0045.
-- They were not present in the staging metadata snapshot.
CREATE INDEX IF NOT EXISTS idx_sharika_rooms_created_at
  ON sharika_rooms(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sharika_room_members_room_joined
  ON sharika_room_members(room_id,joined_at);

-- immutable_sharika_invite_usd_coin_conversions_delete
CREATE TRIGGER immutable_sharika_invite_usd_coin_conversions_delete
BEFORE DELETE ON sharika_invite_usd_coin_conversions BEGIN
  SELECT RAISE(ABORT,'invite_conversion_receipt_immutable');
END;

-- immutable_sharika_invite_usd_coin_conversions_update
CREATE TRIGGER immutable_sharika_invite_usd_coin_conversions_update
BEFORE UPDATE ON sharika_invite_usd_coin_conversions BEGIN
  SELECT RAISE(ABORT,'invite_conversion_receipt_immutable');
END;

-- sharika_admin_coin_adjustments_immutable_delete
CREATE TRIGGER sharika_admin_coin_adjustments_immutable_delete
BEFORE DELETE ON sharika_admin_coin_adjustments
BEGIN SELECT RAISE(ABORT,'admin_coin_adjustment_immutable'); END;

-- sharika_admin_coin_adjustments_immutable_update
CREATE TRIGGER sharika_admin_coin_adjustments_immutable_update
BEFORE UPDATE ON sharika_admin_coin_adjustments
BEGIN SELECT RAISE(ABORT,'admin_coin_adjustment_immutable'); END;

-- sharika_admin_direct_recharge_immutable_delete
CREATE TRIGGER sharika_admin_direct_recharge_immutable_delete
BEFORE DELETE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;

-- sharika_admin_direct_recharge_immutable_update
CREATE TRIGGER sharika_admin_direct_recharge_immutable_update
BEFORE UPDATE ON sharika_admin_direct_recharges
BEGIN SELECT RAISE(ABORT,'admin_recharge_immutable'); END;

-- sharika_agency_earnings_no_delete
CREATE TRIGGER sharika_agency_earnings_no_delete
BEFORE DELETE ON sharika_agency_earnings BEGIN SELECT RAISE(ABORT,'agency_earnings_immutable'); END;

-- sharika_agency_earnings_no_update
CREATE TRIGGER sharika_agency_earnings_no_update
BEFORE UPDATE ON sharika_agency_earnings BEGIN SELECT RAISE(ABORT,'agency_earnings_immutable'); END;

-- sharika_agency_owner_auto_host_create
CREATE TRIGGER sharika_agency_owner_auto_host_create
AFTER INSERT ON sharika_families
WHEN NEW.status='active'
BEGIN
  INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by)
  SELECT NEW.owner_uid,NEW.id,1,NEW.bd_uid
  WHERE EXISTS(SELECT 1 FROM sharika_users
    WHERE auth_uid=NEW.owner_uid AND status='active' AND minor=0)
  ON CONFLICT(host_uid) DO UPDATE SET active=1,updated_at=datetime('now')
    WHERE sharika_agency_hosts.family_id=excluded.family_id;
END;

-- sharika_agency_owner_auto_host_transfer
CREATE TRIGGER sharika_agency_owner_auto_host_transfer
AFTER UPDATE OF owner_uid ON sharika_families
WHEN NEW.status='active' AND NEW.owner_uid<>OLD.owner_uid
BEGIN
  INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by)
  SELECT NEW.owner_uid,NEW.id,1,NEW.bd_uid
  WHERE EXISTS(SELECT 1 FROM sharika_users
    WHERE auth_uid=NEW.owner_uid AND status='active' AND minor=0)
  ON CONFLICT(host_uid) DO UPDATE SET active=1,updated_at=datetime('now')
    WHERE sharika_agency_hosts.family_id=excluded.family_id;
END;

-- sharika_agency_policy_audit_no_delete
CREATE TRIGGER sharika_agency_policy_audit_no_delete
BEFORE DELETE ON sharika_agency_policy_audit BEGIN SELECT RAISE(ABORT,'agency_audit_immutable'); END;

-- sharika_agency_policy_audit_no_update
CREATE TRIGGER sharika_agency_policy_audit_no_update
BEFORE UPDATE ON sharika_agency_policy_audit BEGIN SELECT RAISE(ABORT,'agency_audit_immutable'); END;

-- sharika_agency_salary_exchange_guard
CREATE TRIGGER sharika_agency_salary_exchange_guard
BEFORE INSERT ON sharika_agency_salary_exchanges BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_agency_salary_config c
    JOIN sharika_agency_policy p ON p.key=c.key
    WHERE c.key='standard' AND c.exchange_enabled=1 AND p.active=1
      AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode
  ) THEN RAISE(ABORT,'agency_salary_exchange_disabled_or_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid
      AND u.status='active' AND u.minor=0
  ) THEN RAISE(ABORT,'agency_salary_exchange_ineligible') END;
  SELECT CASE WHEN NEW.salary_units > (
    SELECT COALESCE(SUM(a.amount_units),0)
    FROM sharika_agency_earnings a
    JOIN sharika_agency_salary_config c ON c.key='standard'
    WHERE a.beneficiary_uid=NEW.auth_uid
      AND a.created_at < CASE NEW.settlement_mode
        WHEN 'daily' THEN datetime('now','start of day')
        WHEN 'weekly' THEN datetime('now','weekday 0','-6 days','start of day')
        ELSE datetime('now','start of month') END
      AND (
        SELECT COALESCE(SUM(e.quantity*e.price_coins),0)
        FROM sharika_agency_earnings h
        JOIN sharika_gift_events e ON e.id=h.gift_event_id
        WHERE h.kind='host_salary' AND h.host_uid=a.host_uid
      ) >= c.min_host_target_coins
  ) - (
    SELECT COALESCE(SUM(x.salary_units),0) FROM sharika_agency_salary_exchanges x
    WHERE x.auth_uid=NEW.auth_uid
  ) - (
    SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t
    WHERE t.auth_uid=NEW.auth_uid
  ) THEN RAISE(ABORT,'agency_salary_not_matured_or_insufficient') END;
END;

-- sharika_agency_salary_exchanges_no_delete
CREATE TRIGGER sharika_agency_salary_exchanges_no_delete
BEFORE DELETE ON sharika_agency_salary_exchanges BEGIN
  SELECT RAISE(ABORT,'agency_salary_exchange_immutable');
END;

-- sharika_agency_salary_exchanges_no_update
CREATE TRIGGER sharika_agency_salary_exchanges_no_update
BEFORE UPDATE ON sharika_agency_salary_exchanges BEGIN
  SELECT RAISE(ABORT,'agency_salary_exchange_immutable');
END;

-- sharika_agency_salary_policy_audit_no_delete
CREATE TRIGGER sharika_agency_salary_policy_audit_no_delete
BEFORE DELETE ON sharika_agency_salary_policy_audit BEGIN
  SELECT RAISE(ABORT,'agency_salary_policy_audit_immutable');
END;

-- sharika_agency_salary_policy_audit_no_update
CREATE TRIGGER sharika_agency_salary_policy_audit_no_update
BEFORE UPDATE ON sharika_agency_salary_policy_audit BEGIN
  SELECT RAISE(ABORT,'agency_salary_policy_audit_immutable');
END;

-- sharika_agency_salary_seller_guard
CREATE TRIGGER sharika_agency_salary_seller_guard
BEFORE INSERT ON sharika_agency_salary_seller_transfers BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_agency_salary_config c
    JOIN sharika_agency_policy p ON p.key=c.key
    WHERE c.key='standard' AND c.exchange_enabled=1 AND p.active=1
      AND NEW.policy_version=c.version AND NEW.settlement_mode=p.settlement_mode
  ) THEN RAISE(ABORT,'agency_salary_transfer_disabled_or_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid
      AND u.status='active' AND u.minor=0
  ) THEN RAISE(ABORT,'agency_salary_transfer_ineligible') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sharika_coin_sellers s
    JOIN sharika_users u ON u.auth_uid=s.seller_uid
    WHERE s.seller_uid=NEW.seller_uid AND s.active=1 AND u.status='active'
      AND u.minor=0
      AND s.available_coins BETWEEN 0 AND (1000000000-NEW.credited_coins)
  ) THEN RAISE(ABORT,'agency_salary_seller_unavailable') END;
  SELECT CASE WHEN NEW.salary_units > (
    SELECT COALESCE(SUM(a.amount_units),0)
    FROM sharika_agency_earnings a
    JOIN sharika_agency_salary_config c ON c.key='standard'
    WHERE a.beneficiary_uid=NEW.auth_uid
      AND a.created_at < CASE NEW.settlement_mode
        WHEN 'daily' THEN datetime('now','start of day')
        WHEN 'weekly' THEN datetime('now','weekday 0','-6 days','start of day')
        ELSE datetime('now','start of month') END
      AND (
        SELECT COALESCE(SUM(e.quantity*e.price_coins),0)
        FROM sharika_agency_earnings h
        JOIN sharika_gift_events e ON e.id=h.gift_event_id
        WHERE h.kind='host_salary' AND h.host_uid=a.host_uid
      ) >= c.min_host_target_coins
  ) - (
    SELECT COALESCE(SUM(x.salary_units),0) FROM sharika_agency_salary_exchanges x
    WHERE x.auth_uid=NEW.auth_uid
  ) - (
    SELECT COALESCE(SUM(t.salary_units),0) FROM sharika_agency_salary_seller_transfers t
    WHERE t.auth_uid=NEW.auth_uid
  ) THEN RAISE(ABORT,'agency_salary_not_matured_or_insufficient') END;
END;

-- sharika_agency_salary_seller_no_delete
CREATE TRIGGER sharika_agency_salary_seller_no_delete
BEFORE DELETE ON sharika_agency_salary_seller_transfers BEGIN
  SELECT RAISE(ABORT,'agency_salary_seller_immutable');
END;

-- sharika_agency_salary_seller_no_update
CREATE TRIGGER sharika_agency_salary_seller_no_update
BEFORE UPDATE ON sharika_agency_salary_seller_transfers BEGIN
  SELECT RAISE(ABORT,'agency_salary_seller_immutable');
END;

-- sharika_bond_audit_no_delete
CREATE TRIGGER sharika_bond_audit_no_delete
  BEFORE DELETE ON sharika_bond_audit BEGIN SELECT RAISE(ABORT,'bond_audit_immutable'); END;

-- sharika_bond_audit_no_update
CREATE TRIGGER sharika_bond_audit_no_update
  BEFORE UPDATE ON sharika_bond_audit BEGIN SELECT RAISE(ABORT,'bond_audit_immutable'); END;

-- sharika_bond_gift_event_active
CREATE TRIGGER sharika_bond_gift_event_active
BEFORE INSERT ON sharika_bond_gift_events BEGIN
  SELECT RAISE(ABORT,'bond_no_longer_active') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_bonds b WHERE b.id=NEW.bond_id
      AND b.ended_at_ms IS NULL AND b.type=NEW.type
      AND ((b.uid_a=NEW.sender_uid AND b.uid_b=NEW.recipient_uid)
        OR (b.uid_b=NEW.sender_uid AND b.uid_a=NEW.recipient_uid))
  );
END;

-- sharika_bond_invite_guardrails
CREATE TRIGGER sharika_bond_invite_guardrails
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

-- sharika_cp_reward_batches_no_delete
CREATE TRIGGER sharika_cp_reward_batches_no_delete
BEFORE DELETE ON sharika_cp_reward_batches BEGIN SELECT RAISE(ABORT,'cp_reward_batch_immutable'); END;

-- sharika_cp_reward_batches_no_update
CREATE TRIGGER sharika_cp_reward_batches_no_update
BEFORE UPDATE ON sharika_cp_reward_batches BEGIN SELECT RAISE(ABORT,'cp_reward_batch_immutable'); END;

-- sharika_cp_reward_member_awards_no_delete
CREATE TRIGGER sharika_cp_reward_member_awards_no_delete
BEFORE DELETE ON sharika_cp_reward_member_awards BEGIN SELECT RAISE(ABORT,'cp_reward_receipt_immutable'); END;

-- sharika_cp_reward_member_awards_no_update
CREATE TRIGGER sharika_cp_reward_member_awards_no_update
BEFORE UPDATE ON sharika_cp_reward_member_awards BEGIN SELECT RAISE(ABORT,'cp_reward_receipt_immutable'); END;

-- sharika_cp_reward_winners_no_delete
CREATE TRIGGER sharika_cp_reward_winners_no_delete
BEFORE DELETE ON sharika_cp_reward_winners BEGIN SELECT RAISE(ABORT,'cp_reward_winner_immutable'); END;

-- sharika_cp_reward_winners_no_update
CREATE TRIGGER sharika_cp_reward_winners_no_update
BEFORE UPDATE ON sharika_cp_reward_winners BEGIN SELECT RAISE(ABORT,'cp_reward_winner_immutable'); END;

-- sharika_daily_claim_no_delete
CREATE TRIGGER sharika_daily_claim_no_delete
BEFORE DELETE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;

-- sharika_daily_claim_no_update
CREATE TRIGGER sharika_daily_claim_no_update
BEFORE UPDATE ON sharika_daily_checkins BEGIN SELECT RAISE(ABORT,'immutable daily claim'); END;

-- sharika_daily_config_audit_no_delete
CREATE TRIGGER sharika_daily_config_audit_no_delete
BEFORE DELETE ON sharika_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;

-- sharika_daily_config_audit_no_update
CREATE TRIGGER sharika_daily_config_audit_no_update
BEFORE UPDATE ON sharika_daily_config_audit BEGIN SELECT RAISE(ABORT,'immutable config audit'); END;

-- sharika_daily_task_claim_no_delete
CREATE TRIGGER sharika_daily_task_claim_no_delete
BEFORE DELETE ON sharika_daily_task_claims
BEGIN SELECT RAISE(ABORT,'immutable daily task claim'); END;

-- sharika_daily_task_claim_no_update
CREATE TRIGGER sharika_daily_task_claim_no_update
BEFORE UPDATE ON sharika_daily_task_claims
BEGIN SELECT RAISE(ABORT,'immutable daily task claim'); END;

-- sharika_daily_task_config_audit_no_delete
CREATE TRIGGER sharika_daily_task_config_audit_no_delete
BEFORE DELETE ON sharika_daily_task_config_audit
BEGIN SELECT RAISE(ABORT,'immutable task config audit'); END;

-- sharika_daily_task_config_audit_no_update
CREATE TRIGGER sharika_daily_task_config_audit_no_update
BEFORE UPDATE ON sharika_daily_task_config_audit
BEGIN SELECT RAISE(ABORT,'immutable task config audit'); END;

-- sharika_event_award_guard
CREATE TRIGGER sharika_event_award_guard
BEFORE INSERT ON sharika_event_awards
BEGIN
  SELECT RAISE(ABORT,'event_not_payable') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_events e WHERE e.id=NEW.event_id
      AND e.status='published' AND e.ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NEW.coins>0
      AND NEW.coins=CASE NEW.rank WHEN 1 THEN e.prize_1 WHEN 2 THEN e.prize_2 ELSE e.prize_3 END
  );
  SELECT RAISE(ABORT,'event_recipient_unavailable') WHERE NOT EXISTS(
    SELECT 1 FROM sharika_users u WHERE u.auth_uid=NEW.auth_uid AND u.status='active'
  );
END;

-- sharika_event_award_no_delete
CREATE TRIGGER sharika_event_award_no_delete
BEFORE DELETE ON sharika_event_awards BEGIN SELECT RAISE(ABORT,'event_award_immutable'); END;

-- sharika_event_award_no_update
CREATE TRIGGER sharika_event_award_no_update
BEFORE UPDATE ON sharika_event_awards BEGIN SELECT RAISE(ABORT,'event_award_immutable'); END;

-- sharika_event_lock_after_award
CREATE TRIGGER sharika_event_lock_after_award
BEFORE UPDATE ON sharika_events
WHEN EXISTS(SELECT 1 FROM sharika_event_awards a WHERE a.event_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'awarded_event_locked'); END;

-- sharika_family_activity_immutable_delete
CREATE TRIGGER sharika_family_activity_immutable_delete
BEFORE DELETE ON sharika_family_activity
BEGIN SELECT RAISE(ABORT,'family_activity_immutable'); END;

-- sharika_family_activity_immutable_update
CREATE TRIGGER sharika_family_activity_immutable_update
BEFORE UPDATE ON sharika_family_activity
BEGIN SELECT RAISE(ABORT,'family_activity_immutable'); END;

-- sharika_family_crystal_immutable_delete
CREATE TRIGGER sharika_family_crystal_immutable_delete
BEFORE DELETE ON sharika_family_crystal_ledger BEGIN SELECT RAISE(ABORT,'crystal_ledger_immutable'); END;

-- sharika_family_crystal_immutable_update
CREATE TRIGGER sharika_family_crystal_immutable_update
BEFORE UPDATE ON sharika_family_crystal_ledger BEGIN SELECT RAISE(ABORT,'crystal_ledger_immutable'); END;

-- sharika_family_grants_immutable_delete
CREATE TRIGGER sharika_family_grants_immutable_delete
BEFORE DELETE ON sharika_family_grants BEGIN SELECT RAISE(ABORT,'family_grant_immutable'); END;

-- sharika_family_grants_immutable_update
CREATE TRIGGER sharika_family_grants_immutable_update
BEFORE UPDATE ON sharika_family_grants BEGIN SELECT RAISE(ABORT,'family_grant_immutable'); END;

-- sharika_family_leave_history
CREATE TRIGGER sharika_family_leave_history
AFTER DELETE ON sharika_family_members
BEGIN
  INSERT INTO sharika_family_leaves(user_uid,family_id)
  VALUES(OLD.user_uid,OLD.family_id);
END;

-- sharika_family_leaves_immutable_delete
CREATE TRIGGER sharika_family_leaves_immutable_delete
BEFORE DELETE ON sharika_family_leaves BEGIN SELECT RAISE(ABORT,'leave_history_immutable'); END;

-- sharika_family_leaves_immutable_update
CREATE TRIGGER sharika_family_leaves_immutable_update
BEFORE UPDATE ON sharika_family_leaves BEGIN SELECT RAISE(ABORT,'leave_history_immutable'); END;

-- sharika_family_member_join_guard
CREATE TRIGGER sharika_family_member_join_guard
BEFORE INSERT ON sharika_family_members
BEGIN
  SELECT RAISE(ABORT,'family_join_cooldown')
  WHERE EXISTS (SELECT 1 FROM sharika_family_leaves
    WHERE user_uid=NEW.user_uid AND left_at>datetime('now','-1 day'))
    AND NOT EXISTS (SELECT 1 FROM sharika_family_invites i
      WHERE i.family_id=NEW.family_id AND i.recipient_uid=NEW.user_uid
        AND i.state='pending' AND i.expires_at>datetime('now'));
  SELECT RAISE(ABORT,'family_full')
    WHERE (SELECT COUNT(*) FROM sharika_family_members
      WHERE family_id=NEW.family_id) >=
      (SELECT max_members FROM sharika_family_policy WHERE key='standard');
END;

-- sharika_family_member_role_audit
CREATE TRIGGER sharika_family_member_role_audit
AFTER UPDATE OF role ON sharika_family_members
WHEN OLD.role<>NEW.role AND OLD.role!='leader' AND NEW.role!='leader'
BEGIN
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    SELECT NEW.family_id,f.owner_uid,NEW.user_uid,'member_role',
      json_object('from',OLD.role,'to',NEW.role)
    FROM sharika_families f WHERE f.id=NEW.family_id;
END;

-- sharika_family_owner_transfer_guard
CREATE TRIGGER sharika_family_owner_transfer_guard
BEFORE UPDATE OF owner_uid ON sharika_families
WHEN NEW.owner_uid<>OLD.owner_uid
BEGIN
  SELECT RAISE(ABORT,'family_owner_transfer_invalid')
  WHERE OLD.status!='active'
     OR NOT EXISTS(
       SELECT 1 FROM sharika_family_members m
       WHERE m.family_id=OLD.id AND m.user_uid=OLD.owner_uid AND m.role='leader'
     )
     OR NOT EXISTS(
       SELECT 1 FROM sharika_family_members m
       JOIN sharika_users u ON u.auth_uid=m.user_uid
       WHERE m.family_id=OLD.id AND m.user_uid=NEW.owner_uid AND u.status='active'
     );
END;

-- sharika_family_owner_transfer_roles
CREATE TRIGGER sharika_family_owner_transfer_roles
AFTER UPDATE OF owner_uid ON sharika_families
WHEN NEW.owner_uid<>OLD.owner_uid
BEGIN
  UPDATE sharika_family_members SET role='co_leader'
    WHERE family_id=NEW.id AND user_uid=OLD.owner_uid AND role='leader';
  UPDATE sharika_family_members SET role='leader'
    WHERE family_id=NEW.id AND user_uid=NEW.owner_uid;
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    VALUES(NEW.id,OLD.owner_uid,NEW.owner_uid,'owner_transfer',
      json_object('previous_owner_uid',OLD.owner_uid,'new_owner_uid',NEW.owner_uid));
END;

-- sharika_family_policy_audit_no_delete
CREATE TRIGGER sharika_family_policy_audit_no_delete
BEFORE DELETE ON sharika_family_policy_audit BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;

-- sharika_family_policy_audit_no_update
CREATE TRIGGER sharika_family_policy_audit_no_update
BEFORE UPDATE ON sharika_family_policy_audit BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;

-- sharika_family_reapply_guard
CREATE TRIGGER sharika_family_reapply_guard
BEFORE UPDATE OF state ON sharika_family_join_requests
WHEN OLD.state!='pending' AND NEW.state='pending'
BEGIN
  SELECT RAISE(ABORT,'family_join_cooldown')
  WHERE EXISTS(SELECT 1 FROM sharika_family_leaves
    WHERE user_uid=NEW.applicant_uid AND left_at>datetime('now','-1 day'));
  SELECT RAISE(ABORT,'already_in_family')
  WHERE EXISTS(SELECT 1 FROM sharika_family_members WHERE user_uid=NEW.applicant_uid);
END;

-- sharika_family_request_reopened_audit
CREATE TRIGGER sharika_family_request_reopened_audit
AFTER UPDATE OF state ON sharika_family_join_requests
WHEN OLD.state!='pending' AND NEW.state='pending'
BEGIN
  INSERT INTO sharika_family_activity(family_id,actor_uid,subject_uid,action,details_json)
    VALUES(NEW.family_id,NEW.applicant_uid,NEW.applicant_uid,'request_reopened',
      json_object('previous_state',OLD.state,'request_id',NEW.id));
END;

-- sharika_family_transfer_approved
CREATE TRIGGER sharika_family_transfer_approved
AFTER UPDATE OF status ON sharika_family_crystal_transfers
WHEN NEW.status='approved'
BEGIN
  UPDATE sharika_coin_sellers
    SET available_coins=available_coins+NEW.coins_to_seller,
        updated_at=datetime('now')
    WHERE seller_uid=NEW.seller_uid AND active=1
      AND available_coins<=1000000000-NEW.coins_to_seller;
  SELECT RAISE(ABORT,'seller_stock_limit') WHERE changes()!=1;
  INSERT INTO sharika_family_transfer_audit(transfer_id,admin_uid,action,coins_added)
    VALUES(NEW.id,NEW.approved_by,'approved',NEW.coins_to_seller);
END;

-- sharika_family_transfer_audit_immutable_delete
CREATE TRIGGER sharika_family_transfer_audit_immutable_delete
BEFORE DELETE ON sharika_family_transfer_audit BEGIN SELECT RAISE(ABORT,'transfer_audit_immutable'); END;

-- sharika_family_transfer_audit_immutable_update
CREATE TRIGGER sharika_family_transfer_audit_immutable_update
BEFORE UPDATE ON sharika_family_transfer_audit BEGIN SELECT RAISE(ABORT,'transfer_audit_immutable'); END;

-- sharika_family_transfer_balance_guard
CREATE TRIGGER sharika_family_transfer_balance_guard
BEFORE INSERT ON sharika_family_crystal_transfers
BEGIN
  SELECT RAISE(ABORT,'crystal_insufficient')
  WHERE NEW.crystal_units > (
    SELECT COALESCE(SUM(crystal_units),0) FROM sharika_family_crystal_ledger
      WHERE beneficiary_uid=NEW.sender_uid
  ) - (
    SELECT COALESCE(SUM(crystal_units),0) FROM sharika_family_crystal_transfers
      WHERE sender_uid=NEW.sender_uid AND status IN ('pending','approved')
  );
  SELECT RAISE(ABORT,'seller_not_approved')
  WHERE NOT EXISTS (SELECT 1 FROM sharika_coin_sellers
    WHERE seller_uid=NEW.seller_uid AND active=1);
END;

-- sharika_family_transfer_delete_guard
CREATE TRIGGER sharika_family_transfer_delete_guard
BEFORE DELETE ON sharika_family_crystal_transfers
BEGIN SELECT RAISE(ABORT,'transfer_immutable'); END;

-- sharika_family_transfer_rejected
CREATE TRIGGER sharika_family_transfer_rejected
AFTER UPDATE OF status ON sharika_family_crystal_transfers
WHEN NEW.status='rejected'
BEGIN
  INSERT INTO sharika_family_transfer_audit(transfer_id,admin_uid,action)
    VALUES(NEW.id,NEW.approved_by,'rejected');
END;

-- sharika_family_transfer_update_guard
CREATE TRIGGER sharika_family_transfer_update_guard
BEFORE UPDATE ON sharika_family_crystal_transfers
BEGIN
  SELECT RAISE(ABORT,'invalid_transfer_transition')
  WHERE OLD.status!='pending' OR NEW.status NOT IN ('approved','rejected')
    OR OLD.sender_uid!=NEW.sender_uid OR OLD.seller_uid!=NEW.seller_uid
    OR OLD.crystal_units!=NEW.crystal_units OR OLD.request_id!=NEW.request_id
    OR OLD.created_at!=NEW.created_at OR NEW.approved_by IS NULL
    OR NEW.resolved_at IS NULL
    OR (NEW.status='rejected' AND NEW.coins_to_seller!=0)
    OR (NEW.status='approved' AND NEW.coins_to_seller<1);
END;

-- sharika_fruit_bet_credit
CREATE TRIGGER sharika_fruit_bet_credit
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'fruit_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'fruit_royale_win','fruit:win:'||NEW.id);
END;

-- sharika_fruit_bet_debit
CREATE TRIGGER sharika_fruit_bet_debit
AFTER INSERT ON sharika_fruit_royale_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount
      AND status='active' AND minor=0;
  SELECT RAISE(ABORT,'fruit_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'fruit_royale_bet','fruit:bet:'||NEW.id);
  UPDATE sharika_fruit_royale_pool SET coins=coins+CAST(NEW.amount/20 AS INTEGER)
    WHERE id='main';
END;

-- sharika_fruit_bet_validate
CREATE TRIGGER sharika_fruit_bet_validate
BEFORE INSERT ON sharika_fruit_royale_bets
BEGIN
  SELECT RAISE(ABORT,'fruit_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_fruit_royale_rounds
     WHERE id=NEW.round_id AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'fruit_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_fruit_royale_rounds WHERE id=NEW.round_id)
      <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    OR (SELECT starts_ms FROM sharika_fruit_royale_rounds WHERE id=NEW.round_id)
      > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
  SELECT RAISE(ABORT,'fruit_user_ineligible') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
      AND status='active' AND minor=0);
END;

-- sharika_fruit_history_no_delete
CREATE TRIGGER sharika_fruit_history_no_delete
BEFORE DELETE ON sharika_fruit_royale_bets
BEGIN
  SELECT RAISE(ABORT,'fruit_history_immutable');
END;

-- sharika_fruit_jackpot_reserve
CREATE TRIGGER sharika_fruit_jackpot_reserve
AFTER INSERT ON sharika_fruit_royale_jackpots
BEGIN
  UPDATE sharika_fruit_royale_pool SET coins=coins-NEW.budget
    WHERE id='main' AND coins>=NEW.budget;
  SELECT RAISE(ABORT,'fruit_jackpot_pool_insufficient') WHERE changes()!=1;
END;

-- sharika_fruit_settlement_immutable
CREATE TRIGGER sharika_fruit_settlement_immutable
BEFORE UPDATE ON sharika_fruit_royale_bets
WHEN OLD.status='settled'
BEGIN
  SELECT RAISE(ABORT,'fruit_settlement_immutable');
END;

-- sharika_gaddy_debit
CREATE TRIGGER sharika_gaddy_debit AFTER INSERT ON sharika_gaddy_bets
BEGIN
 UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND status='active' AND minor=0;
 SELECT RAISE(ABORT,'gaddy_insufficient_coins') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',-NEW.amount,
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  'gaddy_game_bet','gaddy:bet:'||NEW.id);
END;

-- sharika_gaddy_payout
CREATE TRIGGER sharika_gaddy_payout AFTER UPDATE OF status ON sharika_gaddy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
 UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
 WHERE auth_uid=NEW.user_uid;
 SELECT RAISE(ABORT,'gaddy_payout_user_missing') WHERE changes()!=1;
 INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
 VALUES(NEW.user_uid,'coins',NEW.payout,
  (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
  'gaddy_game_win','gaddy:win:'||NEW.id);
END;

-- sharika_gaddy_validate
CREATE TRIGGER sharika_gaddy_validate BEFORE INSERT ON sharika_gaddy_bets
BEGIN
 SELECT RAISE(ABORT,'gaddy_round_mismatch') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_gaddy_rounds WHERE id=NEW.round_id AND round_no=NEW.round_no);
 SELECT RAISE(ABORT,'gaddy_betting_closed') WHERE
   (SELECT bet_closes_ms FROM sharika_gaddy_rounds WHERE id=NEW.round_id)
     <=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR
   (SELECT starts_ms FROM sharika_gaddy_rounds WHERE id=NEW.round_id)
     >CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
 SELECT RAISE(ABORT,'gaddy_ineligible') WHERE NOT EXISTS (
   SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0);
END;

-- sharika_game_bet_debit
CREATE TRIGGER sharika_game_bet_debit
AFTER INSERT ON sharika_game_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.stake,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND status='active' AND minor=0 AND coins>=NEW.stake;
  SELECT RAISE(ABORT,'game_insufficient_or_ineligible') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES
    (NEW.user_uid,'coins',-NEW.stake,
     (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
     'game_bet','game:bet:'||NEW.id);
END;

-- sharika_game_bet_payout
CREATE TRIGGER sharika_game_bet_payout
AFTER UPDATE OF status ON sharika_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'game_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES
    (NEW.user_uid,'coins',NEW.payout,
      (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
      'game_win','game:win:'||NEW.id);
END;

-- sharika_game_bet_validate
CREATE TRIGGER sharika_game_bet_validate
BEFORE INSERT ON sharika_game_bets
BEGIN
  SELECT RAISE(ABORT,'game_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_game_rounds WHERE id=NEW.round_id
      AND game=NEW.game AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'game_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_game_rounds WHERE id=NEW.round_id)
      <= CAST(strftime('%s','now') AS INTEGER)*1000;
END;

-- sharika_gift_event_validate
CREATE TRIGGER sharika_gift_event_validate
BEFORE INSERT ON sharika_gift_events
BEGIN
  SELECT RAISE(ABORT,'recipient_not_in_room')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_room_members
      WHERE room_id=NEW.room_id AND user_id=NEW.recipient_uid);
  SELECT RAISE(ABORT,'gift_not_active')
    WHERE NOT EXISTS (SELECT 1 FROM sharika_gifts
      WHERE id=NEW.gift_id AND active=1 AND tab IN (0,1,2));
  SELECT RAISE(ABORT,'lucky_outcome_missing')
    WHERE EXISTS (SELECT 1 FROM sharika_gifts WHERE id=NEW.gift_id AND tab=2)
      AND NOT EXISTS (SELECT 1 FROM sharika_lucky_gift_outcomes
        WHERE transaction_id=NEW.transaction_id AND sender_uid=NEW.sender_uid);
END;

-- sharika_global_celebration_fruit
CREATE TRIGGER sharika_global_celebration_fruit
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('fruit:'||NEW.id,'win',NEW.user_uid,'Fruit Royale',NEW.payout);
END;

-- sharika_global_celebration_gaddy
CREATE TRIGGER sharika_global_celebration_gaddy
AFTER UPDATE OF status ON sharika_gaddy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('gaddy:'||NEW.id,'win',NEW.user_uid,'Sovera Gaddy',NEW.payout);
END;

-- sharika_global_celebration_gift
CREATE TRIGGER sharika_global_celebration_gift
AFTER INSERT ON sharika_gift_events
WHEN NEW.price_coins*NEW.quantity >=
  (SELECT gift_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(
    source_key,kind,sender_uid,recipient_uid,gift_id,quantity,amount_coins)
  VALUES('gift:'||NEW.id,'gift',NEW.sender_uid,NEW.recipient_uid,NEW.gift_id,
    NEW.quantity,NEW.price_coins*NEW.quantity);
END;

-- sharika_global_celebration_greedy
CREATE TRIGGER sharika_global_celebration_greedy
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('greedy:'||NEW.id,'win',NEW.user_uid,'Greedy Wheel',NEW.payout);
END;

-- sharika_global_celebration_original
CREATE TRIGGER sharika_global_celebration_original
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout >=
  (SELECT win_threshold_coins FROM sharika_celebration_settings WHERE id=1)
BEGIN
  INSERT INTO sharika_global_celebrations(source_key,kind,sender_uid,game,amount_coins)
  VALUES('original:'||NEW.id,'win',NEW.user_uid,
    CASE NEW.game WHEN 'sovera-food' THEN 'Sovera Food Wheel'
      WHEN 'night-food' THEN 'Night Food Wheel' ELSE 'Jackpot Fruit' END,NEW.payout);
END;

-- sharika_greedy_bet_debit
CREATE TRIGGER sharika_greedy_bet_debit
AFTER INSERT ON sharika_greedy_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
  WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount AND minor=0 AND status='active';
  SELECT RAISE(ABORT,'greedy_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_wheel_bet','greedy:bet:'||NEW.id);
END;

-- sharika_greedy_bet_payout
CREATE TRIGGER sharika_greedy_bet_payout
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'greedy_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'greedy_wheel_win','greedy:win:'||NEW.id);
END;

-- sharika_greedy_bet_validate
CREATE TRIGGER sharika_greedy_bet_validate
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
  SELECT RAISE(ABORT,'greedy_round_limit') WHERE
    COALESCE((SELECT SUM(amount) FROM sharika_greedy_bets
      WHERE round_id=NEW.round_id AND user_uid=NEW.user_uid),0)+NEW.amount>1000000000;
END;

-- sharika_ledger_no_delete
CREATE TRIGGER sharika_ledger_no_delete BEFORE DELETE ON sharika_wallet_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;

-- sharika_ledger_no_update
CREATE TRIGGER sharika_ledger_no_update BEFORE UPDATE ON sharika_wallet_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;

-- sharika_lucky_recipient_reward_credit
CREATE TRIGGER sharika_lucky_recipient_reward_credit
AFTER INSERT ON sharika_lucky_recipient_rewards
BEGIN
  INSERT INTO sharika_lucky_diamond_accruals
    (recipient_uid, earned_hundredths, credited_diamonds)
  VALUES (NEW.recipient_uid, NEW.earned_hundredths, 0)
  ON CONFLICT(recipient_uid) DO UPDATE SET
    earned_hundredths=earned_hundredths+excluded.earned_hundredths;

  UPDATE sharika_users
    SET diamonds=diamonds+(
      SELECT CAST(a.earned_hundredths/100 AS INTEGER)-a.credited_diamonds
      FROM sharika_lucky_diamond_accruals a WHERE a.recipient_uid=NEW.recipient_uid
    ),updated_at=datetime('now')
    WHERE auth_uid=NEW.recipient_uid AND status='active';

  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  SELECT NEW.recipient_uid,'diamonds',
    CAST(a.earned_hundredths/100 AS INTEGER)-a.credited_diamonds,
    (SELECT u.diamonds FROM sharika_users u WHERE u.auth_uid=NEW.recipient_uid),
    'lucky_gift_received',
    'lucky-recipient:'||NEW.transaction_id||':'||NEW.recipient_uid
  FROM sharika_lucky_diamond_accruals a
  WHERE a.recipient_uid=NEW.recipient_uid
    AND CAST(a.earned_hundredths/100 AS INTEGER)>a.credited_diamonds;

  UPDATE sharika_lucky_diamond_accruals
    SET credited_diamonds=CAST(earned_hundredths/100 AS INTEGER)
    WHERE recipient_uid=NEW.recipient_uid;
END;

-- sharika_lucky_recipient_reward_no_delete
CREATE TRIGGER sharika_lucky_recipient_reward_no_delete
BEFORE DELETE ON sharika_lucky_recipient_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;

-- sharika_lucky_recipient_reward_no_update
CREATE TRIGGER sharika_lucky_recipient_reward_no_update
BEFORE UPDATE ON sharika_lucky_recipient_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;

-- sharika_lucky_recipient_reward_validate
CREATE TRIGGER sharika_lucky_recipient_reward_validate
BEFORE INSERT ON sharika_lucky_recipient_rewards
BEGIN
  SELECT RAISE(ABORT, 'lucky_recipient_invalid_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    JOIN sharika_lucky_gift_outcomes o ON o.transaction_id=t.id
    JOIN sharika_gift_events e ON e.transaction_id=t.id AND e.recipient_uid=NEW.recipient_uid
    JOIN sharika_users u ON u.auth_uid=NEW.recipient_uid
    WHERE t.id=NEW.transaction_id AND g.tab=2
      AND u.status='active'
      AND NEW.earned_hundredths=g.price_coins*t.quantity*5
  );
END;

-- sharika_lucky_room_reward_no_delete
CREATE TRIGGER sharika_lucky_room_reward_no_delete
BEFORE DELETE ON sharika_lucky_room_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;

-- sharika_lucky_room_reward_no_update
CREATE TRIGGER sharika_lucky_room_reward_no_update
BEFORE UPDATE ON sharika_lucky_room_rewards
BEGIN SELECT RAISE(ABORT, 'lucky_reward_immutable'); END;

-- sharika_lucky_room_reward_validate
CREATE TRIGGER sharika_lucky_room_reward_validate
BEFORE INSERT ON sharika_lucky_room_rewards
BEGIN
  SELECT RAISE(ABORT, 'lucky_room_invalid_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    JOIN sharika_lucky_gift_outcomes o ON o.transaction_id=t.id
    WHERE t.id=NEW.transaction_id AND t.room_id=NEW.room_id
      AND g.tab=2 AND NEW.reward_hundredths=t.total_coins
  );
END;

-- sharika_manual_recharge_immutable_delete
CREATE TRIGGER sharika_manual_recharge_immutable_delete
  BEFORE DELETE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;

-- sharika_manual_recharge_immutable_update
CREATE TRIGGER sharika_manual_recharge_immutable_update
  BEFORE UPDATE ON sharika_manual_recharge_reviews
BEGIN SELECT RAISE(ABORT,'immutable_recharge_review'); END;

-- sharika_manual_recharge_valid_request
CREATE TRIGGER sharika_manual_recharge_valid_request
  BEFORE INSERT ON sharika_manual_recharge_reviews
BEGIN
  SELECT RAISE(ABORT,'invalid_recharge_request')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_support_messages m
    WHERE m.id=NEW.support_message_id AND m.user_id=NEW.user_uid
      AND m.sender_role='user' AND m.body LIKE 'Recharge request · %'
  );
END;

-- sharika_original_bet_debit
CREATE TRIGGER sharika_original_bet_debit
AFTER INSERT ON sharika_original_game_bets
BEGIN
  UPDATE sharika_users SET coins=coins-NEW.amount,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid AND coins>=NEW.amount
      AND status='active' AND minor=0;
  SELECT RAISE(ABORT,'original_insufficient_coins') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',-NEW.amount,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'original_game_bet','original:bet:'||NEW.id);
  UPDATE sharika_original_game_pools
    SET coins=coins+CAST(NEW.amount/20 AS INTEGER)
    WHERE game='jackpot-fruit' AND NEW.game='jackpot-fruit';
END;

-- sharika_original_bet_payout
CREATE TRIGGER sharika_original_bet_payout
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled' AND NEW.payout>0
BEGIN
  UPDATE sharika_users SET coins=coins+NEW.payout,updated_at=datetime('now')
    WHERE auth_uid=NEW.user_uid;
  SELECT RAISE(ABORT,'original_payout_user_missing') WHERE changes()!=1;
  INSERT INTO sharika_wallet_ledger
    (auth_uid,currency,delta,balance_after,reason,request_id)
  VALUES(NEW.user_uid,'coins',NEW.payout,
    (SELECT coins FROM sharika_users WHERE auth_uid=NEW.user_uid),
    'original_game_win','original:win:'||NEW.id);
END;

-- sharika_original_bet_validate
CREATE TRIGGER sharika_original_bet_validate
BEFORE INSERT ON sharika_original_game_bets
BEGIN
  SELECT RAISE(ABORT,'original_round_mismatch') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_original_game_rounds
      WHERE id=NEW.round_id AND game=NEW.game AND round_no=NEW.round_no);
  SELECT RAISE(ABORT,'original_betting_closed') WHERE
    (SELECT bet_closes_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      <= CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR
    (SELECT starts_ms FROM sharika_original_game_rounds WHERE id=NEW.round_id)
      > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
  SELECT RAISE(ABORT,'original_invalid_pick') WHERE
    (NEW.game!='night-food' AND NEW.pick_index>7);
  SELECT RAISE(ABORT,'original_user_ineligible') WHERE NOT EXISTS
    (SELECT 1 FROM sharika_users WHERE auth_uid=NEW.user_uid
      AND status='active' AND minor=0);
END;

-- sharika_original_jackpot_reserve
CREATE TRIGGER sharika_original_jackpot_reserve
AFTER INSERT ON sharika_original_jackpot_budgets
BEGIN
  UPDATE sharika_original_game_pools
    SET coins=coins-NEW.budget
    WHERE game='jackpot-fruit' AND coins>=NEW.budget;
  SELECT RAISE(ABORT,'original_jackpot_pool_insufficient') WHERE changes()!=1;
END;

-- sharika_play_billing_no_delete
CREATE TRIGGER sharika_play_billing_no_delete
BEFORE DELETE ON sharika_play_billing_purchases BEGIN
  SELECT RAISE(ABORT,'play_purchase_immutable');
END;

-- sharika_play_billing_no_update
CREATE TRIGGER sharika_play_billing_no_update
BEFORE UPDATE ON sharika_play_billing_purchases BEGIN
  SELECT RAISE(ABORT,'play_purchase_immutable');
END;

-- sharika_premium_audit_immutable_delete
CREATE TRIGGER sharika_premium_audit_immutable_delete
BEFORE DELETE ON sharika_premium_audit BEGIN SELECT RAISE(ABORT,'premium_audit_immutable'); END;

-- sharika_premium_audit_immutable_update
CREATE TRIGGER sharika_premium_audit_immutable_update
BEFORE UPDATE ON sharika_premium_audit BEGIN SELECT RAISE(ABORT,'premium_audit_immutable'); END;

-- sharika_ranking_award_no_delete
CREATE TRIGGER sharika_ranking_award_no_delete
BEFORE DELETE ON sharika_ranking_reward_awards
BEGIN SELECT RAISE(ABORT,'ranking_award_immutable'); END;

-- sharika_ranking_award_no_update
CREATE TRIGGER sharika_ranking_award_no_update
BEFORE UPDATE ON sharika_ranking_reward_awards
BEGIN SELECT RAISE(ABORT,'ranking_award_immutable'); END;

-- sharika_ranking_batch_no_delete
CREATE TRIGGER sharika_ranking_batch_no_delete
BEFORE DELETE ON sharika_ranking_reward_batches
BEGIN SELECT RAISE(ABORT,'ranking_batch_immutable'); END;

-- sharika_ranking_batch_no_update
CREATE TRIGGER sharika_ranking_batch_no_update
BEFORE UPDATE ON sharika_ranking_reward_batches
BEGIN SELECT RAISE(ABORT,'ranking_batch_immutable'); END;

-- sharika_ranking_batch_paused_guard
CREATE TRIGGER sharika_ranking_batch_paused_guard
BEFORE INSERT ON sharika_ranking_reward_batches
WHEN (SELECT paused FROM sharika_ranking_reward_control WHERE id=1)!=0
BEGIN SELECT RAISE(ABORT,'ranking_rewards_paused'); END;

-- sharika_ranking_policy_no_delete
CREATE TRIGGER sharika_ranking_policy_no_delete
BEFORE DELETE ON sharika_ranking_reward_policies
BEGIN SELECT RAISE(ABORT,'ranking_policy_immutable'); END;

-- sharika_ranking_policy_no_update
CREATE TRIGGER sharika_ranking_policy_no_update
BEFORE UPDATE ON sharika_ranking_reward_policies
BEGIN SELECT RAISE(ABORT,'ranking_policy_immutable'); END;

-- sharika_referrals_no_delete
CREATE TRIGGER sharika_referrals_no_delete
BEFORE DELETE ON sharika_referrals BEGIN SELECT RAISE(ABORT,'immutable referral'); END;

-- sharika_referrals_no_update
CREATE TRIGGER sharika_referrals_no_update
BEFORE UPDATE ON sharika_referrals BEGIN SELECT RAISE(ABORT,'immutable referral'); END;

-- sharika_regular_room_reward_no_delete
CREATE TRIGGER sharika_regular_room_reward_no_delete
BEFORE DELETE ON sharika_regular_room_rewards
BEGIN SELECT RAISE(ABORT,'room_reward_immutable'); END;

-- sharika_regular_room_reward_no_update
CREATE TRIGGER sharika_regular_room_reward_no_update
BEFORE UPDATE ON sharika_regular_room_rewards
BEGIN SELECT RAISE(ABORT,'room_reward_immutable'); END;

-- sharika_regular_room_reward_validate
CREATE TRIGGER sharika_regular_room_reward_validate
BEFORE INSERT ON sharika_regular_room_rewards
BEGIN
  SELECT RAISE(ABORT,'invalid_regular_room_reward')
  WHERE NOT EXISTS (
    SELECT 1 FROM sharika_gift_transactions t
    JOIN sharika_gifts g ON g.id=t.gift_id
    WHERE t.id=NEW.transaction_id AND t.room_id=NEW.room_id
      AND g.tab IN (0,1)
      AND NEW.reward_hundredths=t.total_coins*10
  );
END;

-- sharika_seller_allocation_no_delete
CREATE TRIGGER sharika_seller_allocation_no_delete
BEFORE DELETE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;

-- sharika_seller_allocation_no_update
CREATE TRIGGER sharika_seller_allocation_no_update
BEFORE UPDATE ON sharika_coin_seller_allocations BEGIN SELECT RAISE(ABORT,'immutable seller allocation'); END;

-- sharika_seller_audit_no_delete
CREATE TRIGGER sharika_seller_audit_no_delete
BEFORE DELETE ON sharika_coin_seller_admin_audit BEGIN SELECT RAISE(ABORT,'immutable seller audit'); END;

-- sharika_seller_audit_no_update
CREATE TRIGGER sharika_seller_audit_no_update
BEFORE UPDATE ON sharika_coin_seller_admin_audit BEGIN SELECT RAISE(ABORT,'immutable seller audit'); END;

-- sharika_seller_stock_mode_no_delete
CREATE TRIGGER sharika_seller_stock_mode_no_delete
  BEFORE DELETE ON sharika_coin_seller_stock_mode_audit
  BEGIN SELECT RAISE(ABORT,'immutable seller stock mode'); END;

-- sharika_seller_stock_mode_no_update
CREATE TRIGGER sharika_seller_stock_mode_no_update
  BEFORE UPDATE ON sharika_coin_seller_stock_mode_audit
  BEGIN SELECT RAISE(ABORT,'immutable seller stock mode'); END;

-- sharika_seller_transfer_no_delete
CREATE TRIGGER sharika_seller_transfer_no_delete
BEFORE DELETE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;

-- sharika_seller_transfer_no_update
CREATE TRIGGER sharika_seller_transfer_no_update
BEFORE UPDATE ON sharika_coin_seller_transfers BEGIN SELECT RAISE(ABORT,'immutable seller transfer'); END;

-- sharika_special_no_public_insert
CREATE TRIGGER sharika_special_no_public_insert
BEFORE INSERT ON sharika_special_ids
WHEN length(NEW.special_id)=8 AND EXISTS (
  SELECT 1 FROM sharika_users
  WHERE public_no=CAST(NEW.special_id AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'special_id_conflicts_with_account_id');
END;

-- sharika_special_no_public_update
CREATE TRIGGER sharika_special_no_public_update
BEFORE UPDATE OF special_id ON sharika_special_ids
WHEN length(NEW.special_id)=8 AND EXISTS (
  SELECT 1 FROM sharika_users
  WHERE public_no=CAST(NEW.special_id AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'special_id_conflicts_with_account_id');
END;

-- sharika_staff_direct_recharge_limit
CREATE TRIGGER sharika_staff_direct_recharge_limit
BEFORE INSERT ON sharika_admin_direct_recharges
WHEN EXISTS(SELECT 1 FROM sharika_admin_staff_accounts WHERE auth_uid=NEW.actor_uid)
BEGIN
  SELECT RAISE(ABORT,'staff_recharge_disabled')
    WHERE NOT EXISTS(
      SELECT 1 FROM sharika_admin_staff_accounts s
      WHERE s.auth_uid=NEW.actor_uid AND s.active=1
        AND (s.expires_at_ms IS NULL OR
          s.expires_at_ms>CAST(unixepoch('now') AS INTEGER)*1000)
        AND EXISTS(SELECT 1 FROM json_each(s.permissions_json)
                   WHERE value='coin_recharge')
    );
  SELECT RAISE(ABORT,'staff_daily_limit_exceeded')
    WHERE NEW.coins + COALESCE((
      SELECT SUM(x.coins) FROM sharika_admin_direct_recharges x
      WHERE x.actor_uid=NEW.actor_uid
        AND x.created_at>=date('now') AND x.created_at<datetime(date('now'),'+1 day')
    ),0) > (
      SELECT daily_coin_limit FROM sharika_admin_staff_accounts WHERE auth_uid=NEW.actor_uid
    );
END;

-- sharika_user_no_reserved_special
CREATE TRIGGER sharika_user_no_reserved_special
BEFORE INSERT ON sharika_users
WHEN EXISTS (
  SELECT 1 FROM sharika_special_ids
  WHERE length(special_id)=8 AND
    CAST(special_id AS INTEGER)=NEW.public_no
)
BEGIN
  SELECT RAISE(ABORT,'public_id_reserved_as_special');
END;

-- sharika_verified_activity_fruit_game
CREATE TRIGGER sharika_verified_activity_fruit_game
AFTER UPDATE OF status ON sharika_fruit_royale_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:fruit:'||NEW.id,'game_settled',NEW.user_uid,
    'fruit-royale',NEW.amount,NEW.payout,NEW.settled_at);
END;

-- sharika_verified_activity_gaddy_game
CREATE TRIGGER sharika_verified_activity_gaddy_game
AFTER UPDATE OF status ON sharika_gaddy_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:gaddy:'||NEW.id,'game_settled',NEW.user_uid,
    'sovera-gaddy',NEW.amount,NEW.payout,NEW.settled_at);
END;

-- sharika_verified_activity_gift
CREATE TRIGGER sharika_verified_activity_gift
AFTER INSERT ON sharika_gift_transactions
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,scope_id,amount_coins,occurred_at)
  VALUES('gift:'||NEW.id,'gift_sent',NEW.sender_uid,NEW.room_id,
    NEW.total_coins,NEW.created_at);
END;

-- sharika_verified_activity_greedy_game
CREATE TRIGGER sharika_verified_activity_greedy_game
AFTER UPDATE OF status ON sharika_greedy_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:greedy:'||NEW.id,'game_settled',NEW.user_uid,
    'greedy-wheel',NEW.amount,NEW.payout,NEW.settled_at);
END;

-- sharika_verified_activity_legacy_game
CREATE TRIGGER sharika_verified_activity_legacy_game
AFTER UPDATE OF status ON sharika_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:legacy:'||NEW.id,'game_settled',NEW.user_uid,
    NEW.game,NEW.stake,NEW.payout,NEW.settled_at);
END;

-- sharika_verified_activity_no_delete
CREATE TRIGGER sharika_verified_activity_no_delete
BEFORE DELETE ON sharika_verified_activity_events
BEGIN SELECT RAISE(ABORT,'verified_activity_immutable'); END;

-- sharika_verified_activity_no_update
CREATE TRIGGER sharika_verified_activity_no_update
BEFORE UPDATE ON sharika_verified_activity_events
BEGIN SELECT RAISE(ABORT,'verified_activity_immutable'); END;

-- sharika_verified_activity_original_game
CREATE TRIGGER sharika_verified_activity_original_game
AFTER UPDATE OF status ON sharika_original_game_bets
WHEN OLD.status='accepted' AND NEW.status='settled'
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,game_code,amount_coins,payout_coins,occurred_at)
  VALUES('game:original:'||NEW.id,'game_settled',NEW.user_uid,
    NEW.game,NEW.amount,NEW.payout,NEW.settled_at);
END;

-- sharika_verified_activity_recharge
CREATE TRIGGER sharika_verified_activity_recharge
AFTER INSERT ON sharika_wallet_ledger
WHEN NEW.currency='coins' AND NEW.delta>0
  AND NEW.reason IN ('manual_recharge','seller_recharge')
BEGIN
  INSERT OR IGNORE INTO sharika_verified_activity_events
    (source_ref,event_type,user_uid,amount_coins,occurred_at)
  VALUES('recharge:'||NEW.id,'recharge_approved',NEW.auth_uid,
    NEW.delta,NEW.created_at);
END;

-- ===== Additional code-required Play Billing schema =====
-- Not present in staging; present in the current repository's 0066 migration.
CREATE TABLE IF NOT EXISTS sharika_google_play_purchases (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_uid TEXT NOT NULL REFERENCES sharika_users(auth_uid),
  product_id TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK(coins>0),
  order_id TEXT NOT NULL UNIQUE,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sharika_google_play_user_time
  ON sharika_google_play_purchases(user_uid,created_at DESC);
