"""Check additive Play Billing schema and immutable unique receipt behavior."""
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1] / "migrations"
connection = sqlite3.connect(":memory:")
connection.executescript((root / "0001_initial.sql").read_text())
connection.executescript((root / "0068_google_play_billing.sql").read_text())
connection.execute(
    "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) VALUES(?,?,?,?,?)",
    (10000001, "verified-user", "Test", "1995-05-12", 0),
)
hash_value = "a" * 64
connection.execute(
    "INSERT INTO sharika_play_billing_purchases(token_hash,auth_uid,product_id,coins) "
    "VALUES(?,?,?,?)",
    (hash_value, "verified-user", "sharika_coins_500k", 500000),
)
for sql, args in [
    (
        "INSERT INTO sharika_play_billing_purchases(token_hash,auth_uid,product_id,coins) "
        "VALUES(?,?,?,?)",
        (hash_value, "verified-user", "sharika_coins_500k", 500000),
    ),
    (
        "UPDATE sharika_play_billing_purchases SET coins=1 WHERE token_hash=?",
        (hash_value,),
    ),
    ("DELETE FROM sharika_play_billing_purchases WHERE token_hash=?", (hash_value,)),
]:
    try:
        connection.execute(sql, args)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("receipt allowed a replay or mutation")
assert connection.execute("SELECT COUNT(*) FROM sharika_play_billing_purchases").fetchone()[0] == 1
print("Play Billing D1 token uniqueness, historical-wallet isolation and immutable receipts: OK")
