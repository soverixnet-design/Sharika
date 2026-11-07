"""Execute the real JS-generated D1 statements against SQLite, not replicas."""
import json
import sqlite3
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in ('0001_initial.sql', '0004_gift_transactions.sql',
                  '0009_coin_sellers.sql', '0023_admin_exchange_rate.sql',
                  '0048_family_bd_crystal.sql', '0049_family_membership_management.sql',
                  '0059_agency_host_earnings.sql', '0060_agency_room_activity.sql'):
    db.executescript((root / 'migrations' / migration).read_text())

db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) "
           "VALUES(10000123,'host','Real Host','1990-01-01',0)")
db.execute("INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor) "
           "VALUES(10000124,'owner','Owner','1990-01-01',0)")
for room in ('12345678', '23456789'):
    db.execute('INSERT INTO sharika_rooms(id,owner_id,name) VALUES(?,?,?)',
               (room, 'owner' if room == '12345678' else 'host', 'Room'))

script = """
import {agencyRoomActivityStatements} from './src/agency-room-time.mjs';
const db={prepare(sql){return {bind(...values){return {sql,values};}}}};
const base=Date.parse('2026-11-04T23:59:10Z');
const events=[
  [0,'12345678'],[25000,'12345678'],[40000,'12345678'],
  [65000,'12345678'],[90000,'12345678'],
  [115000,'23456789'],[140000,'23456789'],
  [165000,null],[190000,'23456789'],[280000,'23456789'],
  [305000,'23456789'],[305000,'23456789']
];
process.stdout.write(JSON.stringify(events.map(([delta,room])=>
  agencyRoomActivityStatements(db,'host',room,base+delta))));
"""
result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root,
                        capture_output=True, text=True, check=True)
for heartbeat in json.loads(result.stdout):
    with db:
        for statement in heartbeat:
            db.execute(statement['sql'], statement['values'])

assert db.execute('SELECT utc_day,room_id,active_seconds '
                  'FROM sharika_agency_room_activity ORDER BY utc_day,room_id').fetchall() == [
    ('2026-11-04', '12345678', 40),
    ('2026-11-05', '12345678', 25),
    ('2026-11-05', '23456789', 50),
]
assert db.execute('SELECT room_id,last_seen_ms FROM sharika_agency_presence_cursor '
                  "WHERE user_uid='host'").fetchone() == ('23456789',
                                                          1793837055000)

# Delete a voice room without erasing the signed daily-history record.
db.execute("DELETE FROM sharika_rooms WHERE id='23456789'")
assert db.execute("SELECT active_seconds FROM sharika_agency_room_activity "
                  "WHERE room_id='23456789'").fetchone() == (50,)
assert db.execute("SELECT coins,diamonds FROM sharika_users WHERE auth_uid='host'")\
    .fetchone() == (0, 0)
print('Agency room activity SQL: UTC rollover, switch, leave, stale gap, '
      'duplicate, history retention, wallet isolation verified')
