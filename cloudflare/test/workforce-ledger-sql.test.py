"""Offline SQLite contract for immutable BD > Agency > Host salaries."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for path in ['0001_initial.sql', '0004_gift_transactions.sql',
             '0057_workforce_bd_agency_host.sql']:
    db.executescript((root / 'migrations' / path).read_text())

for no, uid in enumerate(['admin', 'bd', 'agency', 'host', 'sender', 'normal'], start=10000001):
    db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) "
               "VALUES(?,?,?,'1990-01-01',0,10000)", (no, uid, uid))
db.execute("INSERT INTO sharika_rooms(id,owner_id,name) VALUES('12345678','host','Room')")
for uid in ['admin', 'bd', 'agency', 'host', 'sender', 'normal']:
    db.execute('INSERT INTO sharika_room_members(room_id,user_id) VALUES(?,?)', ('12345678', uid))
db.execute("INSERT INTO sharika_gifts(id,name,tab,price_coins,active) VALUES(1,'Rose',0,100,1)")

def member(uid, role, parent):
    db.execute('INSERT INTO sharika_workforce_members(auth_uid,role,parent_uid,assigned_by) VALUES(?,?,?,?)',
               (uid, role, parent, 'admin'))

member('bd', 'bd', None)
member('agency', 'agency', 'bd')
member('host', 'host', 'agency')

def send(sender, recipient, price, request):
    db.execute('UPDATE sharika_gifts SET price_coins=? WHERE id=1', (price,))
    db.execute('INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,'
               'recipient_ids_json,total_coins,request_id) VALUES(?,?,?,?,?,?,?)',
               (sender, '12345678', 1, 1, '[]', price, request))
    txid = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    db.execute('INSERT INTO sharika_gift_events(transaction_id,room_id,sender_uid,'
               'recipient_uid,gift_id,quantity,price_coins) VALUES(?,?,?,?,?,?,?)',
               (txid, '12345678', sender, recipient, 1, 1, price))

send('sender', 'host', 5000000, 'worker-test-gift-001')
assert db.execute('SELECT SUM(gift_coins) FROM sharika_workforce_host_gifts '
                  "WHERE host_uid='host'").fetchone()[0] == 5000000
rows = db.execute('SELECT kind,beneficiary_uid,salary_units FROM sharika_workforce_salary_ledger '
                  'ORDER BY kind').fetchall()
assert rows == [('agency', 'agency', 5000000000), ('bd', 'bd', 2500000000),
                ('host', 'host', 20000000000)], rows
assert sum(row[2] for row in rows) == 27500000000  # 55% of 5M.

# Self gifts carry the same three independent percentages.
send('host', 'host', 100, 'worker-test-gift-002')
assert db.execute('SELECT COUNT(*) FROM sharika_workforce_salary_ledger').fetchone()[0] == 6

# Ordinary users not assigned Host cannot create workforce commission.
send('sender', 'normal', 100, 'worker-test-gift-003')
assert db.execute('SELECT COUNT(*) FROM sharika_workforce_salary_ledger').fetchone()[0] == 6
assert db.execute('SELECT COUNT(*) FROM sharika_workforce_host_gifts').fetchone()[0] == 2

# Policy edits affect subsequent gifts but never rewrite past earnings.
db.execute('UPDATE sharika_workforce_policy SET host_bps=3000,agency_bps=800,bd_bps=400,version=2 WHERE id=1')
send('sender', 'host', 100, 'worker-test-gift-004')
assert db.execute("SELECT salary_units,policy_version FROM sharika_workforce_salary_ledger "
                  "WHERE kind='host' ORDER BY id DESC LIMIT 1").fetchone() == (300000, 2)
assert db.execute("SELECT salary_units,policy_version FROM sharika_workforce_salary_ledger "
                  "WHERE kind='host' ORDER BY id ASC LIMIT 1").fetchone() == (20000000000, 1)

# Financial history is immutable.
try:
    db.execute('DELETE FROM sharika_workforce_salary_ledger WHERE id=1')
    raise AssertionError('salary deletion accepted')
except sqlite3.IntegrityError as error:
    assert 'immutable' in str(error)

# No exchange before approval, and no exchange of the current unsettled period.
try:
    db.execute("INSERT INTO sharika_workforce_salary_exchanges(auth_uid,salary_units,credited_coins,"
               "settlement_mode,policy_version,request_id) VALUES('host',10000,1,'weekly',2,'salary-block-001')")
    raise AssertionError('exchange accepted while disabled')
except sqlite3.IntegrityError as error:
    assert 'disabled' in str(error)

db.execute("UPDATE sharika_workforce_policy SET salary_exchange_enabled=1,version=3 WHERE id=1")
try:
    db.execute("INSERT INTO sharika_workforce_salary_exchanges(auth_uid,salary_units,credited_coins,"
               "settlement_mode,policy_version,request_id) VALUES('host',10000,1,'weekly',3,'salary-block-002')")
    raise AssertionError('unmatured exchange accepted')
except sqlite3.IntegrityError as error:
    assert 'not_matured' in str(error)

# Move only the ledger timestamps to an earlier period in this test DB; the
# immutable production trigger prohibits this, verifying guard behavior below.
db.execute('DROP TRIGGER sharika_workforce_salary_immutable_update')
db.execute("UPDATE sharika_workforce_salary_ledger SET created_at='2020-01-01 00:00:00'")
db.execute("INSERT INTO sharika_workforce_salary_exchanges(auth_uid,salary_units,credited_coins,"
           "settlement_mode,policy_version,request_id) VALUES('host',10000,1,'weekly',3,'salary-good-001')")
assert db.execute('SELECT credited_coins FROM sharika_workforce_salary_exchanges').fetchone()[0] == 1
try:
    db.execute("INSERT INTO sharika_workforce_salary_exchanges(auth_uid,salary_units,credited_coins,"
               "settlement_mode,policy_version,request_id) VALUES('host',30000000000,3000000,'weekly',3,'salary-over-001')")
    raise AssertionError('overdraft accepted')
except sqlite3.IntegrityError as error:
    assert 'insufficient' in str(error)

print('workforce D1 salary, roles, policy-versioning and exchange guard: OK')
