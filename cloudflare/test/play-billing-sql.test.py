"""Google Play receipt bookkeeping is additive and cannot double-credit coins."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1] / "migrations"
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for file_name in ("0001_initial.sql", "0066_google_play_verified_coins.sql"):
    db.executescript((ROOT / file_name).read_text())
db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
           "VALUES(10000001,'buyer','Buyer','1990-01-01',0,12000)")
db.commit()


def grant(token_hash, order, coins):
    """Exact three-statement atomic sequence used by the verified Worker."""
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("INSERT INTO sharika_google_play_purchases"
                   "(token_hash,user_uid,product_id,coins,order_id) VALUES(?,?,?,?,?)",
                   (token_hash, "buyer", "sharika_coins_500k", coins, order))
        db.execute("UPDATE sharika_users SET coins=CASE WHEN status='active' "
                   "AND coins<=? THEN coins+? ELSE -1 END,updated_at=datetime('now') "
                   "WHERE auth_uid=?", (1000000000000-coins, coins, "buyer"))
        db.execute("INSERT INTO sharika_wallet_ledger"
                   "(auth_uid,currency,delta,balance_after,reason,request_id)"
                   "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"
                   "'google_play_recharge',?)",
                   ("buyer", coins, "buyer", "google-play:"+token_hash))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        raise


first = "a" * 64
grant(first, "GPA.1111-2222-3333-44444", 500000)
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='buyer'").fetchone()[0] == 512000
assert db.execute("SELECT balance_after FROM sharika_wallet_ledger").fetchone()[0] == 512000
for hash_value, order in ((first, "GPA.5555-6666-7777-88888"),
                          ("b" * 64, "GPA.1111-2222-3333-44444")):
    try:
        grant(hash_value, order, 500000)
        raise AssertionError("A repeated token/order was accepted")
    except sqlite3.IntegrityError:
        pass
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='buyer'").fetchone()[0] == 512000
assert db.execute("SELECT COUNT(*) FROM sharika_wallet_ledger").fetchone()[0] == 1

db.execute("UPDATE sharika_users SET status='blocked' WHERE auth_uid='buyer'")
db.commit()
try:
    grant("c" * 64, "GPA.9999-1111-2222-33333", 500000)
    raise AssertionError("Blocked user was credited")
except sqlite3.IntegrityError:
    pass
assert db.execute("SELECT COUNT(*) FROM sharika_google_play_purchases").fetchone()[0] == 1
print("Play Billing SQL: once-only credit, order uniqueness, ledger and blocked-user rollback verified")
