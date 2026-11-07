"""Agency owners automatically become Hosts on creation or transfer."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for name in (
    "0001_initial.sql", "0004_gift_transactions.sql",
    "0009_coin_sellers.sql", "0023_admin_exchange_rate.sql",
    "0048_family_bd_crystal.sql", "0049_family_membership_management.sql",
    "0059_agency_host_earnings.sql",
):
    db.executescript((root / "migrations" / name).read_text())

for no, uid, minor in (
    (10000001, "owner", 0), (10000002, "bd", 0),
    (10000003, "new_owner", 0), (10000004, "new_leader", 0),
    (10000005, "teen", 1), (10000006, "other_host", 0),
):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',?,1000)", (no, uid, uid, minor)
    )
db.execute(
    "INSERT INTO sharika_bd_agents(bd_uid,active,can_grant,assigned_by) "
    "VALUES('bd',1,1,'owner')"
)
db.execute(
    "INSERT INTO sharika_families(name,owner_uid,bd_uid) "
    "VALUES('Existing Agency','owner','bd')"
)
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "VALUES(1,'owner','leader')"
)
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "VALUES(1,'other_host','member')"
)
db.execute(
    "INSERT INTO sharika_agency_hosts(host_uid,family_id,active,assigned_by) "
    "VALUES('other_host',1,1,'owner')"
)

migration = (root / "migrations" / "0061_agency_owner_auto_host.sql").read_text()
db.executescript(migration)
assert db.execute(
    "SELECT host_uid,family_id,active,assigned_by FROM sharika_agency_hosts "
    "WHERE host_uid='owner'"
).fetchone() == ("owner", 1, 1, "bd")
assert db.execute("SELECT COUNT(*) FROM sharika_agency_hosts").fetchone() == (2,)

# A repeat is idempotent and leaves an owner's already assigned Host active.
db.executescript(migration)
assert db.execute("SELECT COUNT(*) FROM sharika_agency_hosts").fetchone() == (2,)
db.execute("UPDATE sharika_agency_hosts SET active=0 WHERE host_uid='owner'")
db.executescript(migration)
assert db.execute(
    "SELECT active FROM sharika_agency_hosts WHERE host_uid='owner'"
).fetchone() == (1,)

# Every creation channel inserts into sharika_families, so the same trigger
# covers BD grants, Admin approvals and direct Admin Agency creation.
db.execute(
    "INSERT INTO sharika_families(name,owner_uid,bd_uid) "
    "VALUES('New Agency','new_owner','bd')"
)
assert db.execute(
    "SELECT family_id,active FROM sharika_agency_hosts WHERE host_uid='new_owner'"
).fetchone() == (2, 1)
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "VALUES(2,'new_owner','leader')"
)
db.execute(
    "INSERT INTO sharika_family_members(family_id,user_uid,role) "
    "VALUES(2,'new_leader','member')"
)
db.execute("UPDATE sharika_families SET owner_uid='new_leader' WHERE id=2")
assert db.execute(
    "SELECT family_id,active FROM sharika_agency_hosts WHERE host_uid='new_leader'"
).fetchone() == (2, 1)

# Age safety: minor owners cannot be granted a salary-earning Host role.
db.execute(
    "INSERT INTO sharika_families(name,owner_uid,bd_uid) "
    "VALUES('Teen Agency','teen','bd')"
)
assert db.execute(
    "SELECT COUNT(*) FROM sharika_agency_hosts WHERE host_uid='teen'"
).fetchone() == (0,)

# Auto-host is role metadata, never a wallet credit or a pending payout.
assert db.execute(
    "SELECT COUNT(*) FROM sharika_agency_earnings"
).fetchone() == (0,)
assert db.execute(
    "SELECT MIN(coins),MAX(coins),SUM(diamonds) FROM sharika_users"
).fetchone() == (1000, 1000, 0)
print("Agency owner auto-Host: backfill, creation, transfer, minor safety, idempotency, wallet isolation verified")
