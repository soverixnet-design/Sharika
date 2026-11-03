import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for name in ("0001_initial.sql", "0004_gift_transactions.sql",
             "0009_coin_sellers.sql", "0048_family_bd_crystal.sql"):
    db.executescript((root / "migrations" / name).read_text())

for n, uid in enumerate(("sender", "owner", "bd", "seller"), start=10000001):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins)"
        " VALUES(?,?,?,'1990-01-01',0,10000)", (n, uid, uid))
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('12345678','owner','Royal')")
db.execute("INSERT INTO sharika_room_members(room_id,user_id,role)"
           " VALUES('12345678','owner','owner')")
db.execute("INSERT INTO sharika_room_members(room_id,user_id)"
           " VALUES('12345678','sender')")
db.execute("INSERT INTO sharika_gifts(id,name,price_coins,active)"
           " VALUES(1,'Rose',100,1)")
db.execute("INSERT INTO sharika_coin_sellers(seller_uid,active,available_coins)"
           " VALUES('seller',1,100)")
db.execute("INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by)"
           " VALUES('bd',1,1,'owner')")
db.execute("INSERT INTO sharika_families(name,owner_uid,bd_uid)"
           " VALUES('Royal Test','owner','bd')")
for uid, role in (("owner", "leader"), ("sender", "member")):
    db.execute("INSERT INTO sharika_family_members(family_id,user_uid,role)"
               " VALUES(1,?,?)", (uid, role))
db.execute("INSERT INTO sharika_gift_transactions("
           "sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id)"
           " VALUES('sender','12345678',1,1,'[]',100,'gift-test-12345')")
db.execute("INSERT INTO sharika_gift_events("
           "transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins)"
           " VALUES(1,'12345678','sender','owner',1,1,100)")
for kind, beneficiary, bps in (("bd", "bd", 500), ("family_owner", "owner", 1000)):
    db.execute("INSERT INTO sharika_family_crystal_ledger("
               "gift_event_id,family_id,beneficiary_uid,kind,rate_bps,crystal_units)"
               " VALUES(1,1,?,?,?,?)", (beneficiary, kind, bps, 100*bps))
assert db.execute("SELECT kind,crystal_units FROM sharika_family_crystal_ledger"
                  " ORDER BY kind").fetchall() == [
    ("bd", 50000), ("family_owner", 100000)]

db.execute("INSERT INTO sharika_family_crystal_transfers("
           "sender_uid,seller_uid,crystal_units,request_id)"
           " VALUES('owner','seller',100000,'transfer-test-123')")
db.execute("UPDATE sharika_family_crystal_transfers SET status='approved',"
           "coins_to_seller=10,approved_by='bd',resolved_at=datetime('now')"
           " WHERE id=1 AND status='pending'")
for _ in range(2):
    assert db.execute("SELECT available_coins FROM sharika_coin_sellers"
                      " WHERE seller_uid='seller'").fetchone() == (110,)
    db.execute("UPDATE sharika_family_crystal_transfers SET status='approved',"
               "coins_to_seller=10,approved_by='bd',resolved_at=datetime('now')"
               " WHERE id=1 AND status='pending'")
assert db.execute("SELECT COUNT(*) FROM sharika_family_transfer_audit"
                  " WHERE action='approved'").fetchone() == (1,)
try:
    db.execute("INSERT INTO sharika_family_crystal_transfers("
               "sender_uid,seller_uid,crystal_units,request_id)"
               " VALUES('owner','seller',100000,'transfer-overdraft-123')")
    raise AssertionError("Transfer overdraft should be rejected")
except sqlite3.IntegrityError as error:
    assert "crystal_insufficient" in str(error)

print("Family migration and Crystal ledger guards OK")
