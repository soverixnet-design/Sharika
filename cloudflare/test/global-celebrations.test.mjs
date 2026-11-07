import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readGlobalCelebrations} from '../src/global-celebrations.mjs';

function database(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY,public_no INTEGER,
      name TEXT,pic TEXT,status TEXT);
    CREATE TABLE sharika_gifts(id INTEGER PRIMARY KEY,name TEXT,emoji TEXT,
      animation_url TEXT,audio_url TEXT);
    CREATE TABLE sharika_gift_events(id INTEGER PRIMARY KEY,price_coins INTEGER,
      quantity INTEGER,sender_uid TEXT,recipient_uid TEXT,gift_id INTEGER);
    CREATE TABLE sharika_greedy_bets(id INTEGER PRIMARY KEY,user_uid TEXT,
      status TEXT,payout INTEGER);
    CREATE TABLE sharika_original_game_bets(id INTEGER PRIMARY KEY,user_uid TEXT,
      game TEXT,status TEXT,payout INTEGER);
    CREATE TABLE sharika_fruit_royale_bets(id INTEGER PRIMARY KEY,user_uid TEXT,
      status TEXT,payout INTEGER);
    CREATE TABLE sharika_gaddy_bets(id INTEGER PRIMARY KEY,user_uid TEXT,
      status TEXT,payout INTEGER);
    INSERT INTO sharika_users VALUES ('sender',10000001,'Royal Sender','/sender.png','active'),
      ('receiver',10000002,'Royal Receiver','/receiver.png','active');
    INSERT INTO sharika_gifts VALUES(7,'Golden Dragon','🐉','/dragon.mp4','/dragon.mp3');
  `);
  sql.exec(readFileSync(new URL('../migrations/0073_global_celebrations.sql',import.meta.url),'utf8'));
  const db={prepare(query){const stmt=sql.prepare(query);let values=[];
    return {bind(...args){values=args;return this;},async first(){return stmt.get(...values)||null;},
      async all(){return {results:stmt.all(...values)};}};
  }};
  return {sql,db};
}

test('large verified gift generates exactly one global event with both identities',async()=>{
  const {sql,db}=database();
  sql.prepare('INSERT INTO sharika_gift_events VALUES(?,?,?,?,?,?)')
    .run(1,250000,1,'sender','receiver',7);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sharika_global_celebrations').get().n,0);
  sql.prepare('INSERT INTO sharika_gift_events VALUES(?,?,?,?,?,?)')
    .run(2,500000,2,'sender','receiver',7);
  const feed=await readGlobalCelebrations(db);
  assert.equal(feed.events.length,1);
  assert.equal(feed.events[0].kind,'gift');
  assert.equal(feed.events[0].amount_coins,1000000);
  assert.equal(feed.events[0].sender_id,'10000001');
  assert.equal(feed.events[0].recipient_name,'Royal Receiver');
  assert.equal(feed.events[0].gift_emoji,'🐉');
  assert.equal(feed.policy.gift_threshold_coins,1000000);
  assert.equal(feed.latest_id,1);
  sql.close();
});

test('only server-settled jackpot winnings broadcast and never twice',async()=>{
  const {sql,db}=database();
  const games=[
    ['sharika_greedy_bets','Greedy Wheel'],
    ['sharika_fruit_royale_bets','Fruit Royale'],
    ['sharika_gaddy_bets','Sovera Gaddy']
  ];
  for(const [table] of games){
    sql.prepare('INSERT INTO '+table+' VALUES(?,?,?,?)').run(1,'sender','accepted',12000000);
  }
  sql.prepare('INSERT INTO sharika_original_game_bets VALUES(?,?,?,?,?)')
    .run(1,'sender','night-food','accepted',15000000);
  assert.equal((await readGlobalCelebrations(db)).events.length,0);
  for(const [table] of games){
    sql.prepare("UPDATE "+table+" SET status='settled' WHERE id=1").run();
    // A duplicate worker invocation cannot replay a settled result.
    sql.prepare("UPDATE "+table+" SET status='settled' WHERE id=1").run();
  }
  sql.prepare("UPDATE sharika_original_game_bets SET status='settled' WHERE id=1").run();
  const feed=await readGlobalCelebrations(db);
  assert.equal(feed.events.length,4);
  assert.deepEqual(new Set(feed.events.map(e=>e.game)),
    new Set([...games.map(g=>g[1]),'Night Food Wheel']));
  assert.ok(feed.events.every(e=>e.kind==='win'&&e.amount_coins>=10000000));
  sql.close();
});

test('server-configured thresholds apply to new receipts but never rewrite past events',async()=>{
  const {sql,db}=database();
  sql.prepare('UPDATE sharika_celebration_settings SET gift_threshold_coins=?,win_threshold_coins=? WHERE id=1')
    .run(5000000,25000000);
  sql.prepare('INSERT INTO sharika_gift_events VALUES(?,?,?,?,?,?)')
    .run(1,1000000,1,'sender','receiver',7);
  sql.prepare('INSERT INTO sharika_greedy_bets VALUES(?,?,?,?)')
    .run(1,'sender','accepted',10000000);
  sql.prepare("UPDATE sharika_greedy_bets SET status='settled' WHERE id=1").run();
  assert.equal((await readGlobalCelebrations(db)).events.length,0);
  sql.prepare('INSERT INTO sharika_gift_events VALUES(?,?,?,?,?,?)')
    .run(2,5000000,1,'sender','receiver',7);
  assert.equal((await readGlobalCelebrations(db)).events.length,1);
  sql.close();
});
