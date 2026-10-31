import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {greedyOutcome,greedyPayout,settleGreedyDueBets,handleGreedyRequest} from '../src/greedy-wheel.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const seed='0123456789abcdef'.repeat(4);
function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0027_greedy_wheel.sql',import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(10000001,'adult-1','Verified Adult','1990-01-01',0,100000);
  return {
    sqlite,
    db:{prepare(sql){
      const stmt=sqlite.prepare(sql);
      let args=[];
      return {
        bind(...values){args=values;return this;},
        async first(){return stmt.get(...args)||null;},
        async all(){return {results:stmt.all(...args)};},
        async run(){return {meta:stmt.run(...args)};}
      };
    }}
  };
}
function round(sqlite,number,now){
  sqlite.prepare('INSERT INTO sharika_greedy_rounds '+
    '(id,round_no,starts_ms,bet_closes_ms,settles_ms,ends_ms,seed_hex,commit_sha256) '+
    'VALUES(?,?,?,?,?,?,?,?)').run('greedy:'+number,number,now-1000,now+15000,
    now+25000,now+30000,seed,createHash('sha256').update(seed).digest('hex'));
}

test('Greedy outcomes are deterministic and specials pay the source multipliers',async()=>{
  const example={seed_hex:seed,round_no:1234};
  const a=await greedyOutcome(example),b=await greedyOutcome(example);
  assert.equal(a,b);
  assert.ok(['shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato','salad','pizza'].includes(a));
  assert.equal(greedyPayout('shrimp',100,'pizza'),1000);
  assert.equal(greedyPayout('fish',100,'pizza'),1500);
  assert.equal(greedyPayout('chicken',100,'pizza'),2500);
  assert.equal(greedyPayout('steak',100,'pizza'),4500);
  assert.equal(greedyPayout('tomato',100,'salad'),500);
  assert.equal(greedyPayout('shrimp',100,'salad'),0);
  assert.equal(greedyPayout('steak',100,'shrimp'),0);
});

