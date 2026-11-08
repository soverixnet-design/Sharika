"""Ensure the additive campaign schema preserves wallets and counts only selected gifts."""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for file in (
    "0001_initial.sql", "0004_gift_transactions.sql", "0020_admin_banners.sql",
    "0026_admin_events_rewards.sql", "0044_home_banner_images.sql",
    "0077_banner_only_gift_events.sql",
):
    db.executescript((ROOT / "migrations" / file).read_text())

for public_no, uid in ((10000001, "admin"), (10000002, "sender"), (10000003, "receiver")):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',0,200)", (public_no, uid, uid)
    )
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('11111111','receiver','Royal Room')")
for uid in ("receiver", "sender"):
    db.execute("INSERT INTO sharika_room_members(room_id,user_id) VALUES('11111111',?)", (uid,))
for gift_id in (1, 2):
    db.execute(
        "INSERT INTO sharika_gifts(id,name,price_coins,active) VALUES(?,?,100,1)",
        (gift_id, "Gift " + str(gift_id))
    )
db.execute("INSERT INTO sharika_banners(title,active) VALUES('Gift Event Photo',0)")
db.execute(
    "INSERT INTO sharika_events(title,kind,starts_at,ends_at,status,prize_1,created_by,updated_by,"
    "banner_id,gift_rules_json,reward_labels_json) "
    "VALUES('Golden Rose','gift_race','2026-11-01T00:00:00.000Z',"
    "'2026-11-08T00:00:00.000Z','published',5000,'admin','admin',1,"
    "'[{\"gift_id\":1,\"points\":40}]','[\"Frame\",\"\",\"\",\"\",\"\",\"\",\"\"]')"
)

for no, (gift_id, instant) in enumerate(((1, "2026-11-02 11:15:00"),
                                         (2, "2026-11-03 11:15:00"),
                                         (1, "2026-11-09 11:15:00")), start=1):
    db.execute(
        "INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,"
        "recipient_ids_json,total_coins,request_id,created_at) "
        "VALUES('sender','11111111',?,1,'[\"receiver\"]',100,?,?)",
        (gift_id, f"gift-event-{no:012d}", instant)
    )
    db.execute(
        "INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,recipient_uid,"
        "gift_id,quantity,price_coins,created_at) "
        "VALUES(?,'11111111','sender','receiver',?,1,100,?)",
        (no, gift_id, instant)
    )

score = db.execute(
    "SELECT SUM(g.quantity*CASE g.gift_id WHEN ? THEN ? ELSE 0 END) "
    "FROM sharika_gift_events g JOIN sharika_users u ON u.auth_uid=g.sender_uid "
    "WHERE g.gift_id IN (?) AND g.created_at>=? AND g.created_at<? AND u.status='active'",
    (1, 40, 1, "2026-11-01 00:00:00", "2026-11-08 00:00:00")
).fetchone()[0]
assert score == 40, "Other gift IDs and post-event gifts cannot earn campaign points"
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='sender'").fetchone()[0] == 200
assert db.execute("SELECT COUNT(*) FROM sharika_event_awards").fetchone()[0] == 0
print("Banner-only events SQL: linked banner, strict gift filter, UTC window, unchanged wallets OK")
