"""Salary exchange OR direct Coin Seller stock transfer: never spend Salary twice.

All writes use an isolated in-memory SQLite database, never staging wallets.
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "migrations"
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for name in (
    "0001_initial.sql", "0004_gift_transactions.sql", "0009_coin_sellers.sql",
    "0023_admin_exchange_rate.sql", "0048_family_bd_crystal.sql",
    "0049_family_membership_management.sql", "0059_agency_host_earnings.sql",
    "0064_agency_salary_targets_exchange.sql", "0073_agency_salary_seller_transfer.sql",
):
    db.executescript((ROOT / name).read_text())

for no, uid in enumerate(("sender", "host", "owner", "bd", "seller", "young"), 10000400):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',?,1000)", (no, uid, uid, int(uid == "young"))
    )
db.execute("INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) VALUES('bd',1,1,'owner')")
db.execute("INSERT INTO sharika_families(name,owner_uid,bd_uid) VALUES('Agency','owner','bd')")
db.execute("INSERT INTO sharika_agency_hosts(host_uid,family_id,assigned_by) VALUES('host',1,'owner')")
db.execute("INSERT INTO sharika_coin_sellers(seller_uid,active,available_coins) VALUES('seller',1,1000)")
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('12345678','owner','Room')")
db.execute("INSERT INTO sharika_room_members(room_id,user_id,role) VALUES('12345678','owner','owner')")
for uid in ("sender", "host"):
    db.execute("INSERT INTO sharika_room_members(room_id,user_id) VALUES('12345678',?)", (uid,))
db.execute("INSERT INTO sharika_gifts(id,name,price_coins,active) VALUES(1,'Salary Gift',5000000,1)")
db.execute(
    "INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,"
    "recipient_ids_json,total_coins,request_id) "
    "VALUES('sender','12345678',1,1,'[\"host\"]',5000000,'salary-seller-gift-1')"
)
db.execute(
    "INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,recipient_uid,gift_id,quantity,price_coins) "
    "VALUES(1,'12345678','sender','host',1,1,5000000)"
)
for kind, beneficiary, rate in (("host_salary", "host", 4000), ("agency", "owner", 1000), ("bd", "bd", 500)):
    db.execute(
        "INSERT INTO sharika_agency_earnings(gift_event_id,family_id,host_uid,"
        "beneficiary_uid,kind,rate_bps,amount_units,created_at) "
        "VALUES(1,1,'host',?,?,?,?,datetime('now','-2 days'))",
        (beneficiary, kind, rate, 5000000*rate),
    )
db.execute("UPDATE sharika_agency_policy SET settlement_mode='daily'")


def seller_transfer(uid, coins, key):
    """Mirror Worker D1.batch as a rollback-safe SQLite savepoint."""
    db.execute("SAVEPOINT salary_to_seller")
    try:
        db.execute(
            "INSERT INTO sharika_agency_salary_seller_transfers("
            "auth_uid,seller_uid,request_id,salary_units,credited_coins,"
            "settlement_mode,policy_version) VALUES("
            "?, 'seller', ?, ?, ?, 'daily', 1)",
            (uid, key, coins*10000, coins),
        )
        db.execute(
            "UPDATE sharika_coin_sellers SET available_coins="
            "CASE WHEN active=1 AND available_coins<=? THEN available_coins+? ELSE -1 END "
            "WHERE seller_uid='seller'", (1000000000-coins, coins)
        )
        db.execute("RELEASE salary_to_seller")
    except sqlite3.IntegrityError:
        db.execute("ROLLBACK TO salary_to_seller")
        db.execute("RELEASE salary_to_seller")
        raise

def exchange(uid, coins, key):
    db.execute(
        "INSERT INTO sharika_agency_salary_exchanges(auth_uid,request_id,salary_units,"
        "credited_coins,settlement_mode,policy_version) VALUES(?,?,?,?,?,1)",
        (uid, key, coins*10000, coins, "daily"),
    )

try:
    seller_transfer("host", 500000, "seller-disabled-request")
    raise AssertionError("seller transfer must be disabled until Super Admin enables it")
except sqlite3.IntegrityError as e:
    assert "agency_salary_transfer_disabled_or_changed" in str(e)
assert db.execute("SELECT available_coins FROM sharika_coin_sellers").fetchone() == (1000,)

db.execute("UPDATE sharika_agency_salary_config SET exchange_enabled=1")
seller_transfer("host", 500000, "salary-to-seller-0001")
assert db.execute("SELECT available_coins FROM sharika_coin_sellers").fetchone() == (501000,)
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='host'").fetchone() == (1000,)
assert db.execute(
    "SELECT salary_units,credited_coins FROM sharika_agency_salary_seller_transfers"
).fetchone() == (500000*10000, 500000)

exchange("host", 1500000, "remaining-to-main-0002")
assert db.execute("SELECT SUM(credited_coins) FROM sharika_agency_salary_exchanges").fetchone() == (1500000,)
try:
    seller_transfer("host", 1, "salary-double-transfer")
    raise AssertionError("A seller transfer cannot reuse already-exchanged salary")
except sqlite3.IntegrityError as e:
    assert "agency_salary_not_matured_or_insufficient" in str(e)
try:
    exchange("host", 1, "salary-double-exchange")
    raise AssertionError("An exchange cannot reuse salary sent to seller")
except sqlite3.IntegrityError as e:
    assert "agency_salary_not_matured_or_insufficient" in str(e)
try:
    seller_transfer("host", 500000, "salary-to-seller-0001")
    raise AssertionError("Retry with same request must not double credit seller")
except sqlite3.IntegrityError:
    pass
assert db.execute("SELECT available_coins FROM sharika_coin_sellers").fetchone() == (501000,)

db.execute("UPDATE sharika_coin_sellers SET active=0 WHERE seller_uid='seller'")
try:
    seller_transfer("owner", 1000, "seller-inactive-request")
    raise AssertionError("Disabled sellers may not receive salary")
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE sharika_coin_sellers SET active=1 WHERE seller_uid='seller'")
db.execute("UPDATE sharika_agency_salary_config SET exchange_enabled=0")
try:
    seller_transfer("owner", 1000, "policy-disabled-request")
    raise AssertionError("Super Admin can disable both Salary settlement paths")
except sqlite3.IntegrityError:
    pass
try:
    db.execute("UPDATE sharika_agency_salary_seller_transfers SET credited_coins=1")
    raise AssertionError("Seller transfer history is immutable")
except sqlite3.IntegrityError as e:
    assert "agency_salary_seller_immutable" in str(e)
assert db.execute("SELECT COUNT(*) FROM sharika_agency_salary_seller_transfers").fetchone() == (1,)
print("Salary -> Seller SQL: shared settlement permission, atomic seller stock, "
      "no main-wallet debit, exchange/transfer shared balance, replay guard and immutable history")
