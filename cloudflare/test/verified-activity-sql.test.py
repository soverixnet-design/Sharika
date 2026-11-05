"""Exercise the additive activity-event triggers against real SQLite."""
import sqlite3
import time
from pathlib import Path


root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
event_migration = root / "migrations/0057_verified_activity_events.sql"

# Existing records must not produce surprise ranking scores or payouts.
for migration in sorted((root / "migrations").glob("*.sql")):
    if migration != event_migration:
        db.executescript(migration.read_text())

for number, uid in ((10000001, "sender"), (10000002, "owner")):
    db.execute(
        "INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
        "VALUES(?,?,?,'1990-01-01',0,100000)",
        (number, uid, uid),
    )
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('12345678','owner','Royal')")
db.execute("INSERT INTO sharika_gifts(id,name,price_coins,active) VALUES(1,'Rose',100,1)")
db.execute(
    "INSERT INTO sharika_gift_transactions "
    "(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) "
    "VALUES('sender','12345678',1,1,'[]',100,'historic-gift-001')"
)
db.execute(
    "INSERT INTO sharika_wallet_ledger "
    "(auth_uid,currency,delta,balance_after,reason,request_id) "
    "VALUES('sender','coins',100,100000,'manual_recharge','historic-recharge-001')"
)
before = db.execute("SELECT auth_uid,coins FROM sharika_users ORDER BY public_no").fetchall()
db.executescript(event_migration.read_text())
assert db.execute("SELECT COUNT(*) FROM sharika_verified_activity_events").fetchone() == (0,)
assert db.execute("SELECT auth_uid,coins FROM sharika_users ORDER BY public_no").fetchall() == before

# One verified gift transaction is one event, even when replay is attempted.
db.execute(
    "INSERT INTO sharika_gift_transactions "
    "(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) "
    "VALUES('sender','12345678',1,3,'[]',300,'activity-gift-001')"
)
try:
    db.execute(
        "INSERT INTO sharika_gift_transactions "
        "(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) "
        "VALUES('sender','12345678',1,3,'[]',300,'activity-gift-001')"
    )
    raise AssertionError("Replay gift was accepted")
except sqlite3.IntegrityError:
    pass
assert db.execute(
    "SELECT source_ref,event_type,user_uid,scope_id,amount_coins,payout_coins "
    "FROM sharika_verified_activity_events"
).fetchall() == [("gift:2", "gift_sent", "sender", "12345678", 300, 0)]

# Only specifically verified recharge reasons are eligible. A forged admin
# grant or any wallet debit is not a recharge ranking event.
for reason, delta, key in (
    ("seller_recharge", 500, "activity-seller-001"),
    ("manual_recharge", 700, "activity-manual-001"),
    ("admin_recharge", 900, "activity-admin-001"),
    ("gift_sent", -10, "activity-debit-001"),
):
    db.execute(
        "INSERT INTO sharika_wallet_ledger "
        "(auth_uid,currency,delta,balance_after,reason,request_id) "
        "VALUES('sender','coins',?,100000,?,?)",
        (delta, reason, key),
    )
assert db.execute(
    "SELECT amount_coins FROM sharika_verified_activity_events "
    "WHERE event_type='recharge_approved' ORDER BY amount_coins"
).fetchall() == [(500,), (700,)]

now = int(time.time() * 1000)
seed = "a" * 64
commit = "b" * 64
db.execute(
    "INSERT INTO sharika_game_rounds "
    "(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) "
    "VALUES('food-wheel:1','food-wheel',1,?,?,?,?,?)",
    (now - 3000, now + 20000, now + 30000, seed, commit),
)
db.execute(
    "INSERT INTO sharika_game_bets "
    "(game,round_no,round_id,user_uid,stake,pick_index,request_id) "
    "VALUES('food-wheel',1,'food-wheel:1','sender',100,0,'activity-game-001')"
)
db.execute(
    "UPDATE sharika_game_bets SET status='settled',payout=900,result_json='{}',"
    "settled_at=datetime('now') WHERE id=1"
)
# A repeated UPDATE cannot duplicate game settlement or winnings.
db.execute("UPDATE sharika_game_bets SET status='settled' WHERE id=1")

