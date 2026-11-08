"""SQLite regression checks for time-limited staff privileges (no remote D1 writes)."""
from pathlib import Path
import sqlite3
import time

db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE sharika_admin_staff_accounts(
    id INTEGER PRIMARY KEY,auth_uid TEXT,active INTEGER,
    permissions_json TEXT,daily_coin_limit INTEGER
);
CREATE TABLE sharika_admin_direct_recharges(
    actor_uid TEXT,recipient_uid TEXT,coins INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
""")
sql = (Path(__file__).resolve().parents[1] / "migrations" /
       "0078_staff_access_expiry_and_revoke.sql").read_text()
db.executescript(sql)
now = int(time.time() * 1000)
db.execute("INSERT INTO sharika_admin_staff_accounts VALUES(1,?,?,?, ?, ?)",
           ("staff", 1, '["coin_recharge"]', 5000, now - 1000))


def recharge():
    db.execute("INSERT INTO sharika_admin_direct_recharges(actor_uid,recipient_uid,coins) "
               "VALUES('staff','user',100)")


try:
    recharge()
    raise AssertionError("Expired staff should not recharge")
except sqlite3.IntegrityError as exc:
    assert "staff_recharge_disabled" in str(exc)

db.execute("UPDATE sharika_admin_staff_accounts SET expires_at_ms=? WHERE auth_uid='staff'",
           (now + 86400000,))
recharge()
db.execute("UPDATE sharika_admin_staff_accounts SET active=0 WHERE auth_uid='staff'")
try:
    recharge()
    raise AssertionError("Revoked staff should not recharge")
except sqlite3.IntegrityError as exc:
    assert "staff_recharge_disabled" in str(exc)

assert db.execute("SELECT COUNT(*) FROM sharika_admin_direct_recharges").fetchone()[0] == 1
print("Staff expiration and revoke D1 trigger regression passed")
