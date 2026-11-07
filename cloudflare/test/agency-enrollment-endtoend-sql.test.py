"""End-to-end Agency membership, owner approval, Host toggle, and gift earnings.

All SQL executes against an isolated in-memory SQLite database. No staging user,
wallet, Family history, or Cloudflare D1 record is ever changed by this test.
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for name in (
    "0001_initial.sql", "0004_gift_transactions.sql",
    "0009_coin_sellers.sql", "0023_admin_exchange_rate.sql",
    "0048_family_bd_crystal.sql", "0049_family_membership_management.sql",
    "0059_agency_host_earnings.sql", "0061_agency_owner_auto_host.sql",
):
    db.executescript((ROOT / "migrations" / name).read_text())

for no, uid in enumerate(("owner", "bd", "host", "sender", "outsider"), start=10000001):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',0,100000)",
        (no, uid, uid),
    )
db.execute(
    "INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) "
    "VALUES('bd',1,1,'owner')"
)
db.execute(
    "INSERT INTO sharika_families(name,owner_uid,bd_uid) "
    "VALUES('Royal Agency','owner','bd')"
)
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "VALUES(1,'owner','leader')"
)
assert db.execute(
    "SELECT host_uid FROM sharika_agency_hosts WHERE family_id=1"
).fetchall() == [("owner",)]

# The candidate's Apply action alone must NOT activate a Host.
db.execute(
    "INSERT INTO sharika_family_join_requests(family_id,applicant_uid) "
    "VALUES(1,'host')"
)
assert db.execute(
    "SELECT state FROM sharika_family_join_requests WHERE applicant_uid='host'"
).fetchone() == ("pending",)
assert not db.execute(
    "SELECT 1 FROM sharika_family_members WHERE family_id=1 AND user_uid='host'"
).fetchone()

# Owner reviews the pending request using the guarded membership SQL.
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "SELECT 1,'host','member' WHERE "
    "(SELECT COUNT(*) FROM sharika_family_members WHERE family_id=1) < "
    "(SELECT max_members FROM sharika_family_policy WHERE key='standard') "
    "AND EXISTS(SELECT 1 FROM sharika_family_join_requests "
    "WHERE family_id=1 AND applicant_uid='host' AND state='pending') "
    "AND EXISTS(SELECT 1 FROM sharika_families WHERE id=1 AND status='active')"
)
db.execute(
    "UPDATE sharika_family_join_requests SET state='accepted',"
    "reviewed_at=datetime('now') WHERE family_id=1 AND applicant_uid='host' "
    "AND state='pending' AND EXISTS(SELECT 1 FROM sharika_family_members "
    "WHERE family_id=1 AND user_uid='host')"
)
assert db.execute(
    "SELECT state FROM sharika_family_join_requests WHERE applicant_uid='host'"
).fetchone() == ("accepted",)
assert db.execute(
    "SELECT 1 FROM sharika_family_members WHERE user_uid='host'"
).fetchone()
assert not db.execute(
    "SELECT 1 FROM sharika_family_members WHERE user_uid='outsider'"
).fetchone()

# Owner's Activate Host action uses the same two statements as the Worker D1 batch.
db.execute(
    "INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by) "
    "VALUES('host',1,1,'owner') ON CONFLICT(host_uid) DO UPDATE "
    "SET active=excluded.active,updated_at=datetime('now')"
)
db.execute(
    "INSERT INTO sharika_admin_audit(actor_id,action,details_json) "
    "VALUES('owner','agency_owner_host_assignment',?)",
    ('{"agency_id":1,"host_public_id":"10000003","active":true}',),
)
assert db.execute(
    "SELECT active FROM sharika_agency_hosts WHERE host_uid='host'"
).fetchone() == (1,)
assert db.execute(
    "SELECT action FROM sharika_admin_audit WHERE actor_id='owner'"
).fetchone() == ("agency_owner_host_assignment",)

# Old code used the constrained Family activity table and would abort D1 batch.
try:
    db.execute(
        "INSERT INTO sharika_family_activity("
        "family_id,actor_uid,subject_uid,action,details_json) "
        "VALUES(1,'owner','host','host_assignment','{}')"
    )
    raise AssertionError("The historical activity CHECK must reject host_assignment")
except sqlite3.IntegrityError as error:
    assert "CHECK" in str(error)

db.execute(
    "INSERT INTO sharika_rooms(id,owner_id,name) "
    "VALUES('12345678','owner','Agency Room')"
)
for uid, role in (("owner", "owner"), ("host", "member"), ("sender", "member")):
    db.execute(
        "INSERT INTO sharika_room_members(room_id,user_id,role) "
        "VALUES('12345678',?,?)", (uid, role)
    )
db.execute(
    "INSERT INTO sharika_gifts(id,name,price_coins,active) "
    "VALUES(1,'Agency Gift',10000,1)"
)

def send_gift(number):
    key = f"agency-endtoend-{number:06d}"
    db.execute(
        "INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,"
        "quantity,recipient_ids_json,total_coins,request_id) "
        "VALUES('sender','12345678',1,1,'[\"host\"]',10000,?)", (key,)
    )
    tx = db.execute(
        "SELECT id FROM sharika_gift_transactions WHERE request_id=?", (key,)
    ).fetchone()[0]
    db.execute(
        "INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,"
        "recipient_uid,gift_id,quantity,price_coins) "
        "VALUES(?,'12345678','sender','host',1,1,10000)", (tx,)
    )
    for kind, beneficiary, rate, extra in (
        ("host_salary", "h.host_uid", "host_bps", ""),
        ("agency", "f.owner_uid", "agency_bps", ""),
        ("bd", "f.bd_uid", "bd_bps",
         "JOIN sharika_bd_agents b ON b.bd_uid=f.bd_uid AND b.active=1 "),
    ):
        db.execute(
            "INSERT INTO sharika_agency_earnings("
            "gift_event_id,family_id,host_uid,beneficiary_uid,kind,"
            "rate_bps,amount_units) "
            f"SELECT e.id,f.id,h.host_uid,{beneficiary},'{kind}',p.{rate},"
            f"e.quantity*e.price_coins*p.{rate} "
            "FROM sharika_gift_events e "
            "JOIN sharika_agency_hosts h ON h.host_uid=e.recipient_uid AND h.active=1 "
            "AND e.created_at>=h.assigned_at "
            "JOIN sharika_families f ON f.id=h.family_id AND f.status='active' "
            "JOIN sharika_family_members m ON m.family_id=f.id "
            "AND m.user_uid=h.host_uid "
            "JOIN sharika_agency_policy p ON p.key='standard' AND p.active=1 "
            "JOIN sharika_gifts g ON g.id=e.gift_id AND g.tab IN (0,1) "
            + extra + f"WHERE e.transaction_id=? AND p.{rate}>0", (tx,)
        )
    return tx

tx = send_gift(1)
assert db.execute(
    "SELECT kind,beneficiary_uid,amount_units FROM sharika_agency_earnings "
    "WHERE gift_event_id=? ORDER BY kind", (tx,)
).fetchall() == [
    ("agency", "owner", 10000*1000),
    ("bd", "bd", 10000*500),
    ("host_salary", "host", 10000*4000),
]
assert db.execute(
    "SELECT COUNT(*) FROM sharika_agency_earnings"
).fetchone() == (3,)
assert db.execute(
    "SELECT MIN(coins),MAX(coins),SUM(diamonds) FROM sharika_users"
).fetchone() == (100000, 100000, 0)

# Owner pauses the Host; the next gift can settle normally but yields no Agency salary.
db.execute("UPDATE sharika_agency_hosts SET active=0 WHERE host_uid='host'")
db.execute(
    "INSERT INTO sharika_admin_audit(actor_id,action,details_json) "
    "VALUES('owner','agency_owner_host_assignment','{\"active\":false}')"
)
send_gift(2)
assert db.execute(
    "SELECT COUNT(*) FROM sharika_agency_earnings"
).fetchone() == (3,)
assert db.execute(
    "SELECT MIN(coins),MAX(coins),SUM(diamonds) FROM sharika_users"
).fetchone() == (100000, 100000, 0)

print("Agency E2E SQL: Join -> Owner Approve -> Host Activate -> 40/10/5 Gift "
      "-> Host Pause; safe audit, no wallet mutation")
