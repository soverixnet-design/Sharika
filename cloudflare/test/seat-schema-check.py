"""Verify guests can take free seats without owner invites; isolated SQLite only."""
import pathlib
import sqlite3

db = sqlite3.connect(":memory:")
for path in sorted(pathlib.Path("cloudflare/migrations").glob("*.sql")):
    db.executescript(path.read_text(encoding="utf-8"))
for number, uid in [(10000001, "owner"), (10000002, "guest-a"), (10000003, "guest-b")]:
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) "
        "VALUES (?,?,?,'2000-01-01',0)",
        (number, uid, uid),
    )
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('10000001','owner','Voice room')")
for uid in ("owner", "guest-a", "guest-b"):
    db.execute("INSERT INTO sharika_room_members(room_id,user_id,role) VALUES('10000001',?,?)",
               (uid, "owner" if uid == "owner" else "member"))
# No owner invitation exists or is needed for guests claiming an unlocked free seat.
db.execute("UPDATE sharika_room_members SET seat_no=1 WHERE room_id='10000001' AND user_id='guest-a'")
row=db.execute("SELECT seat_no,muted FROM sharika_room_members WHERE user_id='guest-a'").fetchone()
assert row == (1, 0), row
# Double booking is rejected atomically even when users tap at the same time.
try:
    db.execute("UPDATE sharika_room_members SET seat_no=1 WHERE room_id='10000001' AND user_id='guest-b'")
    raise AssertionError("Two guests occupied one microphone seat")
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE sharika_room_members SET seat_no=2 WHERE room_id='10000001' AND user_id='guest-b'")
assert db.execute("SELECT seat_no FROM sharika_room_members WHERE user_id='guest-b'").fetchone()[0] == 2
db.execute("UPDATE sharika_room_members SET seat_no=NULL WHERE room_id='10000001' AND user_id='guest-a'")
db.execute("UPDATE sharika_room_members SET seat_no=1 WHERE room_id='10000001' AND user_id='guest-b'")
assert db.execute("SELECT seat_no FROM sharika_room_members WHERE user_id='guest-b'").fetchone()[0] == 1
print("Direct guest seat claims, microphone unmuted default and unique occupancy pass")
