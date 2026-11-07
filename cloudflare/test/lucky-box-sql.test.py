"""Additive Lucky Box migration and cooldown/entitlement regression checks."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,coins INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE sharika_rooms(id TEXT PRIMARY KEY,owner_id TEXT);
CREATE TABLE sharika_cosmetics_catalog(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,art_key TEXT NOT NULL,active INTEGER NOT NULL);
CREATE TABLE sharika_cosmetic_inventory(auth_uid TEXT,item_id TEXT,source TEXT,request_id TEXT,expires_at_ms INTEGER,PRIMARY KEY(auth_uid,item_id),UNIQUE(auth_uid,request_id));
CREATE TABLE sharika_wallet_ledger(id INTEGER PRIMARY KEY,auth_uid TEXT,currency TEXT,delta INTEGER,balance_after INTEGER,reason TEXT,request_id TEXT,UNIQUE(auth_uid,currency,request_id));
CREATE TABLE sharika_admin_audit(actor_id TEXT,action TEXT,details_json TEXT);
INSERT INTO sharika_users(auth_uid,coins) VALUES('alice',0);
INSERT INTO sharika_rooms(id,owner_id) VALUES('10000001','alice');
INSERT INTO sharika_cosmetics_catalog(id,kind,name,art_key,active) VALUES
('frame_style:royal-gold','frame_style','Royal Gold','royal-gold',1),
('entry_style:phoenix','entry_style','Phoenix','phoenix',1),
('frame_style:role-frame-01','frame_style','Staff','role-frame-01',1);
""")
db.executescript((root / "migrations/0056_free_lucky_box_and_room_announcement.sql").read_text())
settings=db.execute("SELECT coin_reward,coin_weight,frame_weight,entry_weight,empty_weight FROM sharika_lucky_box_settings").fetchone()
assert settings==(200,40,25,15,20)
pool={row[0] for row in db.execute("SELECT item_id FROM sharika_lucky_box_pool")}
assert pool=={'frame_style:royal-gold','entry_style:phoenix'}
db.execute("UPDATE sharika_rooms SET announcement=? WHERE id=?",("Welcome everyone!",'10000001'))
assert db.execute("SELECT announcement FROM sharika_rooms WHERE id='10000001'").fetchone()[0]=="Welcome everyone!"

def reserve(request_id,now):
    db.execute("INSERT OR IGNORE INTO sharika_lucky_box_state(auth_uid,next_open_at_ms,last_request_id) VALUES('alice',0,'')")
    changed=db.execute("UPDATE sharika_lucky_box_state SET next_open_at_ms=?,last_request_id=? WHERE auth_uid='alice' AND next_open_at_ms<=?",
      (now+7_200_000,request_id,now)).rowcount
    if changed:
        db.execute("INSERT INTO sharika_lucky_box_claims(request_id,auth_uid,outcome,coins_awarded,opened_at_ms) VALUES(?,'alice','coins',200,?)",
          (request_id,now))
        db.execute("UPDATE sharika_users SET coins=coins+200 WHERE auth_uid='alice'")
        db.execute("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) VALUES('alice','coins',200,(SELECT coins FROM sharika_users WHERE auth_uid='alice'),'lucky_box',?)",
          ('lucky-box:'+request_id,))
    db.commit()
    return changed

assert reserve('box-first-123456',1_000_000)==1
assert reserve('box-early-123456',1_000_001)==0
assert reserve('box-later-123456',8_200_000)==1
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='alice'").fetchone()[0]==400
assert db.execute("SELECT COUNT(*) FROM sharika_wallet_ledger").fetchone()[0]==2

db.execute("INSERT INTO sharika_cosmetic_inventory VALUES('alice','frame_style:royal-gold','admin_grant','lucky-box:one',?)",(9_000_000,))
db.execute("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id,expires_at_ms) "+
 "VALUES('alice','frame_style:royal-gold','purchase','purchase:one',NULL) "+
 "ON CONFLICT(auth_uid,item_id) DO UPDATE SET source='purchase',request_id=excluded.request_id,expires_at_ms=NULL "+
 "WHERE sharika_cosmetic_inventory.expires_at_ms IS NOT NULL")
assert db.execute("SELECT source,expires_at_ms FROM sharika_cosmetic_inventory").fetchone()==('purchase',None)
print("Lucky Box migration, 2-hour cooldown, ledger and permanent-upgrade checks passed")
