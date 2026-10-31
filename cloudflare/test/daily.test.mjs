import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDailyApp,handleDailyAdmin} from '../src/daily.mjs';
const NOW=new Date('2026-10-30T05:10:00.000Z');
const REWARDS=[100,150,200,300,400,600,1000];
const cors={},reply=(x,status)=>Response.json(x,{status}),
  fail=(error,status)=>Response.json({error},{status});
function fixture({status='active',last=null,coins=500,config=REWARDS,claims=3}={}){
  const state={batch:[],reads:[]};
  const DB={
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          state.reads.push({sql,args:this.args});
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))
            return {auth_uid:'alice',public_no:10000001,coins,status};
          if(sql.includes('FROM sharika_daily_reward_config'))
            return Object.fromEntries(config.map((v,i)=>['day'+(i+1),v]));
          if(sql.includes('FROM sharika_daily_task_config'))
            return {follow_coins:50,gift_coins:100};
          if(sql.includes('FROM sharika_daily_task_claims'))return null;
          if(sql.includes('FROM sharika_daily_checkins'))
            return last;
          if(sql.includes('FROM sharika_follows'))return {n:1};
          if(sql.includes('FROM sharika_gift_events'))return {n:0};
          if(sql.includes('SELECT coins FROM sharika_users'))return {coins:coins+100};
          if(sql.includes('COUNT(*) AS claims'))return {claims,total_coins:300};
          return null;
        },
        async all(){return {results:[]};}
      };
    },
    async batch(stmts){state.batch.push(stmts.map(s=>({sql:s.sql,args:s.args})));return stmts.map(()=>({success:true}));}
  };
  return {DB,state};
}
async function app(f,method,path,now=NOW){
  const request=new Request('https://test.invalid'+path,{method,body:method==='POST'?'{}':undefined});
  const result=await handleDailyApp({request,env:{DB:f.DB},uid:'alice',path,cors,reply,fail,now});
  return {status:result.status,data:await result.json()};
}
async function admin(f,role,method,payload){
  const request=new Request('https://test.invalid/api/v1/admin/daily',{method,
    body:payload?JSON.stringify(payload):undefined});
  const result=await handleDailyAdmin({request,env:{DB:f.DB},uid:'super1',
    actor:{role},operation:'daily',cors,reply,fail});
  return {status:result.status,data:await result.json()};
}

test('daily status shows verified UTC day, real wallet, and actual task counters',async()=>{
  const f=fixture();
  const x=await app(f,'GET','/api/v1/daily');
  assert.equal(x.status,200);
  assert.equal(x.data.utc_day,'2026-10-30');
  assert.equal(x.data.wallet_coins,500);
  assert.equal(x.data.next_day,1);
  assert.deepEqual(x.data.rewards,REWARDS);
  assert.equal(x.data.tasks[0].completed,true);
  assert.equal(x.data.tasks[1].completed,false);
  assert.equal(x.data.tasks[0].reward_enabled,true);
  assert.equal(x.data.tasks[0].reward_coins,50);
  assert.equal(x.data.tasks[0].claimed,false);
  assert.equal(x.data.next_reset_utc,'2026-10-31T00:00:00.000Z');
  assert.equal(x.data.invite_rewards_enabled,false);
  assert.equal(f.state.batch.length,0);
});
test('first daily claim atomically inserts unique receipt, credits wallet and immutable ledger',async()=>{
  const f=fixture();
  const x=await app(f,'POST','/api/v1/daily/check-in');
  assert.equal(x.status,201);
  assert.equal(x.data.claimed.streak,1);
  assert.equal(x.data.claimed.reward_coins,100);
  assert.equal(f.state.batch[0].length,3);
  assert.match(f.state.batch[0][0].sql,/sharika_daily_checkins/);
  assert.match(f.state.batch[0][1].sql,/UPDATE sharika_users SET coins/);
  assert.match(f.state.batch[0][2].sql,/sharika_wallet_ledger/);
  assert.equal(f.state.batch[0][2].args.at(-1),'daily:2026-10-30');
});
test('repeating a same-day claim cannot credit a second time',async()=>{
  const f=fixture({last:{utc_day:'2026-10-30',streak:2,reward_coins:150}});
  const x=await app(f,'POST','/api/v1/daily/check-in');
  assert.equal(x.status,200);
  assert.equal(x.data.duplicate,true);
  assert.equal(f.state.batch.length,0);
});
test('consecutive UTC day advances streak; missed day resets it',async()=>{
  const f=fixture({last:{utc_day:'2026-10-29',streak:1,reward_coins:100}});
  const x=await app(f,'POST','/api/v1/daily/check-in');
  assert.equal(x.data.claimed.streak,2);
  assert.equal(x.data.claimed.reward_coins,150);
  const missed=fixture({last:{utc_day:'2026-10-27',streak:6,reward_coins:600}});
  const y=await app(missed,'POST','/api/v1/daily/check-in');
  assert.equal(y.data.claimed.streak,1);
});
test('blocked profile cannot read or claim daily rewards',async()=>{
  const f=fixture({status:'blocked'});
  assert.equal((await app(f,'GET','/api/v1/daily')).status,403);
  assert.equal((await app(f,'POST','/api/v1/daily/check-in')).status,403);
  assert.equal(f.state.batch.length,0);
});
test('finance is read-only and support cannot inspect rewards',async()=>{
  const f=fixture();
  assert.equal((await admin(f,'finance','GET')).status,200);
  assert.equal((await admin(f,'finance','PATCH',{rewards:REWARDS})).status,403);
  assert.equal((await admin(f,'support','GET')).status,403);
  assert.equal(f.state.batch.length,0);
});
test('only super admin may update 7 bounded rewards with an audit record',async()=>{
  const f=fixture();
  assert.equal((await admin(f,'super','PATCH',{rewards:[150,200,250,300,350,400,450]})).status,200);
  assert.equal(f.state.batch[0].length,2);
  assert.match(f.state.batch[0][1].sql,/sharika_daily_config_audit/);
});
test('daily config rejects invalid reward amounts without writes',async()=>{
  const f=fixture();
  const x=await admin(f,'super','PATCH',{rewards:[100,150,200,300,400,600,100000]});
  assert.equal(x.status,400);
  assert.equal(f.state.batch.length,0);
});
