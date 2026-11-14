import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {publicSvipSelect,selectPremiumTier,handlePremiumApp} from '../src/premium.mjs';

test('verified recharge starts at $10, upgrades within the fixed cycle and drops refunded value',async()=>{
  const db=new DatabaseSync(':memory:');
  const path=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(path).filter(file=>file.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL(file,path),'utf8'));
  const now=Date.now(),day=86400000;
  db.exec("INSERT INTO sharika_users(auth_uid,public_no,name,birthdate,minor) VALUES('a',10000001,'A','1990-01-01',0)");
  db.exec("UPDATE sharika_premium_policy SET svip_recharge_enabled=1 WHERE key='standard'");
  const levels=db.prepare('SELECT recharge_usd FROM sharika_svip_levels ORDER BY level').all()
    .map(row=>row.recharge_usd);
  assert.deepEqual(levels,[10,25,50,100,300,500,1000,3000]);
  function pay(id,coins,time,eligible=true){
    const hash=String(id).padStart(64,'0');
    db.prepare("INSERT INTO sharika_google_play_purchases(token_hash,user_uid,product_id,coins,order_id) VALUES(?,'a','sku',?,?)")
      .run(hash,coins,'order-'+id);
    if(eligible)db.prepare("INSERT INTO sharika_svip_recharge_orders(token_hash,auth_uid,credited_at_ms,base_coins) VALUES(?,'a',?,?)")
      .run(hash,time,coins);
    return hash;
  }
  const cycle=()=>db.prepare('SELECT * FROM sharika_svip_recharge_status ORDER BY id DESC LIMIT 1').get();
  const level=()=>db.prepare("SELECT "+publicSvipSelect('u')+" FROM sharika_users u WHERE auth_uid='a'").get().svip_level;
  pay(1,2500000,now-10000);
  pay(2,5000000,now-8000,false);
  assert.equal(cycle().base_coins,2500000);
  assert.equal(cycle().expires_at_ms,null);
  assert.equal(level(),0);
  const voided=pay(3,2500000,now-5000);
  const expiry=now-5000+30*day;
  assert.equal(cycle().expires_at_ms,expiry);
  assert.equal(level(),1);
  pay(4,7500000,now-1000);
  assert.equal(level(),2);
  db.prepare('INSERT INTO sharika_svip_voided_orders VALUES(?)').run(voided);
  assert.equal(level(),1);
  assert.equal(cycle().expires_at_ms,expiry);
  const d1={prepare(sql){let params=[];return {
    bind(...values){params=values;return this;},
    first:async()=>db.prepare(sql).get(...params),
    all:async()=>({results:db.prepare(sql).all(...params)})
  };}};
  const status=(await handlePremiumApp({request:new Request('https://example.test/api/v1/premium'),
    env:{DB:d1},uid:'a',path:'/api/v1/premium',nowMs:now,reply:body=>body})).status;
  assert.equal(status.svip_level,1);
  assert.equal(status.source,'verified_recharge');
  assert.equal(status.svip_recharge.remaining_coins,2500000);
  pay(5,1500000000,expiry);
  assert.equal(cycle().base_coins,1500000000);
  assert.equal(cycle().expires_at_ms,expiry+30*day);
  assert.equal(db.prepare('SELECT count(*) AS count FROM sharika_svip_recharge_cycles').get().count,2);
  db.close();
});

test('paid SVIP displays its cosmetics alongside existing premium rules',()=>{
  const policy={svip_recharge_enabled:true,auto_enabled:true,auto_by_level:true};
  const tiers=[{tier:'noble',min_wealth_level:2}];
  const result=selectPremiumTier({policy,tiers,wealthLevel:10,nowMs:1,
    recharge:{level:7,expires_at_ms:5000}});
  assert.equal(result.svip_level,7);
  assert.equal(result.expires_at_ms,5000);
});
