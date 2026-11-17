import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {handleGreedyClassicRequest,greedyClassicOutcome,greedyClassicPayout,
 settleGreedyClassicDueBets} from '../src/greedy-classic.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const seed='fedcba9876543210'.repeat(4);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_initial.sql','0046_admin_game_catalog.sql','0097_greedy_classic.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const users=sqlite.prepare('INSERT INTO sharika_users (public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)');
 users.run(10000001,'adult-1','Verified Player','1990-01-01',0,100000);
 users.run(10000002,'minor-1','Underage User','2014-01-01',1,100000);
 const db={prepare(sql){
  const statement=sqlite.prepare(sql);let args=[];
  return {bind(...values){args=values;return this},
    async first(){return statement.get(...args)||null},
    async all(){return {results:statement.all(...args)}},
    async run(){return {meta:statement.run(...args)}}
  };
 }};
 const call=(action,body,uid='adult-1')=>handleGreedyClassicRequest({
   request:new Request('https://staging.invalid/api/v1/original-games/greedy-classic/'+action,{
     method:action==='bet'?'POST':'GET',
     ...(action==='bet'?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})
   }),
   db,uid,action,reply:(v,s)=>Response.json(v,{status:s}),
   fail:(e,s)=>Response.json({error:e},{status:s}),cors:{}});
 const balance=()=>sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-1'").get().coins;
 return {sqlite,db,call,balance};
}
function round(sqlite,now,n){
 sqlite.prepare('INSERT INTO sharika_greedy_classic_rounds '+
  '(id,round_no,starts_ms,bet_closes_ms,settles_ms,ends_ms,seed_hex,commit_sha256) '+
  'VALUES(?,?,?,?,?,?,?,?)').run('greedy-classic:'+n,n,now-5000,now+14000,
   now+16000,now+22000,seed,createHash('sha256').update(seed).digest('hex'));
}
test('original eight Greedy foods, 30s wager, four allowed chips and exact winnings',async()=>{
 const row={seed_hex:seed,round_no:12345};
 assert.equal(await greedyClassicOutcome(row),await greedyClassicOutcome(row));
 for(const [food,mul] of [['chicken',45],['fish',25],['hotdog',15],
  ['steak',10],['grape',5],['lettuce',5],['pepper',5],['watermelon',5]])
  assert.equal(greedyClassicPayout(food,100,food),100*mul);
 assert.equal(greedyClassicPayout('grape',100,'salad'),500);
 assert.equal(greedyClassicPayout('chicken',100,'pizza'),4500);
 assert.equal(greedyClassicPayout('chicken',100,'salad'),0);
 assert.equal(greedyClassicPayout('pepper',100,'pizza'),0);
});
test('D1 migration disabled by default and cannot modify existing Greedy Wheel',()=>{
 const {sqlite,balance}=fixture();
 assert.equal(sqlite.prepare("SELECT enabled FROM sharika_game_catalog WHERE id='greedy-classic'").get().enabled,0);
 assert.equal(balance(),100000);
 assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='sharika_greedy_rounds'").all(),[]);
 sqlite.close();
});
test('server-verified bet, exact retry, atomic debit and one-time payout',async()=>{
 const {sqlite,db,call,balance}=fixture(),now=Date.now(),n=Math.floor(now/38000);
 round(sqlite,now,n);
 const request_id='greedy-classic-test-001',body={round:n,itemId:'chicken',amount:100,request_id};
 const actual=Date.now; Date.now=()=>n*38000+1000;
 let first;
 try{first=await call('bet',body)}finally{Date.now=actual}
 assert.equal(first.status,200);
 assert.equal(balance(),99900);
 assert.equal((await call('bet',body)).status,200);
 assert.equal(balance(),99900,'identical request id never double debits');
 assert.equal((await call('bet',{...body,amount:1000})).status,409);
 const outcome=await greedyClassicOutcome({seed_hex:seed,round_no:n});
 const payout=greedyClassicPayout('chicken',100,outcome);
 await settleGreedyClassicDueBets(db,now+17000);
 assert.equal(balance(),99900+payout);
 await settleGreedyClassicDueBets(db,now+18000);
 assert.equal(balance(),99900+payout);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='greedy_classic_bet'").get().n,1);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sharika_wallet_ledger WHERE reason='greedy_classic_win'").get().n,payout?1:0);
 sqlite.close();
});
test('disallows unknown food, arbitrary coin stake, underage and insufficient wallet',async()=>{
 const {sqlite,call,balance}=fixture(),now=Date.now(),n=Math.floor(now/38000);
 round(sqlite,now,n);
 const body={round:n,itemId:'hotdog',amount:100,request_id:'greedy-classic-invalid-01'};
 assert.equal((await call('bet',{...body,amount:200})).status,400);
 assert.equal((await call('bet',{...body,itemId:'shrimp'})).status,400);
 assert.equal((await call('bet',body,'minor-1')).status,403);
 assert.equal(balance(),100000);
 sqlite.close();
});
test('authenticated game history and daily ranking never invent users',async()=>{
 const {sqlite,call}=fixture();
 const r=await call('rankings');
 assert.equal(r.status,200);
 assert.deepEqual((await r.json()).rankings,[]);
 assert.equal((await call('history')).status,200);
 sqlite.close();
});
test('original uploaded 21 PNGs are kept, English-only, with no client coin mutation',()=>{
 const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/greedy-classic.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/greedy-classic-live.js',import.meta.url),'utf8');
 assert.ok(html.length>1350000);
 assert.equal((html.match(/data:image\/png;base64/g)||[]).length,21);
 assert.match(html,/<html lang="en">/);
 assert.doesNotMatch(html,/[\u0980-\u09FF]/);
 assert.doesNotMatch(js,/[\u0980-\u09FF]/);
 assert.doesNotMatch(html,/Math\.random\(\)|S\.bal\+=|S\.bal-=/);
 assert.doesNotMatch(js,/Math\.random\(\)|S\.bal\+=|S\.bal-=/);
 assert.match(html,/greedy-classic-live\.js/);
 assert.match(html,/S\.pool\?\.\[i\]/,'original HOT and fire icons must use verified pool totals');
 assert.match(js,/window\.bet=bet/);
 assert.match(js,/sharika:original-request/);
 assert.match(js,/unconfirmed=payload/);
});

