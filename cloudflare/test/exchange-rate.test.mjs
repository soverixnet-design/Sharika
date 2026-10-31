import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_EXCHANGE_RATE,readExchangeRate,exchangeCredit,
  handleAdminExchangeRate} from '../src/exchange-rate.mjs';

const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});
function fakeConfig({stored=true,rate={diamonds_per_unit:100,coins_per_unit:70,revision:1}}={}){
  const state={queries:[],batch:[]};
  const db={
    prepare(sql){
      return {
        sql,values:[],
        bind(...values){this.values=values;return this;},
        async first(){
          state.queries.push({sql,values:this.values});
          if(sql.includes('FROM sharika_exchange_rate')){
            if(!stored)throw Error('D1_ERROR: no such table: sharika_exchange_rate');
            return rate;
          }
          throw Error('Unexpected query: '+sql);
        }
      };
    },
    async batch(stmts){
      state.batch.push(stmts.map(x=>({sql:x.sql,values:x.values})));
      return stmts.map(()=>({success:true}));
    }
  };
  return {db,state};
}
async function admin(db,role,method,body){
  const request=new Request('https://sharika.test/api/v1/admin/exchange-rate',{
    method,body:body?JSON.stringify(body):undefined
  });
  const result=await handleAdminExchangeRate({
    request,db,uid:'verified-super',role,reply,fail,cors:{}
  });
  return {status:result.status,data:await result.json()};
}

test('missing exchange configuration retains known 100 diamonds = 70 coins',async()=>{
  const {db,state}=fakeConfig({stored:false});
  const rate=await readExchangeRate(db);
  assert.deepEqual(rate,DEFAULT_EXCHANGE_RATE);
  assert.equal(exchangeCredit(100,rate),70);
  assert.equal(exchangeCredit(500,rate),350);
  assert.equal(exchangeCredit(125,rate),null);
  assert.equal(state.batch.length,0);
});
test('super admin may configure 50:50 or 100:100 with exact integer credit',()=>{
  assert.equal(exchangeCredit(50,{diamonds_per_unit:50,coins_per_unit:50}),50);
  assert.equal(exchangeCredit(500,{diamonds_per_unit:50,coins_per_unit:50}),500);
  assert.equal(exchangeCredit(100,{diamonds_per_unit:100,coins_per_unit:100}),100);
  assert.equal(exchangeCredit(51,{diamonds_per_unit:50,coins_per_unit:50}),null);
});
test('public terms are readable, but only super admin can change them',async()=>{
  const {db,state}=fakeConfig();
  const read=await admin(db,'finance','GET');
  assert.equal(read.status,200);
  assert.deepEqual([read.data.diamonds_per_unit,read.data.coins_per_unit],[100,70]);
  assert.equal(read.data.read_only,true);
  const denied=await admin(db,'finance','PATCH',{
    diamonds_per_unit:50,coins_per_unit:50,expected_revision:1
  });
  assert.equal(denied.status,403);
  assert.equal(state.batch.length,0);
});
test('rate save is a revisioned audited two-statement D1 transaction',async()=>{
  const {db,state}=fakeConfig();
  const updated=await admin(db,'super','PATCH',{
    diamonds_per_unit:50,coins_per_unit:50,expected_revision:1
  });
  assert.equal(updated.status,200);
  assert.equal(updated.data.revision,2);
  assert.equal(state.batch.length,1);
  assert.equal(state.batch[0].length,2);
  assert.match(state.batch[0][0].sql,/CASE WHEN revision=\? THEN \? ELSE 0 END/);
  assert.equal(state.batch[0][0].values[0],1);
  assert.equal(state.batch[0][0].values[1],50);
  assert.match(state.batch[0][1].sql,/sharika_admin_audit/);
  const audit=JSON.parse(state.batch[0][1].values[2]);
  assert.deepEqual(audit.old,{diamonds_per_unit:100,coins_per_unit:70});
  assert.deepEqual(audit.next,{diamonds_per_unit:50,coins_per_unit:50});
});
test('stale revision and missing migration never write any settings',async()=>{
  const old=fakeConfig();
  const stale=await admin(old.db,'super','PATCH',{
    diamonds_per_unit:100,coins_per_unit:100,expected_revision:12
  });
  assert.equal(stale.status,409);
  assert.equal(old.state.batch.length,0);
  const missing=fakeConfig({stored:false});
  const pending=await admin(missing.db,'super','PATCH',{
    diamonds_per_unit:50,coins_per_unit:50,expected_revision:1
  });
  assert.equal(pending.status,503);
  assert.equal(missing.state.batch.length,0);
});
test('Exchange screen and admin panel use the same verified rate, never demo balances',()=>{
  const app=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.match(app,/GET','\/wallet\/exchange-rate'/);
  assert.match(app,/exchange_rate_revision:exchangeRateRevision/);
  assert.match(html,/window\.SHARIKA_EXCHANGE_FROM/);
  assert.match(html,/window\.SHARIKA_EXCHANGE_TO/);
  assert.match(panel,/P\.money=async function/);
  assert.match(panel,/PATCH','exchange-rate'/);
});
