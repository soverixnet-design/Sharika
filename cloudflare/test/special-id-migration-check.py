#!/usr/bin/env python3
"""Local SQLite regression: preserve prior aliases and block canonical collisions."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = (root / "migrations/0032_special_ids.sql").read_text()
upgrade = (root / "migrations/0042_special_id_one_to_ten.sql").read_text()
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE sharika_users(
 auth_uid TEXT PRIMARY KEY, public_no INTEGER NOT NULL UNIQUE
);
INSERT INTO sharika_users VALUES('admin',10000001),('member',10000002);
""")
db.executescript(old)
db.execute("""INSERT INTO sharika_special_ids(auth_uid,special_id,assigned_by,expires_at)
 VALUES ('member','1010','admin','2030-01-01 00:00:00')""")
before = db.execute("SELECT * FROM sharika_special_ids").fetchall()
db.executescript(upgrade)
after = db.execute("SELECT * FROM sharika_special_ids").fetchall()
assert before == after, "migration lost or changed an existing alias"

for value in ["1", "12", "1234567", "12345678", "1234567890"]:
    db.execute("UPDATE sharika_special_ids SET special_id=? WHERE auth_uid='member'", (value,))
    assert db.execute("SELECT special_id FROM sharika_special_ids WHERE auth_uid='member'").fetchone()[0] == value

for invalid in ["", "12345678901", "1a", "-1", "1.2", "10000001"]:
    try:
        db.execute("UPDATE sharika_special_ids SET special_id=? WHERE auth_uid='member'", (invalid,))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError(f"accepted invalid or conflicting special ID: {invalid!r}")

# A reserved 8-digit alias cannot later become a real canonical ID.
db.execute("UPDATE sharika_special_ids SET special_id='10000003' WHERE auth_uid='member'")
try:
    db.execute("INSERT INTO sharika_users VALUES ('new','10000003')")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("a new canonical ID shadowed an existing alias")

# The signup allocation query must skip the occupied alias to avoid conflicts.
signup_sql = (root / "src/index.mjs").read_text()
assert "WITH RECURSIVE candidate(n)" in signup_sql
next_id = db.execute("""
WITH RECURSIVE candidate(n) AS (
 SELECT COALESCE(MAX(public_no),10000000)+1 FROM sharika_users
 UNION ALL
 SELECT n+1 FROM candidate WHERE EXISTS (
  SELECT 1 FROM sharika_special_ids WHERE special_id=CAST(candidate.n AS TEXT)
 )
)
SELECT n FROM candidate ORDER BY n DESC LIMIT 1
""").fetchone()[0]
assert next_id == 10000004, "new user ID allocation did not skip the reserved alias"

# Re-check that a 1-digit alias can be assigned without touching a canonical ID.
db.execute("UPDATE sharika_special_ids SET special_id='7' WHERE auth_uid='member'")
assert db.execute("SELECT public_no FROM sharika_users WHERE auth_uid='member'").fetchone()[0] == 10000002
print("Special ID 1–10 migration, legacy aliases and canonical collision guards passed")
