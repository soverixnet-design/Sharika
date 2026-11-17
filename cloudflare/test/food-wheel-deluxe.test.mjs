import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {foodDeluxeOutcome,foodDeluxePayout,handleFoodDeluxe,
  FOOD_DELUXE_ROUND_MS,settleFoodDueBets} from '../src/food-wheel-deluxe.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const seed='0123456789abcdef'.repeat(4);
const commit=createHash('sha256').update(seed).digest('hex');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_initial.sql','0046_admin_game_catalog.sql','0096_food_wheel_deluxe.sql']){
  sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
 const insert=sqlite.prepare('INSERT INTO sharika_users '+
  '(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)');
 insert.run(10000001,'food-adult','Food Adult','1990-05-12',0,1000000);
 insert.run(10000002,'food-minor','Food Minor','2015-01-01',1,1000000);
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql);let args=[];
  return {
   bind(...values){args=values;return this},
   async first(){return stmt.get(...args)||null},
   async all(){return {results:stmt.all(...args)}},
   async run(){return {meta:stmt.run(...args)}}
  };
 }};
 const reply=(value,status=200)=>Response.json(value,{status});
 const fail=(error,status)=>Response.json({error},{status});
 const request=(action,body,uid='food-adult',method=action==='bet'?'POST':'GET')=>
  handleFoodDeluxe({request:new Request('https://example.test/api/v1/original-games/food-deluxe/'+action,
   {method,...(method==='POST'?{headers:{'content-type':'application/json'},
    body:JSON.stringify(body)}:{})}),
    db,uid,action,reply,fail,cors:{}});
 const wallet=()=>sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='food-adult'").get().coins;
 return {sqlite,db,request,wallet};
}
function round(sqlite,now){
 const n=Math.floor(now/FOOD_DELUXE_ROUND_MS);
 sqlite.prepare('INSERT INTO sharika_food_deluxe_rounds '+
  '(id,round_no,starts_ms,bet_closes_ms,result_ms,closes_ms,seed_hex,commit_sha256) '+
  'VALUES(?,?,?,?,?,?,?,?)')
  .run('food-deluxe:'+n,n,now-5000,now+10000,now+12000,now+18000,seed,commit);
 return n;
}
test('uploaded 8 foods retain exact multiplier and group payout rules',async()=>{
 assert.equal(FOOD_DELUXE_ROUND_MS,25000);
 for(let i=0;i<8;i++){
  const stake=Array(8).fill(0);stake[i]=100;
  assert.equal(foodDeluxePayout(stake,i),[500,1000,1500,2500,500,500,500,4500][i]);
  assert.equal(foodDeluxePayout(stake,(i+1)%8),0);
 }
 const fruit=[100,0,0,0,100,100,100,0],meat=[0,100,100,100,0,0,0,100];
 assert.equal(fruit.reduce((a,b)=>a+b,0),400);
 assert.equal(meat.reduce((a,b)=>a+b,0),400);
 assert.equal(foodDeluxePayout(meat,7),4500);
 const a=await foodDeluxeOutcome(seed),b=await foodDeluxeOutcome(seed);
 assert.equal(a,b);assert.ok(a>=0&&a<8);
});
test('migration creates separate disabled catalog without touching coin wallets',()=>{
 const {sqlite,wallet}=fixture();
 assert.equal(sqlite.prepare("SELECT enabled FROM sharika_game_catalog WHERE id='food-deluxe'").get().enabled,0);
 assert.equal(wallet(),1000000);
 sqlite.close();
});
test('atomic group bet, idempotent retry, server-settled win & immutable ledger',async()=>{
 const {sqlite,db,request,wallet}=fixture(),now=Date.now(),n=round(sqlite,now);
 const stakes=[100,0,0,0,100,100,100,0],request_id='food-deluxe-unique-00000001';
 const real=Date.now;
 Date.now=()=>n*FOOD_DELUXE_ROUND_MS+1000;
 let response;
 try{response=await request('bet',{round_no:n,stakes,request_id});}
 finally{Date.now=real;}
 assert.equal(response.status,201);assert.equal((await response.json()).stake_total,400);
 assert.equal(wallet(),999600);
 const retry=await request('bet',{round_no:n,stakes,request_id});
 assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);
 assert.equal(wallet(),999600);
 assert.equal((await request('bet',{round_no:n,stakes:[200,0,0,0,0,0,0,0],request_id})).status,409);
 const wonIndex=await foodDeluxeOutcome(seed);
 await settleFoodDueBets(db,now+13000);
 const paid=stakes[wonIndex]*[5,10,15,25,5,5,5,45][wonIndex];
 assert.equal(wallet(),999600+paid);
 assert.equal(sqlite.prepare('SELECT payout FROM sharika_food_deluxe_bets').get().payout,paid);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='food_deluxe_bet'").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='food_deluxe_win'").get().n,paid?1:0);
 await settleFoodDueBets(db,now+16000);
 assert.equal(wallet(),999600+paid);
 sqlite.close();
});
test('D1 refuses insufficient funds, invalid mask and underage wagering',()=>{
 const {sqlite,wallet}=fixture(),now=Date.now(),n=round(sqlite,now);
 const add=sqlite.prepare('INSERT INTO sharika_food_deluxe_bets '+
  '(round_id,round_no,user_uid,stakes_json,total,request_id) VALUES(?,?,?,?,?,?)');
 const before=wallet();
 assert.throws(()=>add.run('food-deluxe:'+n,n,'food-adult',JSON.stringify([100,0,0,0,0,0,0,0]),200,'bad-stakes-request-0001'));
 assert.throws(()=>add.run('food-deluxe:'+n,n,'food-minor',JSON.stringify([100,0,0,0,0,0,0,0]),100,'underage-request-00001'));
 assert.throws(()=>add.run('food-deluxe:'+n,n,'food-adult',JSON.stringify([100000100,0,0,0,0,0,0,0]),100000100,'insuff-request-00000001'));
 assert.equal(wallet(),before);
 sqlite.close();
});
test('API rejects malformed bets and underage player without debiting',async()=>{
 const {sqlite,request,wallet}=fixture(),now=Date.now(),n=round(sqlite,now);
 assert.equal((await request('bet',{round_no:n,stakes:[10],request_id:'bad-index-request-0001'})).status,400);
 assert.equal((await request('bet',{round_no:n,stakes:[100,0,0,0,0,0,0,0],request_id:'underage-route-00001'},'food-minor')).status,403);
 assert.equal(wallet(),1000000);
 sqlite.close();
});
test('uploaded HTML uses authenticated messages, never local random wallet credit',()=>{
 const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/food-wheel-deluxe.html',
  import.meta.url),'utf8');
 assert.ok(html.length>750000,'uploaded WebP assets retained');
 assert.ok(html.includes("const GAME='food-deluxe'"));
 assert.ok(html.includes("sharika:original-request"));
 assert.ok(html.includes("sharika:original-response"));
 assert.ok(html.includes("virtual_coins_only!==true"));
 assert.ok(!html.includes("coins+=pay"));
 assert.ok(!html.includes("function draw1()"));
});
