#!/usr/bin/env python3
"""Isolated D1 migration check: old Jackpot bet survives while new Fruit Royale uses real wallet."""
import pathlib
import sqlite3
import time

root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ('0001_initial.sql','0007_original_games.sql','0046_admin_game_catalog.sql'):
    db.executescript((root/'migrations'/name).read_text())

db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(10000001,'fruit-test','Fruit Tester','2000-01-01',0,10000)")
db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(10000002,'fruit-low','Low Tester','2000-01-01',0,500)")
now=int(time.time()*1000)
number=now//40000
legacy='jackpot-fruit:3333333'
db.execute('INSERT INTO sharika_original_game_rounds(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) VALUES(?,?,?,?,?,?,?,?)',
           (legacy,'jackpot-fruit',3333333,now-1000,now+10000,now+20000,'a'*64,'b'*64))
db.execute('INSERT INTO sharika_original_game_bets(game,round_no,round_id,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?,?)',
           ('jackpot-fruit',3333333,legacy,'fruit-test',3,100,'legacy-fruit-bet-12345'))
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='fruit-test'").fetchone() == (9900,)
assert db.execute('SELECT COUNT(*) FROM sharika_wallet_ledger').fetchone() == (1,)
db.executescript((root/'migrations'/'0055_fruit_royale_v2.sql').read_text())
assert db.execute("SELECT enabled FROM sharika_game_catalog WHERE id='fruit-royale'").fetchone() == (1,)
assert db.execute("SELECT enabled FROM sharika_game_catalog WHERE id='jackpot-fruit'").fetchone() == (0,)
assert db.execute('SELECT COUNT(*) FROM sharika_original_game_bets').fetchone() == (1,)
assert db.execute('SELECT COUNT(*) FROM sharika_wallet_ledger').fetchone() == (1,)
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='fruit-test'").fetchone() == (9900,)

rid='fruit-royale:'+str(number)
db.execute('INSERT INTO sharika_fruit_royale_rounds(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) VALUES(?,?,?,?,?,?,?)',
           (rid,number,now-1000,now+10000,now+20000,'c'*64,'d'*64))
sql='INSERT INTO sharika_fruit_royale_bets(round_id,round_no,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?)'
db.execute(sql,(rid,number,'fruit-test',3,1000,'fruit-request-key-12345'))
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='fruit-test'").fetchone() == (8900,)
for uid,amount,request in [('fruit-test',1000,'fruit-request-key-12345'),
                            ('fruit-low',1000,'fruit-low-request-12345')]:
    try:
        db.execute(sql,(rid,number,uid,3,amount,request))
        raise AssertionError('Duplicate debit or overdraft accepted')
    except sqlite3.IntegrityError:
        pass
assert db.execute('SELECT COUNT(*) FROM sharika_fruit_royale_bets').fetchone() == (1,)
id=db.execute("SELECT id FROM sharika_fruit_royale_bets WHERE user_uid='fruit-test'").fetchone()[0]
db.execute("UPDATE sharika_fruit_royale_bets SET status='settled',payout=20000,result_json='{}',settled_at=datetime('now') WHERE id=?",(id,))
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='fruit-test'").fetchone() == (28900,)
for change in ('UPDATE sharika_fruit_royale_bets SET payout=999999 WHERE id=?',
               'DELETE FROM sharika_fruit_royale_bets WHERE id=?'):
    try:
        db.execute(change,(id,))
        raise AssertionError('Settled game history mutated')
    except sqlite3.IntegrityError:
        pass
db.execute("UPDATE sharika_original_game_bets SET status='settled',payout=400,result_json='{}',settled_at=datetime('now') WHERE round_id=?",(legacy,))
assert db.execute("SELECT coins FROM sharika_users WHERE auth_uid='fruit-test'").fetchone() == (29300,)
entries=db.execute("SELECT delta,balance_after FROM sharika_wallet_ledger WHERE auth_uid='fruit-test' ORDER BY id").fetchall()
assert entries == [(-100,9900),(-1000,8900),(20000,28900),(400,29300)],entries
assert db.execute("SELECT coins FROM sharika_fruit_royale_pool WHERE id='main'").fetchone() == (50,)
db.execute('INSERT INTO sharika_fruit_royale_jackpots(round_id,budget,total_stake) VALUES(?,?,?)',(rid,25,1000))
assert db.execute("SELECT coins FROM sharika_fruit_royale_pool WHERE id='main'").fetchone() == (25,)
assert db.execute("SELECT coins FROM sharika_original_game_pools WHERE game='jackpot-fruit'").fetchone() == (5,)
print('FRUIT_ROYALE_D1_OLD_HISTORY_AND_WALLET_PRESERVED_DOUBLE_DEBIT_BLOCKED_PAYOUT_ONCE_OK')
