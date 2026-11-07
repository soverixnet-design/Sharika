import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGreedyRequest} from '../src/greedy-wheel.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0027_greedy_wheel.sql',import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
    .run(10000001,'adult-1','QA Adult','1990-01-01',0,100000);
  const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];
    return {bind(...v){args=v;return this;},async first(){return stmt.get(...args)||null;},
      async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};}};
  }};
  const state=()=>handleGreedyRequest({request:new Request('https://qa.test/api/v1/greedy-wheel/state'),
    db,uid:'adult-1',action:'state',reply:(d,s)=>Response.json(d,{status:s}),
    fail:(error,s)=>Response.json({error},{status:s}),cors:{}});
  return {sqlite,state};
}

test('Greedy today revenue is daily gross settled payouts without stake subtraction',async()=>{
  const {sqlite,state}=database();
  const initial=await (await state()).json();
  // The wall clock can be in the closed/spinning portion of a 41s round.
  // Use a separate, valid open test round to keep this test deterministic.
  const n=initial.state.round+9999,now=Date.now();
  sqlite.prepare('INSERT INTO sharika_greedy_rounds '+
    '(id,round_no,starts_ms,bet_closes_ms,settles_ms,ends_ms,seed_hex,commit_sha256) '+
    'VALUES(?,?,?,?,?,?,?,?)').run('greedy:daily-test',n,now-1000,now+15000,
      now+21000,now+25000,'0'.repeat(64),'1'.repeat(64));
  const add=sqlite.prepare('INSERT INTO sharika_greedy_bets '+
    '(round_id,round_no,user_uid,item_id,amount,request_id) VALUES(?,?,?,?,?,?)');
  add.run('greedy:daily-test',n,'adult-1','corn',1000,'daily-gross-win-000001');
  add.run('greedy:daily-test',n,'adult-1','fish',1000,'daily-gross-loss-000002');
  add.run('greedy:daily-test',n,'adult-1','steak',1000,'daily-gross-yesterday-000003');
  sqlite.prepare("UPDATE sharika_greedy_bets SET status='settled',result_id='corn',payout=5000,"+
    "settled_at=datetime('now') WHERE request_id='daily-gross-win-000001'").run();
  sqlite.prepare("UPDATE sharika_greedy_bets SET status='settled',result_id='corn',payout=0,"+
    "settled_at=datetime('now') WHERE request_id='daily-gross-loss-000002'").run();
  sqlite.prepare("UPDATE sharika_greedy_bets SET status='settled',result_id='corn',payout=120000,"+
    "settled_at=datetime('now','-1 day') WHERE request_id='daily-gross-yesterday-000003'").run();
  const today=await (await state()).json();
  assert.equal(today.todayDay,new Date().toISOString().slice(0,10));
  assert.equal(today.todayWin,5000);
  assert.equal(today.balance,100000-3000+5000+120000);
  sqlite.close();
});
