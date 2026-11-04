"""Verify additive Agency/BD/Host D1 schema and exact fixed-point earnings."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for name in (
    "0001_initial.sql", "0004_gift_transactions.sql",
    "0009_coin_sellers.sql", "0023_admin_exchange_rate.sql",
    "0048_family_bd_crystal.sql", "0049_family_membership_management.sql",
    "0059_agency_host_earnings.sql",
):
    db.executescript((root / "migrations" / name).read_text())

assert db.execute(
    "SELECT diamonds_per_unit,coins_per_unit,revision FROM sharika_exchange_rate"
).fetchone() == (100, 40, 2)
assert db.execute(
    "SELECT host_bps,agency_bps,bd_bps FROM sharika_agency_policy"
).fetchone() == (4000, 1000, 500)

for no, uid in enumerate(("sender", "host", "owner", "bd"), start=10000048):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',0,1000)", (no, uid, uid)
    )
db.execute("INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) "
           "VALUES('bd',1,1,'owner')")
db.execute("INSERT INTO sharika_families(name,owner_uid,bd_uid) "
           "VALUES('Royal Star','owner','bd')")
for uid, role in (("owner", "leader"), ("host", "member")):
    db.execute("INSERT INTO sharika_family_members(family_id,user_uid,role) "
               "VALUES(1,?,?)", (uid, role))
db.execute("INSERT INTO sharika_agency_hosts(host_uid,family_id,assigned_by) "
           "VALUES('host',1,'owner')")
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) "
           "VALUES('12345678','owner','Royal')")
db.execute("INSERT INTO sharika_room_members(room_id,user_id,role) "
           "VALUES('12345678','owner','owner')")
for uid in ("sender", "host"):
    db.execute("INSERT INTO sharika_room_members(room_id,user_id) "
               "VALUES('12345678',?)", (uid,))
db.execute("INSERT INTO sharika_gifts(id,name,price_coins,active) "
           "VALUES(1,'Crown',100,1)")
db.execute("INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,"
           "recipient_ids_json,total_coins,request_id) "
           "VALUES('sender','12345678',1,1,'[\"host\"]',100,'gift-agency-123456')")
db.execute("INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,"
           "recipient_uid,gift_id,quantity,price_coins) "
           "VALUES(1,'12345678','sender','host',1,1,100)")

for kind, uid, bps in (("host_salary", "host", 4000),
                       ("agency", "owner", 1000), ("bd", "bd", 500)):
    db.execute("INSERT INTO sharika_agency_earnings(gift_event_id,family_id,"
               "host_uid,beneficiary_uid,kind,rate_bps,amount_units) "
               "VALUES(1,1,'host',?,?,?,?)", (uid, kind, bps, 100*bps))
assert db.execute("SELECT kind,amount_units FROM sharika_agency_earnings "
                  "ORDER BY kind").fetchall() == [
                      ("agency", 100000), ("bd", 50000), ("host_salary", 400000)]

# Pending earnings must never touch existing wallet coins or diamonds.
assert db.execute("SELECT coins,diamonds FROM sharika_users WHERE auth_uid='host'")\
    .fetchone() == (1000, 0)
try:
    db.execute("UPDATE sharika_agency_earnings SET amount_units=1 WHERE id=1")
    raise AssertionError("Pending earnings should be immutable")
except sqlite3.IntegrityError as error:
    assert "agency_earnings_immutable" in str(error)
try:
    db.execute("INSERT INTO sharika_agency_earnings(gift_event_id,family_id,"
               "host_uid,beneficiary_uid,kind,rate_bps,amount_units) "
               "VALUES(1,1,'host','host','host_salary',4000,400000)")
    raise AssertionError("Duplicate salary accrual must be rejected")
except sqlite3.IntegrityError as error:
    assert "UNIQUE" in str(error)

# Existing custom exchange rates are preserved by the exact migration guard.
db.execute("UPDATE sharika_exchange_rate SET coins_per_unit=85,revision=3")
db.execute("UPDATE sharika_exchange_rate SET diamonds_per_unit=100,"
           "coins_per_unit=40,revision=revision+1 WHERE id=1 AND "
           "diamonds_per_unit=100 AND coins_per_unit=70 AND revision=1")
assert db.execute("SELECT coins_per_unit,revision FROM sharika_exchange_rate")\
    .fetchone() == (85, 3)
print("Agency/BD/Host SQL: 40/10/5 pending ledger, replay, immutability, exchange policy verified")
