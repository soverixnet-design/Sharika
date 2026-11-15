import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleLocation,handleAdminLocation} from '../src/profile-location.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql','0089_profile_location_changes.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sqlite.exec(`INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,country,coins)
    VALUES(10000001,'member','Member','1990-01-01',0,'',2000000)`);
  const db = {
    prepare(sql) {
      const s = sqlite.prepare(sql);
      return {bind(...args) {
        return {
          async first() { return s.get(...args); },
          run() { return {meta:s.run(...args)}; }
        };
      }};
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement=>statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const reply = (body,status) => Response.json(body,{status});
  const fail = (error,status) => reply({error},status);
  const call = (method,body,admin=false,role='super') => {
    const request = new Request('https://example.test/location',{
      method,...(body ? {body:JSON.stringify(body)} : {})
    });
    const args = {request,db,uid:admin?'admin':'member',role,reply,fail,readBody:r=>r.json()};
    return admin ? handleAdminLocation(args) : handleLocation(args);
  };
  const change = (country,expected_country,expected_coins,id) =>
    call('PUT',{country,expected_country,expected_coins,request_id:'location:'+id});
  return {sqlite,call,change};
}

test('first location is free, later changes are charged once and recorded in Main Wallet',async()=>{
  const {sqlite,call,change} = fixture();
  assert.equal((await (await call('GET')).json()).change_price,0);
  assert.equal((await change('BD','',0,'initial-1')).status,200);
  assert.equal((await (await call('GET')).json()).change_price,1000000);
  const [first,retry] = await Promise.all(Array.from({length:2},
    ()=>change('IN','BD',1000000,'same-operation')));
  assert.equal((await first.json()).charged_coins,1000000);
  assert.equal((await retry.json()).duplicate,true);
  assert.equal((await change('IN','IN',1000000,'same-country')).status,200);
  assert.deepEqual(sqlite.prepare('SELECT country,coins FROM sharika_users').get().country,'IN');
  assert.deepEqual(sqlite.prepare('SELECT delta,balance_after FROM sharika_wallet_ledger')
    .all().map(row=>[row.delta,row.balance_after]),[[-1000000,1000000]]);
});

test('changed quotes and insufficient funds leave country and balance intact',async()=>{
  const {sqlite,call,change} = fixture();
  await change('BD','',0,'initial-1');
  await call('PATCH',{coins:3000000,expected_coins:1000000},true);
  const oldPrice = await change('IN','BD',1000000,'old-quote');
  assert.equal((await oldPrice.json()).error,'location_quote_changed');
  const insufficient = await change('IN','BD',3000000,'low-balance');
  assert.equal((await insufficient.json()).error,'insufficient_coins');
  assert.equal(sqlite.prepare('SELECT country FROM sharika_users').get().country,'BD');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,0);
});

test('only Super Admin can set a free user location or make future changes free',async()=>{
  const {sqlite,call,change} = fixture();
  await change('BD','',0,'initial-1');
  const target = {target_public_id:'10000001',country:'OM'};
  assert.equal((await call('POST',target,true,'support')).status,403);
  assert.equal((await call('POST',target,true)).status,200);
  assert.equal((await call('PATCH',{coins:0,expected_coins:1000000},true)).status,200);
  assert.equal((await change('DE','OM',0,'free-change')).status,200);
  assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='member'").get().coins,2000000);
  assert.equal(sqlite.prepare("SELECT actor_uid FROM sharika_location_changes WHERE country='OM'").get().actor_uid,'admin');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_location_price_audit').get().n,1);
});
