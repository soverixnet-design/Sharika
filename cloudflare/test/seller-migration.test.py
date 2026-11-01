"""Exercise the seller schema upgrade against real SQLite and existing history."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name.startswith('0038_'):
        continue
    db.executescript(path.read_text())
db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) VALUES(10000001,'seller','Seller','2000-01-01',0)")
db.execute("INSERT INTO sharika_coin_sellers(seller_uid,active,available_coins) VALUES('seller',1,10000000)")
db.execute("INSERT INTO sharika_coin_seller_allocations(actor_uid,seller_uid,amount,stock_after,request_id) VALUES('seller','seller',100,100,'old-allocation')")
db.execute("INSERT INTO sharika_coin_seller_transfers(seller_uid,target_uid,amount,stock_after,request_id) VALUES('seller','seller',50,50,'old-transfer')")
tables = ['sharika_coin_seller_allocations', 'sharika_coin_seller_transfers']
before = {t: db.execute(f'SELECT * FROM {t}').fetchall() for t in tables}
db.executescript((root / 'migrations/0038_seller_large_transfers.sql').read_text())
for table in tables:
    assert db.execute(f'SELECT * FROM {table}').fetchall() == before[table]
    for query in [f'UPDATE {table} SET amount=1', f'DELETE FROM {table}']:
        try:
            db.execute(query)
            raise AssertionError('Ledger mutation accepted')
        except sqlite3.IntegrityError:
            pass
for table, columns in [(tables[0], 'actor_uid,seller_uid'), (tables[1], 'seller_uid,target_uid')]:
    sql = f"INSERT INTO {table}({columns},amount,stock_after,request_id) VALUES('seller','seller',?,0,?)"
    db.execute(sql, (10000000,'large-request'))
    try:
        db.execute(sql, (10000000,'large-request'))
        raise AssertionError('Duplicate accepted')
    except sqlite3.IntegrityError:
        pass
    for amount in [0, -1, 1000000000001]:
        try:
            db.execute(sql, (amount,str(amount)))
            raise AssertionError('Invalid amount accepted')
        except sqlite3.IntegrityError:
            pass
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
print('Seller upgrade preserves history, accepts 10M, rejects replay and ledger mutation')
