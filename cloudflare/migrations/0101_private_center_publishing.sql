-- Private Center staging rollout. All new modules fail closed (published=0).
-- Do not run blindly against production. Existing game rounds, event status,
-- wallet tables and user records are not changed.
CREATE TABLE IF NOT EXISTS sharika_center_publishing (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 2 AND 80),
 kind TEXT NOT NULL CHECK(kind IN ('game','ranking','event','module')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 100),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sharika_center_visible
 ON sharika_center_publishing(kind,published,sort_order);
CREATE TABLE IF NOT EXISTS sharika_center_odds_drafts (
 game_id TEXT PRIMARY KEY,
 win_rate_basis_points INTEGER NOT NULL CHECK(win_rate_basis_points BETWEEN 0 AND 10000),
 target_rtp_basis_points INTEGER NOT NULL CHECK(target_rtp_basis_points BETWEEN 0 AND 10000),
 status TEXT NOT NULL DEFAULT 'pending_engine_adapter' CHECK(status='pending_engine_adapter'),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
 changed_by TEXT NOT NULL,
 changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sharika_center_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_uid TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('visibility_update','odds_draft_update')),
 target TEXT NOT NULL,
 details_json TEXT NOT NULL CHECK(json_valid(details_json)),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('sovera-food','game','Sovera Food Wheel',0,1);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('night-food','game','Night Food Wheel',0,2);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('jackpot-fruit','game','Fruit Jackpot',0,3);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('greedy-wheel','game','Greedy Wheel',0,4);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('food-wheel','game','Food Wheel',0,5);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('fruit-royale','game','Fruit Royale',0,6);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('sovera-gaddy','game','Sovera Gaddy',0,7);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('cleopatra','game','Cleopatra Gold Deluxe',0,8);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('food-deluxe','game','Food Wheel Deluxe',0,9);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('greedy-classic','game','Greedy Classic',0,10);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('royal-ace','game','Royal Ace Deluxe',0,11);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('royal-slots','game','Royal Slots',0,12);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('rich','ranking','Rich Ranking',0,1);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('charm','ranking','Charm Ranking',0,2);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('room','ranking','Room Ranking',0,3);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('cp','ranking','CP Ranking',0,4);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('agency','ranking','Agency Ranking',0,5);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('bd','ranking','BD Ranking',0,6);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('host','ranking','Host Ranking',0,7);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('gift','ranking','Gift Ranking',0,8);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('weekly','ranking','Weekly Champion',0,9);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order) VALUES('event','ranking','Event Ranking',0,10);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order)
 VALUES('events','module','Event Center',0,1);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order)
 VALUES('wallet','module','Wallet Center',0,2);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order)
 VALUES('gifts','module','Gift Center',0,3);
INSERT OR IGNORE INTO sharika_center_publishing(id,kind,title,published,sort_order)
 VALUES('assets','module','Royal Assets',0,4);
-- Each existing event is a separate item; use a separate explicit publication
-- rather than automatically exposing new event rows.
