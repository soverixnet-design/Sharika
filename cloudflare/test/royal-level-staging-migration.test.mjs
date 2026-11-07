import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('staging level migration preserves existing history and freezes new user baseline once',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,wealth_level INTEGER NOT NULL,
      charm_level INTEGER NOT NULL);
    CREATE TABLE sharika_gift_events(sender_uid TEXT,recipient_uid TEXT,
      quantity INTEGER,price_coins INTEGER);
    CREATE TABLE sharika_bond_gift_events(sender_uid TEXT,recipient_uid TEXT,value_coins INTEGER);
    CREATE TABLE sharika_greedy_bets(user_uid TEXT,status TEXT,settled_at TEXT);
    INSERT INTO sharika_users VALUES ('older',12,7),('friend',2,3);
    INSERT INTO sharika_gift_events VALUES ('older','friend',3,500000);
    INSERT INTO sharika_bond_gift_events VALUES ('friend','older',350000);
  `);
  const migration=readFileSync(new URL('../migrations/0072_royal_level_v2_baselines.sql',import.meta.url),'utf8');
  db.exec(migration);
  const before=db.prepare("SELECT * FROM sharika_royal_level_v2_baselines WHERE auth_uid='older'").get();
  assert.equal(before.sent_baseline_coins,1500000);
  assert.equal(before.received_baseline_coins,350000);
  assert.equal(before.old_wealth_level,12);
  assert.equal(before.old_charm_level,7);
  db.exec(`INSERT INTO sharika_users VALUES ('new',1,1);
    INSERT INTO sharika_gift_events VALUES ('new','older',1,9000000);`);
  db.exec(migration);
  const after=db.prepare("SELECT * FROM sharika_royal_level_v2_baselines WHERE auth_uid='older'").get();
  assert.deepEqual(after,before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sharika_royal_level_v2_baselines WHERE auth_uid='new'").get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_gift_events').get().n,2);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_sharika_greedy_daily_wins'").get());
  db.close();
});
