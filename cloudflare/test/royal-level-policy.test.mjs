import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';

const client=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const begin=client.indexOf('  const SHARIKA_ROYAL_LEVEL_GOAL=');
const end=client.indexOf('  function openRoyalLevelRoadmap(',begin);
assert.ok(begin>0&&end>begin,'level progression functions remain available');
const source=client.slice(begin,end).replaceAll(/^  /gm,'');
const policy=runInNewContext(source+'\n({royalLevelCost,royalProgressV2,royalProgressLevel})',{});

test('new gift thresholds grow from 1M to 5M and slowly reach level 100',()=>{
  assert.equal(policy.royalLevelCost(1),1_000_000);
  assert.equal(policy.royalLevelCost(2),5_000_000);
  assert.equal(policy.royalLevelCost(3),10_000_000);
  assert.equal(policy.royalLevelCost(99),490_000_000);
  assert.equal(policy.royalProgressV2('wealth',1,999_999,{
    sent_baseline_coins:0,old_wealth_level:1}).level,1);
  assert.equal(policy.royalProgressV2('wealth',1,1_000_000,{
    sent_baseline_coins:0,old_wealth_level:1}).level,2);
  assert.equal(policy.royalProgressV2('wealth',1,6_000_000,{
    sent_baseline_coins:0,old_wealth_level:1}).level,3);
  assert.ok(policy.royalProgressV2('wealth',1,100_000_000,{
    sent_baseline_coins:0,old_wealth_level:1}).level<10);
  const maxCoins=1_000_000+5_000_000*(98*99/2);
  assert.equal(policy.royalProgressV2('wealth',1,maxCoins,{
    sent_baseline_coins:0,old_wealth_level:1}).level,100);
});

test('pre-existing displayed levels survive new policy, only new gifts advance',()=>{
  const baseline=13_300_000;
  const current=policy.royalProgressLevel(baseline).level;
  const snapshot={sent_baseline_coins:baseline,old_wealth_level:1};
  const first=policy.royalProgressV2('wealth',1,baseline,snapshot);
  assert.equal(first.level,current);
  assert.equal(first.coins,0);
  const cost=policy.royalLevelCost(current);
  assert.equal(policy.royalProgressV2('wealth',1,baseline+cost-1,snapshot).level,current);
  assert.equal(policy.royalProgressV2('wealth',1,baseline+cost,snapshot).level,current+1);
});

test('migration takes one-time gift and legacy-level snapshot without touching existing gifts',()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE sharika_users(auth_uid TEXT PRIMARY KEY, wealth_level INTEGER NOT NULL,
      charm_level INTEGER NOT NULL);
    CREATE TABLE sharika_gift_events(sender_uid TEXT,recipient_uid TEXT,
      quantity INTEGER,price_coins INTEGER);
    CREATE TABLE sharika_bond_gift_events(sender_uid TEXT,recipient_uid TEXT,value_coins INTEGER);
    INSERT INTO sharika_users VALUES ('existing',4,2);
    INSERT INTO sharika_users VALUES ('other',1,1);
    INSERT INTO sharika_gift_events VALUES ('existing','other',2,500000);
    INSERT INTO sharika_bond_gift_events VALUES ('other','existing',10000);
  `);
  sqlite.exec(readFileSync(new URL('../migrations/0072_royal_level_v2_baselines.sql',import.meta.url),'utf8'));
  const prior=sqlite.prepare("SELECT * FROM sharika_royal_level_v2_baselines WHERE auth_uid='existing'").get();
  assert.equal(prior.sent_baseline_coins,1_000_000);
  assert.equal(prior.received_baseline_coins,10_000);
  assert.equal(prior.old_wealth_level,4);
  sqlite.exec(`
    INSERT INTO sharika_gift_events VALUES ('existing','other',1,9000000);
    INSERT INTO sharika_users VALUES ('new',1,1);
  `);
  const after=sqlite.prepare("SELECT * FROM sharika_royal_level_v2_baselines WHERE auth_uid='existing'").get();
  assert.equal(after.sent_baseline_coins,prior.sent_baseline_coins);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_gift_events').get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_royal_level_v2_baselines WHERE auth_uid='new'").get().n,0);
  // Deployment migrations are applied once; new accounts use zero baseline.
  sqlite.close();
});
