import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {evaluateCleopatra,handleCleopatra,handleCleopatraAdmin} from '../src/cleopatra.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const migration=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(migration('0001_initial.sql'));
 sqlite.exec(migration('0046_admin_game_catalog.sql'));
 sqlite.exec(migration('0095_cleopatra_slot.sql'));
 const insert=sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)');
 insert.run(10000001,'adult-a','Adult A','1991-01-01',0,100000);
 insert.run(10000002,'minor-b','Minor B','2015-01-01',1,100000);
 const db={
   prepare(sql){
     const stmt=sqlite.prepare(sql);
     let params=[];
     return {
       bind(...values){params=values;return this;},
       async first(){return stmt.get(...params)||null;},
       async all(){return {results:stmt.all(...params)};},
       async run(){return {meta:stmt.run(...params)};}
     };
   },
   async batch(queries){return Promise.all(queries.map(q=>q.run()));}
 };
 const reply=(data,status=200)=>Response.json(data,{status});
 const fail=(error,status)=>Response.json({error},{status});
 function route(action,body,uid='adult-a',method=action==='state'?'GET':'POST'){
   return handleCleopatra({
     request:new Request('https://example.test/api/v1/cleopatra/'+action,{
       method,...(method==='POST'?{body:JSON.stringify(body||{}),
        headers:{'content-type':'application/json'}}:{})
     }),db,uid,action,reply,fail,cors:{}
   });
 }
 function admin(body,method='PATCH',role='super'){
   return handleCleopatraAdmin({
     request:new Request('https://example.test/api/v1/admin/cleopatra',{
       method,...(method==='PATCH'?{body:JSON.stringify(body),
         headers:{'content-type':'application/json'}}:{})
     }),db,uid:'adult-a',role,reply,fail,cors:{}
   });
 }
 return {sqlite,db,route,admin};
}
const grid=[
 ['K','H','N'],['Q','H','J'],['T','H','K'],['L','N','E'],['J','A','T']
];
const config={max_win:50000000,payout_scale:1};
test('5x3 evaluation: left-first line, bonus, jackpot, free-spin x2',()=>{
 const normal=evaluateCleopatra(grid,1000,24074034,config,false);
 assert.equal(normal.win,5000);
 assert.equal(evaluateCleopatra(grid,1000,24074034,config,true).win,10000);
 const bonus=grid.map(x=>[...x]);for(let i=0;i<3;i++)bonus[i][0]='B';
 assert.deepEqual(evaluateCleopatra(bonus,1000,24074034,config,false),
   {win:0,jackpot:false,bonus:true,bonusSpins:10});
 const jackpot=grid.map(x=>[...x]);for(let i=0;i<3;i++)jackpot[i][0]='P';
 const won=evaluateCleopatra(jackpot,1000,24074034,config,false);
 assert.equal(won.win,240740);assert.equal(won.jackpot,true);
 assert.equal(evaluateCleopatra(jackpot,1000,24074034,config,true).win,240740);
 assert.equal(evaluateCleopatra(jackpot,1000,24074034,{...config,max_win:10},false).win,10);
 const allWild=Array.from({length:5},()=>['W','W','W']);
 assert.ok(evaluateCleopatra(allWild,1000,24074034,config,false).win>0);
});
test('migration defaults disable catalog, keep wallets unchanged',()=>{
 const {sqlite}=fixture();
 assert.equal(sqlite.prepare("SELECT enabled FROM sharika_game_catalog WHERE id='cleopatra'").get().enabled,0);
 assert.equal(sqlite.prepare('SELECT enabled FROM sharika_cleopatra_settings WHERE id=1').get().enabled,1);
 assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-a'").get().coins,100000);
 sqlite.close();
});
test('idempotency: repeat requestId neither debits nor pays twice',async()=>{
 const {sqlite,route}=fixture();
 const id='cleopatra-verified-00000001';
 const first=await route('spin',{bet:1000,requestId:id});
 assert.equal(first.status,200);
 const a=await first.json();
 assert.equal(a.grid.length,5);
 assert.ok(a.grid.every(x=>x.length===3));
 const b=await (await route('spin',{bet:1000,requestId:id})).json();
 assert.deepEqual(b,a);
 const saved=sqlite.prepare("SELECT * FROM sharika_cleopatra_rounds WHERE request_id=?").get(id);
 assert.equal(saved.balance_after,100000-1000+saved.win);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_cleopatra_rounds').get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='cleopatra_bet'").get().n,1);
 assert.equal((await route('spin',{bet:2000,requestId:id})).status,409);
 sqlite.close();
});
test('invalid bets, insufficient coins, minor status, and rapid repeats rejected',async()=>{
 const {sqlite,route}=fixture();
 assert.equal((await route('spin',{bet:50,requestId:'invalid-bet-0001'})).status,400);
 assert.equal((await route('spin',{bet:1000,requestId:'minor-bet-00001'},'minor-b')).status,403);
 sqlite.prepare("UPDATE sharika_users SET coins=50 WHERE auth_uid='adult-a'").run();
 assert.equal((await route('spin',{bet:1000,requestId:'insufficient-0001'})).status,409);
 sqlite.prepare("UPDATE sharika_users SET coins=100000 WHERE auth_uid='adult-a'").run();
 const first=await route('spin',{bet:1000,requestId:'first-rapid-000001'});
 assert.equal(first.status,200);
 const rapid=await route('spin',{bet:1000,requestId:'second-rapid-00001'});
 assert.equal(rapid.status,429);
 sqlite.close();
});
test('admin validation, read permission and audit log',async()=>{
 const {sqlite,admin}=fixture();
 assert.equal((await admin({payout_scale:1.2},'PATCH','finance')).status,403);
 assert.equal((await admin({payout_scale:10})).status,400);
 assert.equal((await admin({payout_scale:1.1,max_win:4000000})).status,200);
 assert.equal(sqlite.prepare('SELECT payout_scale FROM sharika_cleopatra_settings WHERE id=1').get().payout_scale,1.1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_admin_audit WHERE action='cleopatra_settings_update'").get().n,1);
 sqlite.close();
});
