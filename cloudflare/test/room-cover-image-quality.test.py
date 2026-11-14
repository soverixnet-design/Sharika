"""Legacy room photos survive the migration to the cover API's JPEG limits."""
import base64
import sqlite3
from pathlib import Path

migrations = Path(__file__).resolve().parents[1] / "migrations"
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.execute("CREATE TABLE sharika_rooms (id TEXT PRIMARY KEY)")
db.execute("INSERT INTO sharika_rooms VALUES ('10000002')")
db.executescript((migrations / "0018_room_cover_thumbnails.sql").read_text())

legacy = ("10000002", "image/jpeg", "/9j/AAAAAAAAAP/Z", 16, 3, "2026-11-14 07:15:00")
db.execute("INSERT INTO sharika_room_covers VALUES (?,?,?,?,?,?)", legacy)
db.executescript((migrations / "0084_room_cover_image_quality.sql").read_text())
assert db.execute("SELECT * FROM sharika_room_covers").fetchone() == legacy

photo = b"\xff\xd8\xff" + b"\x01" * 239995 + b"\xff\xd9"
data = base64.b64encode(photo).decode()
db.execute(
    "UPDATE sharika_room_covers SET image_base64=?, image_bytes=?, version=version+1",
    (data, len(photo)),
)
assert db.execute("SELECT image_bytes, version FROM sharika_room_covers").fetchone() == (240000, 4)
try:
    db.execute("UPDATE sharika_room_covers SET image_bytes=240001")
    raise AssertionError("oversized cover was accepted")
except sqlite3.IntegrityError:
    pass

assert db.execute("PRAGMA foreign_key_check").fetchall() == []
db.execute("DELETE FROM sharika_rooms WHERE id='10000002'")
assert db.execute("SELECT COUNT(*) FROM sharika_room_covers").fetchone() == (0,)
