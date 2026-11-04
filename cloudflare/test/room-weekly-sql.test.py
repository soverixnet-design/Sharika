#!/usr/bin/env python3
"""Offline D1-compatible SQLite checks: no existing wallet or room gift is rewritten."""
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
sql = (ROOT / "migrations/0057_room_weekly_rewards.sql").read_text()
app = (ROOT / "src/index.mjs").read_text()

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE sharika_rooms(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
CREATE TABLE sharika_users(
 auth_uid TEXT PRIMARY KEY, coins INTEGER NOT NULL CHECK(coins>=0),
 status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE sharika_gift_transactions(
 id INTEGER PRIMARY KEY, sender_uid TEXT NOT NULL, room_id TEXT NOT NULL
);
CREATE TABLE sharika_wallet_ledger(
 auth_uid TEXT NOT NULL, currency TEXT NOT NULL, delta INTEGER NOT NULL CHECK(delta!=0),
 balance_after INTEGER NOT NULL CHECK(balance_after>=0),
 reason TEXT NOT NULL, request_id TEXT NOT NULL,
 UNIQUE(auth_uid,currency,request_id)
);
""")
db.execute("INSERT INTO sharika_rooms VALUES('r1','owner')")
db.executemany("INSERT INTO sharika_users(auth_uid,coins) VALUES(?,?)",
               [("owner", 1000), ("sender", 10)])
db.execute("INSERT INTO sharika_gift_transactions VALUES(1,'sender','r1')")
db.execute("INSERT INTO sharika_wallet_ledger VALUES('owner','coins',5,1000,'room_gift_reward','roomgift:1')")
before = db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone()[0]
db.executescript(sql)
assert before == db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone()[0]
assert db.execute("SELECT COUNT(*) FROM sharika_room_weekly_accruals").fetchone()[0] == 0

db.executemany("INSERT INTO sharika_gift_transactions VALUES(?,'sender','r1')",
               [(2,), (3,)])
db.execute("INSERT INTO sharika_room_weekly_accruals(transaction_id,room_id,owner_uid,week_start_utc,reward_hundredths) VALUES(2,'r1','owner','2026-10-26',90)")
db.execute("INSERT INTO sharika_room_weekly_accruals(transaction_id,room_id,owner_uid,week_start_utc,reward_hundredths) VALUES(3,'r1','owner','2026-11-02',30)")
try:
    db.execute("INSERT INTO sharika_room_weekly_accruals(transaction_id,room_id,owner_uid,week_start_utc,reward_hundredths) VALUES(2,'r1','owner','2026-10-26',90)")
    raise AssertionError("duplicate gift accrual allowed")
except sqlite3.IntegrityError:
    pass

# First week earns fractional coins; carry is preserved into the next week.
db.execute("INSERT INTO sharika_room_weekly_payouts(room_id,owner_uid,week_start_utc,earned_hundredths,coins_paid,carry_hundredths) VALUES('r1','owner','2026-10-26',90,0,90)")
db.execute("INSERT INTO sharika_room_weekly_payouts(room_id,owner_uid,week_start_utc,earned_hundredths,coins_paid,carry_hundredths) VALUES('r1','owner','2026-11-02',30,1,20)")
db.execute("UPDATE sharika_users SET coins=coins+1 WHERE auth_uid='owner'")
db.execute("INSERT INTO sharika_wallet_ledger VALUES('owner','coins',1,1001,'room_weekly_reward','roomweek:r1:owner:2026-11-02')")
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone()[0] == 1001
assert db.execute("SELECT SUM(coins_paid) FROM sharika_room_weekly_payouts").fetchone()[0] == 1
try:
    db.execute("INSERT INTO sharika_room_weekly_payouts(room_id,owner_uid,week_start_utc,earned_hundredths,coins_paid,carry_hundredths) VALUES('r1','owner','2026-11-02',30,1,20)")
    raise AssertionError("duplicate weekly payout allowed")
except sqlite3.IntegrityError:
    pass
assert "'room_gift_reward','roomgift:'" not in app, "old immediate credit still active"
assert "sharika_room_weekly_accruals" in app and "settleDueRoomWeeks" in app
print("room weekly payout schema, historic-coin preservation and carry: OK")
