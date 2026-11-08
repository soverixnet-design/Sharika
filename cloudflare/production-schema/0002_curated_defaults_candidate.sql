-- SHARIKA PRODUCTION SAFE STATIC DEFAULTS CANDIDATE (NOT DEPLOYED)
-- Reproduced from 81 SQL migration files in an empty local SQLite database.
-- No live staging records or user data are included.
-- Excludes Family policies, 148 cosmetics catalog entries, and 21 Lucky Box
-- prize references that require missing cosmetics/media. Lucky Box is disabled
-- until its catalog and R2 assets pass a separate release check.
-- Proposed host target display tiers: 1M / 2.5M / 5M / 10M; salary gate stays 5M.
-- WARNING: financial/game policies and media still require release approval.
-- This file is NOT in the configured production migrations directory.

-- sharika_agency_policy: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_agency_policy" ("key","active","host_bps","agency_bps","bd_bps","settlement_mode","updated_by","updated_at") VALUES ('standard',1,4000,1000,500,'weekly',NULL,datetime('now'));

-- sharika_agency_salary_config: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_agency_salary_config" ("key","coins_per_usd","min_host_target_coins","exchange_enabled","version","updated_by","updated_at") VALUES ('standard',500000,5000000,0,1,NULL,datetime('now'));

-- sharika_agency_salary_targets: 4 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_agency_salary_targets" ("target_coins","active","updated_at") VALUES (1000000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_agency_salary_targets" ("target_coins","active","updated_at") VALUES (2500000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_agency_salary_targets" ("target_coins","active","updated_at") VALUES (5000000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_agency_salary_targets" ("target_coins","active","updated_at") VALUES (10000000,1,datetime('now'));

-- sharika_bond_gifts: 4 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_bond_gifts" ("id","type","name","emoji","price_coins","active","sort_order") VALUES (1,'cp','Rose Promise','💝',5200,1,1);
INSERT OR IGNORE INTO "sharika_bond_gifts" ("id","type","name","emoji","price_coins","active","sort_order") VALUES (2,'cp','Royal Wedding','💍',18800,1,2);
INSERT OR IGNORE INTO "sharika_bond_gifts" ("id","type","name","emoji","price_coins","active","sort_order") VALUES (3,'friendship','Blue Promise','💙',1200,1,3);
INSERT OR IGNORE INTO "sharika_bond_gifts" ("id","type","name","emoji","price_coins","active","sort_order") VALUES (4,'friendship','Forever Friends','🤝',5200,1,4);

-- sharika_bond_policy: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_bond_policy" ("key","cp_enabled","friendship_enabled","expiry_hours","updated_by","updated_at") VALUES ('standard',1,1,24,NULL,datetime('now'));

-- sharika_cp_reward_policy: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_cp_reward_policy" ("key","enabled","auto_award","auto_start_week_ms","updated_by","updated_at") VALUES ('weekly',0,0,0,NULL,datetime('now'));

-- sharika_cp_reward_rules: 7 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (1,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (2,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (3,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (4,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (5,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (6,0,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_cp_reward_rules" ("rank","coins_each","frame_item_id","medal_item_id","updated_at") VALUES (7,0,NULL,NULL,datetime('now'));

-- sharika_daily_reward_config: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_daily_reward_config" ("key","day1","day2","day3","day4","day5","day6","day7","updated_by","updated_at") VALUES ('standard',100,150,200,300,400,600,1000,NULL,datetime('now'));

-- sharika_daily_task_config: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_daily_task_config" ("key","follow_coins","gift_coins","updated_by","updated_at") VALUES ('standard',50,100,NULL,datetime('now'));

-- sharika_exchange_rate: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_exchange_rate" ("id","diamonds_per_unit","coins_per_unit","revision","updated_by","updated_at") VALUES (1,100,30,3,NULL,datetime('now'));

-- sharika_fruit_royale_pool: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_fruit_royale_pool" ("id","coins") VALUES ('main',0);

-- sharika_gaddy_config: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_gaddy_config" ("id","weights_json","multipliers_json","updated_at") VALUES (1,'[20,36,60,90,180,180,180,180,37,37]','[45,25,15,10,5,5,5,5,2,2]',datetime('now'));

-- sharika_game_catalog: 7 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('sovera-food',1,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('night-food',1,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('jackpot-fruit',0,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('greedy-wheel',1,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('food-wheel',1,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('fruit-royale',1,datetime('now'));
INSERT OR IGNORE INTO "sharika_game_catalog" ("id","enabled","updated_at") VALUES ('sovera-gaddy',1,datetime('now'));

-- sharika_invite_reward_rules: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_invite_reward_rules" ("id","inviter_coins","invitee_coins","invite_usd_cents","inviter_recharge_percent","first_recharge_percent","recharge_coins_per_usd","withdrawal_option_1_cents","withdrawal_option_2_cents","claim_window_hours","version","updated_by","updated_at") VALUES (1,100000,100000,10,5,40,500000,5000,10000,48,1,NULL,datetime('now'));

-- sharika_lucky_box_settings: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_lucky_box_settings" ("id","enabled","coin_reward","coin_weight","frame_weight","entry_weight","empty_weight","updated_at") VALUES (1,0,200,40,25,15,20,datetime('now'));

-- sharika_opening_settings: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_opening_settings" ("id","enabled","mode","duration_seconds","custom_user_id","custom_title","custom_subtitle","custom_image_url","version","updated_at") VALUES (1,1,'automatic',10,'','','','',1,datetime('now'));

-- sharika_original_game_pools: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_original_game_pools" ("game","coins") VALUES ('jackpot-fruit',0);

-- sharika_premium_policy: 1 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_premium_policy" ("key","purchase_enabled","admin_grant_enabled","auto_enabled","auto_by_level","auto_by_gifts","updated_by","updated_at") VALUES ('standard',1,1,1,1,1,NULL,datetime('now'));

-- sharika_premium_tiers: 3 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_premium_tiers" ("tier","rank","min_wealth_level","min_gift_coins","price_coins","duration_days","daily_bonus_coins") VALUES ('vip',1,10,10000,10000,30,100);
INSERT OR IGNORE INTO "sharika_premium_tiers" ("tier","rank","min_wealth_level","min_gift_coins","price_coins","duration_days","daily_bonus_coins") VALUES ('svip',2,25,100000,50000,30,300);
INSERT OR IGNORE INTO "sharika_premium_tiers" ("tier","rank","min_wealth_level","min_gift_coins","price_coins","duration_days","daily_bonus_coins") VALUES ('noble',3,50,1000000,200000,30,1000);

-- sharika_rank_reward_policy: 5 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_rank_reward_policy" ("kind","enabled","revision","updated_by","updated_at") VALUES ('lucky',0,0,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_rank_reward_policy" ("kind","enabled","revision","updated_by","updated_at") VALUES ('rich',0,0,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_rank_reward_policy" ("kind","enabled","revision","updated_by","updated_at") VALUES ('charm',0,0,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_rank_reward_policy" ("kind","enabled","revision","updated_by","updated_at") VALUES ('room',0,0,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_rank_reward_policy" ("kind","enabled","revision","updated_by","updated_at") VALUES ('recharge',0,0,NULL,datetime('now'));

-- sharika_rank_reward_policy_extra: 2 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_rank_reward_policy_extra" ("kind","enabled","revision","updated_by","updated_at") VALUES ('noble',0,0,NULL,datetime('now'));
INSERT OR IGNORE INTO "sharika_rank_reward_policy_extra" ("kind","enabled","revision","updated_by","updated_at") VALUES ('games',0,0,NULL,datetime('now'));

-- sharika_rank_reward_rules: 35 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('lucky',7,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('rich',7,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('charm',7,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('room',7,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('recharge',7,0,NULL,NULL,NULL,7);

-- sharika_rank_reward_rules_extra: 14 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('noble',7,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',1,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',2,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',3,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',4,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',5,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',6,0,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO "sharika_rank_reward_rules_extra" ("kind","rank","coins","frame_item_id","medal_item_id","entry_item_id","display_days") VALUES ('games',7,0,NULL,NULL,NULL,7);

-- sharika_svip_levels: 8 reviewed-reference row(s)
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (1,1000000,1000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (2,2000000,2000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (3,3000000,3000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (4,4000000,4000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (5,5000000,5000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (6,6000000,6000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (7,7000000,7000,1,datetime('now'));
INSERT OR IGNORE INTO "sharika_svip_levels" ("level","price_coins","daily_bonus_coins","enabled","updated_at") VALUES (8,8000000,8000,1,datetime('now'));
