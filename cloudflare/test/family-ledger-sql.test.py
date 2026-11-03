import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for name in ("0001_initial.sql", "0004_gift_transactions.sql",
             "0009_coin_sellers.sql", "0048_family_bd_crystal.sql",
             "0049_family_membership_management.sql"):
    db.executescript((root / "migrations" / name).read_text())

for n, uid in enumerate(("sender", "owner", "bd", "seller", "successor",
                         "applicant", "outsider"), start=10000001):
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
for uid, role in (("owner", "leader"), ("sender", "member"),
                  ("successor", "member")):
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


# Ownership cannot be transferred to outsiders. An accepted successor receives
# leader role atomically, original BD grant/history remains unchanged.
db.execute("INSERT INTO sharika_family_grants(family_id,bd_uid,owner_uid,request_id)"
           " VALUES(1,'bd','owner','bd-grant-test-123')")
try:
    db.execute("UPDATE sharika_families SET owner_uid='outsider' WHERE id=1")
    raise AssertionError("Only existing members may become owner")
except sqlite3.IntegrityError as error:
    assert "family_owner_transfer_invalid" in str(error)
db.execute("UPDATE sharika_families SET owner_uid='successor' WHERE id=1")
assert db.execute("SELECT owner_uid FROM sharika_families WHERE id=1").fetchone() == (
    "successor",)
assert db.execute("SELECT user_uid,role FROM sharika_family_members"
                  " WHERE family_id=1 AND user_uid IN ('owner','successor')"
                  " ORDER BY user_uid").fetchall() == [
    ("owner", "co_leader"), ("successor", "leader")]
assert db.execute("SELECT owner_uid FROM sharika_family_grants"
                  " WHERE family_id=1").fetchone() == ("owner",)
assert db.execute("SELECT action,actor_uid,subject_uid FROM sharika_family_activity"
                  " WHERE action='owner_transfer'").fetchall() == [
    ("owner_transfer", "owner", "successor")]

# Promotions and removals are recorded. Exit cooldown still applies.
db.execute("UPDATE sharika_family_members SET role='elder'"
           " WHERE family_id=1 AND user_uid='sender'")
assert db.execute("SELECT action FROM sharika_family_activity"
                  " WHERE subject_uid='sender'").fetchall() == [("member_role",)]
db.execute("DELETE FROM sharika_family_members WHERE user_uid='sender'")
try:
    db.execute("INSERT INTO sharika_family_members(family_id,user_uid,role)"
               " VALUES(1,'sender','member')")
    raise AssertionError("24-hour leave cooldown should be enforced")
except sqlite3.IntegrityError as error:
    assert "family_join_cooldown" in str(error)

# A rejection is not permanent; reopening is audited. Reapplication after
# a recent Family exit is refused.
db.execute("INSERT INTO sharika_family_join_requests(family_id,applicant_uid)"
           " VALUES(1,'applicant')")
db.execute("UPDATE sharika_family_join_requests SET state='rejected',"
           "reviewed_at=datetime('now') WHERE applicant_uid='applicant'")
db.execute("UPDATE sharika_family_join_requests SET state='pending',"
           "reviewed_at=NULL WHERE applicant_uid='applicant'")
assert db.execute("SELECT action FROM sharika_family_activity"
                  " WHERE subject_uid='applicant'").fetchall() == [("request_reopened",)]
db.execute("INSERT INTO sharika_family_leaves(user_uid,family_id)"
           " VALUES('outsider',1)")
db.execute("INSERT INTO sharika_family_join_requests(family_id,applicant_uid,state)"
           " VALUES(1,'outsider','rejected')")
try:
    db.execute("UPDATE sharika_family_join_requests SET state='pending'"
               " WHERE applicant_uid='outsider'")
    raise AssertionError("Recent exit should prevent request reopening")
except sqlite3.IntegrityError as error:
    assert "family_join_cooldown" in str(error)

try:
    db.execute("DELETE FROM sharika_family_activity WHERE action='owner_transfer'")
    raise AssertionError("Family activity must be immutable")
except sqlite3.IntegrityError as error:
    assert "family_activity_immutable" in str(error)

print("Family migration, management guards and Crystal ledger OK")
