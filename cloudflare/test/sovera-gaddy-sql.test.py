"""Standalone D1/SQLite trigger check: no changes to legacy wallet tables."""
import pathlib
import sqlite3
import time

root = pathlib.Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript((root / 'migrations/0001_initial.sql').read_text())
db.executescript((root / 'migrations/0046_admin_game_catalog.sql').read_text())
db.executescript((root / 'migrations/0058_sovera_gaddy_game.sql').read_text())
assert db.execute("SELECT enabled FROM sharika_game_catalog WHERE id='sovera-gaddy'").fetchone() == (1,)
db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(10000001,'owner','Owner','1995-01-01',0,1000)")
now = int(time.time()*1000)
db.execute('INSERT INTO sharika_gaddy_rounds(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256,weights_json,multipliers_json) VALUES(?,?,?,?,?,?,?,?,?)',
           ('sovera-gaddy:123', 123, now-1000, now+19000, now+29000, 'a'*64, 'b'*64,
            '[20,36,60,90,180,180,180,180,37,37]', '[45,25,15,10,5,5,5,5,2,2]'))
db.execute('INSERT INTO sharika_gaddy_bets(round_id,round_no,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?)',
           ('sovera-gaddy:123',123,'owner',1,50,'sovera-gaddy:once-0001'))
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone() == (950,)
try:
    db.execute('INSERT INTO sharika_gaddy_bets(round_id,round_no,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?)',
               ('sovera-gaddy:123',123,'owner',1,50,'sovera-gaddy:once-0001'))
    raise AssertionError('Duplicate request ID must not debit twice')
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE sharika_gaddy_bets SET status='settled',payout=1250,result_key='fish',settled_at=datetime('now') WHERE id=1 AND status='accepted'")
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone() == (2200,)
db.execute("UPDATE sharika_gaddy_bets SET status='settled' WHERE id=1")
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='owner'").fetchone() == (2200,)
assert db.execute("SELECT delta FROM sharika_wallet_ledger ORDER BY id").fetchall() == [(-50,), (1250,)]
print('Sovera Gaddy wallet debit, idempotency, exactly-once payout: OK')