db.execute(
    "INSERT INTO sharika_original_game_rounds "
    "(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) "
    "VALUES('sovera-food:1','sovera-food',1,?,?,?,?,?)",
    (now - 3000, now + 20000, now + 30000, seed, commit),
)
db.execute(
    "INSERT INTO sharika_original_game_bets "
    "(game,round_no,round_id,user_uid,pick_index,amount,request_id) "
    "VALUES('sovera-food',1,'sovera-food:1','sender',0,200,'activity-original-001')"
)
db.execute(
    "UPDATE sharika_original_game_bets SET status='settled',payout=0,"
    "result_json='{}',settled_at=datetime('now') WHERE id=1"
)

db.execute(
    "INSERT INTO sharika_greedy_rounds "
    "(id,round_no,starts_ms,bet_closes_ms,settles_ms,ends_ms,seed_hex,commit_sha256) "
    "VALUES('greedy:1',1,?,?,?,?,?,?)",
    (now - 3000, now + 20000, now + 30000, now + 40000, seed, commit),
)
db.execute(
    "INSERT INTO sharika_greedy_bets "
    "(round_id,round_no,user_uid,item_id,amount,request_id) "
    "VALUES('greedy:1',1,'sender','shrimp',300,'activity-greedy-001')"
)
db.execute(
    "UPDATE sharika_greedy_bets SET status='settled',payout=0,"
    "result_id='shrimp',settled_at=datetime('now') WHERE id=1"
)

db.execute(
    "INSERT INTO sharika_fruit_royale_rounds "
    "(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) "
    "VALUES('fruit:1',1,?,?,?,?,?)",
    (now - 3000, now + 20000, now + 30000, seed, commit),
)
db.execute(
    "INSERT INTO sharika_fruit_royale_bets "
    "(round_id,round_no,user_uid,pick_index,amount,request_id) "
    "VALUES('fruit:1',1,'sender',0,400,'activity-fruit-001')"
)
db.execute(
    "UPDATE sharika_fruit_royale_bets SET status='settled',payout=0,"
    "result_json='{}',settled_at=datetime('now') WHERE id=1"
)
assert db.execute(
    "SELECT game_code,amount_coins,payout_coins "
    "FROM sharika_verified_activity_events WHERE event_type='game_settled' "
    "ORDER BY source_ref"
).fetchall() == [
    ("fruit-royale", 400, 0),
    ("greedy-wheel", 300, 0),
    ("food-wheel", 100, 900),
    ("sovera-food", 200, 0),
]
assert db.execute(
    "SELECT COUNT(*) FROM sharika_wallet_ledger "
    "WHERE reason='game_win' AND request_id='game:win:1'"
).fetchone() == (1,)

# Transaction rollback must undo the activity mirror as well.
count_before = db.execute(
    "SELECT COUNT(*) FROM sharika_verified_activity_events"
).fetchone()[0]
db.execute("SAVEPOINT simulate_failed_gift")
db.execute(
    "INSERT INTO sharika_gift_transactions "
    "(sender_uid,room_id,gift_id,quantity,recipient_ids_json,total_coins,request_id) "
    "VALUES('sender','12345678',1,1,'[]',100,'activity-rollback-001')"
)
db.execute("ROLLBACK TO simulate_failed_gift")
db.execute("RELEASE simulate_failed_gift")
assert db.execute(
    "SELECT COUNT(*) FROM sharika_verified_activity_events"
).fetchone()[0] == count_before

for statement in (
    "UPDATE sharika_verified_activity_events SET amount_coins=1 WHERE source_ref='gift:2'",
    "DELETE FROM sharika_verified_activity_events WHERE source_ref='gift:2'",
):
    try:
        db.execute(statement)
        raise AssertionError("Activity ledger history was editable")
    except sqlite3.IntegrityError as error:
        assert "verified_activity_immutable" in str(error)

assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute(
    "SELECT auth_uid,coins FROM sharika_users ORDER BY public_no"
).fetchall()[1] == before[1]
print("Verified activity ledger: gift/recharge/4 games, rollback, replay and immutability OK")
