"""SQLite regression checks for staff grant limits on isolated staging schema."""
import pathlib
import sqlite3

db = sqlite3.connect(":memory:")
for path in sorted(pathlib.Path("cloudflare/migrations").glob("*.sql")):
    db.executescript(path.read_text(encoding="utf-8"))
staff_uid = "firebase:sharika-voice-chat-app:staff-test"
db.execute(
    "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
    "VALUES(10000001,'owner','Owner','2000-01-01',0,0)"
)
db.execute(
    "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
    "VALUES(10000002,'buyer','Buyer','2000-01-01',0,100)"
)
db.execute(
    "INSERT INTO sharika_admin_staff_accounts("
    "auth_uid,login_email,display_name,permissions_json,daily_coin_limit,active,created_by"
    ") VALUES(?,?,?,?,?,?,?)",
    (staff_uid, "helper@example.test", "Helper", '["coin_recharge"]', 200, 1, "owner"),
)
assert db.execute("SELECT COUNT(*) FROM sharika_admin_direct_recharges").fetchone()[0] == 0

# The Worker performs these three steps inside one D1 batch.
db.execute("UPDATE sharika_users SET coins=coins+150 WHERE auth_uid='buyer'")
db.execute(
    "INSERT INTO sharika_admin_direct_recharges("
    "actor_uid,recipient_uid,coins,reason,request_id,balance_after"
    ") VALUES(?,?,?,?,?,(SELECT coins FROM sharika_users WHERE auth_uid='buyer'))",
    (staff_uid, "buyer", 150, "Approved promotion", "test-staff-grant-one"),
)
db.execute(
    "INSERT INTO sharika_wallet_ledger("
    "auth_uid,currency,delta,balance_after,reason,request_id"
    ") VALUES('buyer','coins',150,250,'admin_direct_recharge',?)",
    ("admin-credit:staff:test-one",),
)
db.commit()
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='buyer'").fetchone()[0] == 250
assert db.execute("SELECT COUNT(*) FROM sharika_wallet_ledger").fetchone()[0] == 1

try:
    db.execute("BEGIN")
    db.execute("UPDATE sharika_users SET coins=coins+100 WHERE auth_uid='buyer'")
    db.execute(
        "INSERT INTO sharika_admin_direct_recharges("
        "actor_uid,recipient_uid,coins,reason,request_id,balance_after"
        ") VALUES(?,?,?,?,?,(SELECT coins FROM sharika_users WHERE auth_uid='buyer'))",
        (staff_uid, "buyer", 100, "Another promotion", "test-staff-grant-two"),
    )
    raise AssertionError("Staff daily limit did not reject overspend")
except sqlite3.IntegrityError as exc:
    assert "staff_daily_limit_exceeded" in str(exc), exc
    db.rollback()
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='buyer'").fetchone()[0] == 250
assert db.execute("SELECT COUNT(*) FROM sharika_admin_direct_recharges").fetchone()[0] == 1

for sql in [
    "UPDATE sharika_admin_direct_recharges SET coins=1 WHERE id=1",
    "DELETE FROM sharika_admin_direct_recharges WHERE id=1",
]:
    try:
        db.execute(sql)
        raise AssertionError("Immutable grant was edited")
    except sqlite3.IntegrityError:
        pass
db.execute("UPDATE sharika_admin_staff_accounts SET active=0 WHERE auth_uid=?", (staff_uid,))
try:
    db.execute(
        "INSERT INTO sharika_admin_direct_recharges("
        "actor_uid,recipient_uid,coins,reason,request_id,balance_after"
        ") VALUES(?,?,?,?,?,250)",
        (staff_uid, "buyer", 1, "Suspended staff", "test-staff-grant-three"),
    )
    raise AssertionError("Suspended staff could credit coins")
except sqlite3.IntegrityError as exc:
    assert "staff_recharge_disabled" in str(exc), exc

print("Staff quotas and immutable wallet grants validated; no real users or balances touched")
