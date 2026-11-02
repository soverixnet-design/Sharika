import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {readGiftRankings} from '../src/admin.mjs';

function stagedRankDB(){
  // Use the actual migration chain and SQLite SQL engine, not fabricated
  // leaderboard rows; cosmetic joins/constraints must genuinely work.
  const sqlite=new DatabaseSync(':memory:');
  const folder=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(folder).filter(x=>x.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name,folder),'utf8'));
  sqlite.prepare(
    'INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins,frame_style,medal_style) '+
    "VALUES(10000008,'royal-user','Real rank user','2000-01-01',0,9000,'vip7','bronze')"
  ).run();
  // Verified equipment must also have a corresponding ownership record.
  sqlite.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id) "+
    "VALUES('royal-user','frame_style:royal-gold','admin_grant','ranking-frame-001')").run();
  sqlite.prepare("INSERT INTO sharika_cosmetic_inventory(auth_uid,item_id,source,request_id) "+
    "VALUES('royal-user','medal_style:gold','admin_grant','ranking-medal-001')").run();
  sqlite.prepare(
    "INSERT INTO sharika_cosmetic_equipped(auth_uid,kind,item_id) "+
    "VALUES('royal-user','frame_style','frame_style:royal-gold')"
  ).run();
  sqlite.prepare(
    "INSERT INTO sharika_cosmetic_equipped(auth_uid,kind,item_id) "+
    "VALUES('royal-user','medal_style','medal_style:gold')"
  ).run();
  const d1={
    prepare(sql){
      return {bind(...args){
        return {async all(){return {results:sqlite.prepare(sql).all(...args)}}};
      }};
    }
  };
  return {sqlite,d1};
}

test('actual D1 recharge leader returns server-equipped gold frame and medal',async()=>{
  const {sqlite,d1}=stagedRankDB();
  try{
    sqlite.prepare(
      "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES('royal-user','coins',9000,9000,'seller_recharge','ranking-recharge-001')"
    ).run();
    const data=await readGiftRankings(d1,'daily','recharge');
    assert.equal(data.leaders.length,1);
    assert.deepEqual(data.leaders[0].public_id,'10000008');
    assert.equal(data.leaders[0].total,9000);
    assert.equal(data.leaders[0].frame_style,'royal-gold');
    assert.equal(data.leaders[0].medal_style,'gold');
    assert.equal(data.source,'verified_recharge_ledger');
    // Explicit unequip must not resurrect an older legacy frame/medal.
    sqlite.prepare("UPDATE sharika_cosmetic_equipped SET item_id=NULL "+
      "WHERE auth_uid='royal-user' AND kind IN ('frame_style','medal_style')").run();
    const removed=await readGiftRankings(d1,'daily','recharge');
    assert.equal(removed.leaders[0].frame_style,'');
    assert.equal(removed.leaders[0].medal_style,'');
  }finally{sqlite.close();}
});

test('Lucky leaderboard uses settled gift outcomes, never Recharge wallet totals',async()=>{
  const {sqlite,d1}=stagedRankDB();
  try{
    sqlite.prepare(
      "INSERT INTO sharika_rooms(id,owner_id,name) "+
      "VALUES('10000008','royal-user','Royal room')"
    ).run();
    const gift=sqlite.prepare(
      "INSERT INTO sharika_gifts(name,tab,price_coins,active) "+
      "VALUES('Lucky star',2,300,1)"
    ).run();
    const transaction=sqlite.prepare(
      "INSERT INTO sharika_gift_transactions(sender_uid,room_id,gift_id,quantity,"+
      "recipient_ids_json,total_coins,request_id) VALUES(?,?,?,?,?,?,?)"
    ).run('royal-user','10000008',gift.lastInsertRowid,1,'["10000008"]',
      300,'rank-lucky-test-0001');
    sqlite.prepare(
      "INSERT INTO sharika_lucky_gift_outcomes(transaction_id,sender_uid,payout_coins,"+
      "max_multiplier,rolls_json) VALUES(?,?,?,?,?)"
    ).run(transaction.lastInsertRowid,'royal-user',1500,5,'[5]');
    const lucky=await readGiftRankings(d1,'daily','lucky');
    assert.equal(lucky.kind,'lucky');
    assert.equal(lucky.source,'verified_lucky_gift_payouts');
    assert.equal(lucky.leaders[0].total,1500);
    assert.equal(lucky.leaders[0].frame_style,'royal-gold');
    assert.equal(lucky.leaders[0].medal_style,'gold');
    const recharge=await readGiftRankings(d1,'daily','recharge');
    assert.equal(recharge.leaders.length,0,'Lucky payout must never appear as recharge');
  }finally{sqlite.close();}
});

test('original ranking UI uses a real 3-place podium and equipped profile media',()=>{
  const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const bridge=readFileSync(new URL(
    '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  assert.match(source,/0:\{kind:'lucky'/);
  assert.match(source,/6:\{kind:'recharge'/);
  assert.match(bridge,/kind=\(lucky\|rich\|charm\|room\|recharge\)/);
  assert.match(source,/leaders\.slice\(0,3\)/);
  assert.match(source,/leaders\.slice\(3\)/);
  assert.match(source,/sh-royal-podium-card/);
  assert.match(source,/const frame=frameArt\(leader\.frame_style\)/);
  assert.match(source,/const medal=medalArt\(leader\.medal_style\)/);
  assert.match(source,/function decorateVerifiedPublicProfile\(root,person\)/);
  assert.match(source,/decorateVerifiedPublicProfile\(root,member\)/);
  assert.match(source,/decorateVerifiedPublicProfile\(root,person\)/);
  assert.match(source,/inboxPeople=new Map/);
  assert.match(source,/No demo users or/);
});