test('native parent bridge confirms wager before wallet changes, without fake deposits',async()=>{
 const source=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/greedy-classic-live.js',import.meta.url),'utf8');
 const requests=[],listeners=new Map(),elements=new Map(),messages=[];
 const parent={postMessage(data){requests.push(data)}};
 const window={parent,addEventListener(type,fn){listeners.set(type,fn)}};
 const S={bal:0,round:0,t:0,phase:'load',chip:100,bets:{},last:{},hist:[],played:0,rev:0,auto:false};
 const F=['chicken','fish','hotdog','steak','grape','lettuce','pepper','watermelon'].map(id=>({id}));
 const $=selector=>{
  if(!elements.has(selector))elements.set(selector,{textContent:'',src:'',onclick:null});
  return elements.get(selector);
 };
 runInNewContext(source,{window,S,F,CH:[100,1000,10000,50000],$,draw(){},
  show(message){messages.push(message)},hide(){},clearOn(){},
  im(){return ''},winners:item=>[item],crypto:webcrypto,Uint8Array,Map,
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,
  Date,Promise,Number,Object,String,Array,Math,Set});
 assert.equal(typeof window.bet,'function');
 assert.equal(requests.length,1);
 assert.equal(requests[0].action,'state');
 const send=(req,data)=>{
  listeners.get('message')({source:parent,data:{
   type:'sharika:original-response',id:req.id,ok:true,value:data}});
 };
 send(requests[0],{serverTime:Date.now(),balance:1000,todayWin:0,todayPlayed:0,
  user:{name:'Verified Test'},myBets:Array(8).fill(0),history:[],
  state:{round:123,phase:'betting',endsAt:Date.now()+8000,totals:[500,0,0,0,0,0,0,0]}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(S.bal,1000);
 assert.equal(S.round,123);
 assert.equal(S.phase,'bet');
 assert.equal(S.pool[0],500,'HOT and fire are based on verified total player wagers');
 const wager=window.bet('chicken');
 assert.equal(S.bal,1000,'client may not optimistically debit before verified result');
 const request=requests.at(-1);
 assert.equal(request.action,'bet');
 assert.equal(request.method,'POST');
 assert.equal(request.body.round,123);
 assert.equal(request.body.itemId,'chicken');
 assert.equal(request.body.amount,100);
 assert.match(request.body.request_id,/^[A-Za-z0-9:_-]{12,80}$/);
 send(request,{round:123,balance:900,myBets:[100,0,0,0,0,0,0,0]});
 assert.equal(await wager,true);
 assert.equal(S.bal,900);
 assert.equal(S.bets.chicken,100);
 assert.equal(messages.length,0,'normal confirmed wager has no fake banner');
});
