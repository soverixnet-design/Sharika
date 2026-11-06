"""Salary exchanges reuse the live Agency gift ledger without double accrual."""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = (
    "0001_initial.sql", "0004_gift_transactions.sql", "0009_coin_sellers.sql",
    "0023_admin_exchange_rate.sql", "0048_family_bd_crystal.sql",
    "0049_family_membership_management.sql", "0059_agency_host_earnings.sql",
)


def database(custom_rate=False):
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for name in BASE:
        db.executescript((ROOT / "migrations" / name).read_text())
    if custom_rate:
        db.execute("UPDATE sharika_exchange_rate SET coins_per_unit=85,revision=3")
    db.executescript((ROOT / "migrations" / "0064_agency_salary_targets_exchange.sql").read_text())
    db.executescript((ROOT / "migrations" / "0070_agency_salary_seller_virtual.sql").read_text())
    return db


db = database()
assert db.execute("SELECT coins_per_unit,revision FROM sharika_exchange_rate").fetchone() == (30, 3)
assert db.execute("SELECT coins_per_usd,min_host_target_coins,exchange_enabled FROM sharika_agency_salary_config").fetchone() == (500000, 5000000, 0)
assert [row[0] for row in db.execute("SELECT target_coins FROM sharika_agency_salary_targets ORDER BY target_coins")] == [5000000, 10000000, 20000000, 50000000, 100000000]
assert database(custom_rate=True).execute("SELECT coins_per_unit,revision FROM sharika_exchange_rate").fetchone() == (85, 3)

for no, uid in enumerate(("sender", "host", "owner", "bd", "young", "seller"), start=10000048):
    db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
               "VALUES(?,?,?,'1990-01-01',?,1000)", (no, uid, uid, int(uid == "young")))
db.execute("INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) "
           "VALUES('bd',1,1,'owner')")
db.execute("INSERT INTO sharika_coin_sellers(seller_uid,active,available_coins) "
           "VALUES('seller',1,0)")
db.execute("INSERT INTO sharika_families(name,owner_uid,bd_uid) VALUES('Royal Agency','owner','bd')")
db.execute("INSERT INTO sharika_agency_hosts(host_uid,family_id,assigned_by) VALUES('host',1,'owner')")
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('12345678','owner','Royal')")
db.execute("INSERT INTO sharika_room_members(room_id,user_id,role) "
           "VALUES('12345678','owner','owner')")
for uid in ('sender','host'):
    db.execute("INSERT INTO sharika_room_members(room_id,user_id) VALUES('12345678',?)", (uid,))
db.execute("INSERT INTO sharika_gifts(id,name,price_coins,active) VALUES(1,'Crown',5000000,1)")
db.execute("INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) "
           "VALUES('sender','12345678',1,1,'[\"host\"]',5000000,'gift-salary-123456')")
db.execute("INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins) "
           "VALUES(1,'12345678','sender','host',1,1,5000000)")
for kind, uid, rate in (("host_salary", "host", 4000), ("agency", "owner", 1000), ("bd", "bd", 500)):
    db.execute("INSERT INTO sharika_agency_earnings(gift_event_id,family_id,host_uid,beneficiary_uid,kind,rate_bps,amount_units,created_at) "
               "VALUES(1,1,'host',?,?,?,?,datetime('now','-2 days'))", (uid, kind, rate, 5000000*rate))
db.commit()  # Keep fixture rows across intentionally rejected atomic seller batches.


def exchange(uid, coins, key):
    db.execute("INSERT INTO sharika_agency_salary_exchanges(auth_uid,request_id,salary_units,credited_coins,settlement_mode,policy_version) "
               "VALUES(?,?,?,?,?,?)", (uid, key, coins*10000, coins, "daily", 1))


def seller_transfer(uid, coins, key):
    # Replicate the production D1 batch's atomic receipt + seller-stock credit.
    with db:
        db.execute("INSERT INTO sharika_agency_salary_seller_transfers("
                   "auth_uid,seller_uid,request_id,salary_units,credited_coins,"
                   "settlement_mode,policy_version) VALUES(?,?,?,?,?,?,?)",
                   (uid, "seller", key, coins*10000, coins, "daily", 1))
        db.execute("UPDATE sharika_coin_sellers SET available_coins=available_coins+? "
                   "WHERE seller_uid='seller'", (coins,))


try:
    exchange("host", 2000000, "salary-disabled-123456")
    raise AssertionError("Admin permission must start disabled")
except sqlite3.IntegrityError as error:
    assert "agency_salary_exchange_disabled_or_changed" in str(error)
try:
    seller_transfer("host", 1, "seller-disabled-123456")
    raise AssertionError("Seller salary transfers must also start disabled")
except sqlite3.IntegrityError as error:
    assert "agency_salary_transfer_disabled_or_changed" in str(error)

db.execute("UPDATE sharika_agency_policy SET settlement_mode='daily'")
db.execute("UPDATE sharika_agency_salary_config SET exchange_enabled=1")
seller_transfer("host", 500000, "seller-verified-123456")
exchange("host", 1500000, "salary-eligible-123456")
exchange("owner", 500000, "salary-owner-123456")
exchange("bd", 250000, "salary-bd-123456")
db.commit()
assert db.execute("SELECT SUM(credited_coins) FROM sharika_agency_salary_exchanges").fetchone()[0] == 2250000
assert db.execute("SELECT SUM(credited_coins) FROM sharika_agency_salary_seller_transfers").fetchone()[0] == 500000
assert db.execute("SELECT available_coins FROM sharika_coin_sellers WHERE seller_uid='seller'").fetchone()[0] == 500000
try:
    seller_transfer("host", 1, "seller-overdraft-123456")
    raise AssertionError("Seller transfer must not spend already exchanged salary")
except sqlite3.IntegrityError as error:
    assert "agency_salary_not_matured_or_insufficient" in str(error)
try:
    seller_transfer("host", 500000, "seller-verified-123456")
    raise AssertionError("Idempotent seller request IDs cannot mint a second receipt")
except sqlite3.IntegrityError:
    pass
assert db.execute("SELECT available_coins FROM sharika_coin_sellers WHERE seller_uid='seller'").fetchone()[0] == 500000
try:
    db.execute("DELETE FROM sharika_agency_salary_seller_transfers WHERE id=1")
    raise AssertionError("Seller transfer receipts must remain immutable")
except sqlite3.IntegrityError as error:
    assert "agency_salary_seller_immutable" in str(error)
for uid, coins in (("host", 1), ("owner", 1), ("bd", 1)):
    try:
        exchange(uid, coins, "salary-replay-123456")
        raise AssertionError("Cannot exchange the same salary twice: " + uid)
    except sqlite3.IntegrityError as error:
        assert "agency_salary_not_matured_or_insufficient" in str(error)
try:
    db.execute("UPDATE sharika_agency_salary_exchanges SET credited_coins=1 WHERE id=1")
    raise AssertionError("Salary receipts must be immutable")
except sqlite3.IntegrityError as error:
    assert "agency_salary_exchange_immutable" in str(error)

db.execute("UPDATE sharika_agency_salary_config SET version=2,min_host_target_coins=6000000")
try:
    exchange("young", 1, "salary-minor-123456")
    raise AssertionError("Minor accounts never exchange")
except sqlite3.IntegrityError:
    pass
print("Agency salary SQL: 5M target, 40/10/5, maturity, atomic virtual seller stock, immutable and no double spending")