test('D1 migration debits once, rejects insufficient funds, and settles once',async()=>{
  const {sqlite,db}=database(),now=Date.now();
  round(sqlite,78,now);
  const add=sqlite.prepare('INSERT INTO sharika_greedy_bets '+
    '(round_id,round_no,user_uid,item_id,amount,request_id) VALUES(?,?,?,?,?,?)');
  add.run('greedy:78',78,'adult-1','shrimp',1000,'greedy-test-request-000001');
  assert.equal(sqlite.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-1'").get().coins,99000);
  assert.throws(()=>add.run('greedy:78',78,'adult-1','shrimp',1000,'greedy-test-request-000001'));
  assert.throws(()=>add.run('greedy:78',78,'adult-1','fish',100000,'greedy-test-request-000002'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,1);
  // Settlement test with the saved commitment's actual deterministic outcome.
  const result=await greedyOutcome({seed_hex:seed,round_no:78});
  const payout=greedyPayout('shrimp',1000,result);
  sqlite.prepare("UPDATE sharika_greedy_bets SET status='settled',payout=?,result_id=?,settled_at=datetime('now') WHERE id=1 AND status='accepted'")
    .run(payout,result);
  assert.equal(sqlite.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').get('adult-1').coins,99000+payout);
  sqlite.prepare("UPDATE sharika_greedy_bets SET status='settled' WHERE id=1 AND status='accepted'").run();
  assert.equal(sqlite.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').get('adult-1').coins,99000+payout);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,payout?2:1);
  await settleGreedyDueBets(db,now);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sharika_greedy_bets').get().n,1);
  sqlite.close();
});

test('Greedy bet replay has stable idempotency and altered replay is rejected',async()=>{
  const {sqlite,db}=database(),now=Date.now();
  const n=Math.floor(now/41000);
  round(sqlite,n,now);
  sqlite.prepare('INSERT INTO sharika_greedy_bets '+
    '(round_id,round_no,user_uid,item_id,amount,request_id) VALUES(?,?,?,?,?,?)')
    .run('greedy:'+n,n,'adult-1','corn',1000,'greedy-replay-same-000001');
  const reply=(data,status)=>Response.json(data,{status});
  const fail=(error,status)=>Response.json({error},{status});
  const request=body=>handleGreedyRequest({
    request:new Request('https://sharika.test/api/v1/greedy-wheel/bet',{
      method:'POST',body:JSON.stringify(body)}),db,uid:'adult-1',action:'bet',reply,fail,cors:{}
  });
  const input={round:n,itemId:'corn',amount:1000,request_id:'greedy-replay-same-000001'};
  const first=await request(input);
  assert.equal(first.status,200);
  assert.equal((await first.json()).duplicate,true);
  const conflict=await request({...input,amount:2000});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).error,'idempotency_conflict');
  assert.equal(sqlite.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').get('adult-1').coins,99000);
  sqlite.close();
});

test('verified adult state uses the server wallet and never exposes seed during betting',async()=>{
  const {sqlite,db}=database();
  const reply=(data,status)=>Response.json(data,{status});
  const fail=(error,status)=>Response.json({error},{status});
  const res=await handleGreedyRequest({
    request:new Request('https://sharika.test/api/v1/greedy-wheel/state'),
    db,uid:'adult-1',action:'state',reply,fail,cors:{}
  });
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.balance,100000);
  assert.equal(data.user.id,'10000001');
  assert.deepEqual(data.config.chips,[1000,10000,100000,1000000,10000000]);
  assert.equal(data.myBets.length,8);
  assert.equal(data.state.totals.length,8);
  if(data.state.phase==='betting'){
    assert.equal(data.result,undefined);
    assert.equal(data.state.resultId,undefined);
  }else if(data.state.phase==='result'){
    const commit=createHash('sha256').update(data.result.seed).digest('hex');
    assert.equal(data.result.hash,commit);
  }
  sqlite.close();
});

test('Android iframe always uses authenticated parent bridge, not fake local money',()=>{
  const root=new URL('../../android-staging/app/src/main/assets/greedy-wheel/',import.meta.url);
  const html=readFileSync(new URL('index.html',root),'utf8');
  const bridge=readFileSync(new URL('sharika-bridge.js',root),'utf8');
  const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(html,/sharika-bridge\.js/);
  assert.doesNotMatch(html,/__PORT_8080__/);
  assert.match(bridge,/sharika:greedy-request/);
  assert.match(bridge,/crypto\.getRandomValues/);
  assert.match(adapter,/current\.item\.id==='greedy-wheel'/);
  assert.match(adapter,/\/greedy-wheel\/.*data\.action/);
});

test('opening Greedy mid-result shows the already settled outcome immediately',async()=>{
  const root=new URL('../../android-staging/app/src/main/assets/greedy-wheel/',import.meta.url);
  const bridge=readFileSync(new URL('sharika-bridge.js',root),'utf8');
  const listeners=new Map(),queued=[];
  let request;
  const parent={postMessage(message){request=message;}};
  const window={WebSocket:class NativeWebSocket{},parent,
    addEventListener(name,callback){listeners.set(name,callback);}};
  runInNewContext(bridge,{window,crypto:webcrypto,Uint8Array,
    setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{},
    queueMicrotask:callback=>queued.push(callback)});
  const socket=new window.WebSocket('wss://sharika-greedy.invalid/ws?demo=1');
  const seen=[];
  socket.onmessage=event=>seen.push(JSON.parse(event.data));
  queued.shift()();
  assert.equal(request.action,'state');
  const now=Date.now();
  listeners.get('message')({source:parent,data:{type:'sharika:greedy-response',
    id:request.id,ok:true,value:{serverTime:now,balance:1234,
      user:{id:'10000001',name:'Adult'},config:{chips:[1000]},history:[],
      myBets:Array(8).fill(0),state:{round:44,phase:'result',
        endsAt:now+1000,totals:Array(8).fill(0),resultId:'corn'},
      result:{round:44,resultId:'corn',endsAt:now+1000,
        you:{bet:1000,win:5000,balance:1234},top:[]}}
  }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen.map(x=>x.t),['hello','result']);
  assert.equal(seen[1].you.win,5000);
  socket.close();
});

test('packaged Greedy sheet cannot fall back to fake demo coins when bridge is missing',()=>{
  const source=readFileSync(new URL('../../android-staging/app/src/main/assets/greedy-wheel/game.js',import.meta.url),'utf8');
  const guard=source.indexOf("else if (qs.get('sheet') === '1')");
  assert.ok(guard>0);
  const branch=source.slice(guard,source.indexOf('} else {',guard));
  assert.match(branch,/S\.balance = 0/);
  assert.doesNotMatch(branch,/demoStartBetting/);
});
