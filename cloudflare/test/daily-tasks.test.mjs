import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyTaskStatus,claimDailyTask,taskConfig,dailyTaskAdminStatus,saveDailyTaskConfig
} from '../src/daily-tasks.mjs';

const NOW=new Date('2026-10-30T23:58:00Z');
const reply=(data,status=200)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
function fixture({follow=1,gift=0,receipt=null,coins=500,taskRewards={follow:50,gift:100},
  failBatch=false}={}){
  const state={batches:[],queries:[],receipts:receipt?{[receipt.task_key]:receipt}:{}};
  const db={
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('FROM sharika_daily_task_config'))
            return {follow_coins:taskRewards.follow,gift_coins:taskRewards.gift};
          if(sql.includes('FROM sharika_follows'))return {n:follow};
          if(sql.includes('FROM sharika_gift_events'))return {n:gift};
          if(sql.includes('FROM sharika_daily_task_claims'))
            return state.receipts[this.args[2]]||null;
          if(sql.includes('SELECT coins FROM sharika_users'))return {coins:coins+50};
          if(sql.includes('COUNT(*) AS claims'))return {claims:0,coins:0};
          return null;
        },
        async all(){
          return {results:Object.values(state.receipts)};
        }
      };
    },
    async batch(stmts){
      state.batches.push(stmts.map(stmt=>({sql:stmt.sql,args:stmt.args})));
      if(failBatch){
        state.receipts.follow={task_key:'follow',reward_coins:50};
        throw new Error('UNIQUE constraint failed');
      }
      return stmts.map(()=>({success:true}));
    }
  };
  return {db,state};
}
async function claim(f,key,now=NOW){
  const request=new Request('https://test.invalid/api/v1/daily/tasks/claim',{
    method:'POST',body:JSON.stringify({task_key:key})
  });
  const response=await claimDailyTask({request,env:{DB:f.db},uid:'alice',
    now,user:{coins:500},cors:{},reply,fail});
  return {status:response.status,data:await response.json()};
}
test('task progress and claimed status reset at UTC midnight, not localStorage',async()=>{
  const f=fixture({follow:1,gift:0,receipt:{task_key:'follow',reward_coins:50}});
  const before=await dailyTaskStatus(f.db,'alice',NOW);
  assert.equal(before.tasks[0].completed,true);
  assert.equal(before.tasks[0].claimed,true);
  assert.equal(before.tasks[1].completed,false);
  assert.equal(before.tasks[1].claimed,false);
  assert.equal(before.next_reset_utc,'2026-10-31T00:00:00.000Z');
  const dayFilter=f.state.queries.find(x=>x.sql.includes('FROM sharika_daily_task_claims'));
  assert.deepEqual(dayFilter.args,['alice','2026-10-30']);
  const followingDay=new Date('2026-10-31T00:02:00Z');
  await dailyTaskStatus(f.db,'alice',followingDay);
  const nextQuery=f.state.queries.filter(x=>x.sql.includes('FROM sharika_follows')).at(-1);
  assert.deepEqual(nextQuery.args,['alice','2026-10-31 00:00:00','2026-11-01 00:00:00']);
});
test('only a verified completed task can claim its coins',async()=>{
  const f=fixture({follow:0,gift:0});
  const result=await claim(f,'follow');
  assert.equal(result.status,409);
  assert.equal(result.data.error,'daily_task_not_completed');
  assert.equal(f.state.batches.length,0);
});
test('claim inserts immutable daily receipt, updates wallet, and creates unique ledger request',async()=>{
  const f=fixture({follow:1});
  const result=await claim(f,'follow');
  assert.equal(result.status,201);
  assert.equal(result.data.reward_coins,50);
  assert.equal(result.data.task_key,'follow');
  const batch=f.state.batches[0];
  assert.equal(batch.length,3);
  assert.match(batch[0].sql,/INSERT INTO sharika_daily_task_claims/);
  assert.deepEqual(batch[0].args,['alice','2026-10-30','follow',50]);
  assert.match(batch[1].sql,/UPDATE sharika_users SET coins/);
  assert.match(batch[2].sql,/sharika_wallet_ledger/);
  assert.equal(batch[2].args.at(-1),'daily-task:2026-10-30:follow');
});
test('same day claim is idempotent and does not generate a second credit',async()=>{
  const f=fixture({receipt:{task_key:'follow',reward_coins:50}});
  const result=await claim(f,'follow');
  assert.equal(result.status,200);
  assert.equal(result.data.duplicate,true);
  assert.equal(f.state.batches.length,0);
});
test('racing claim that already committed returns its receipt safely',async()=>{
  const f=fixture({failBatch:true});
  const result=await claim(f,'follow');
  assert.equal(result.status,200);
  assert.equal(result.data.duplicate,true);
  assert.equal(f.state.batches.length,1);
});
test('each verified gift to another user unlocks the gift task; self gifts never do',async()=>{
  const f=fixture({follow:0,gift:1});
  const result=await claim(f,'gift');
  assert.equal(result.status,201);
  assert.equal(result.data.reward_coins,100);
  assert.equal(f.state.queries.some(x=>x.sql.includes('sender_uid<>recipient_uid')),true);
});
test('admin changes task rewards with immutable audit; invalid rates are rejected',async()=>{
  const f=fixture();
  assert.deepEqual(await taskConfig(f.db),{follow:50,gift:100});
  await saveDailyTaskConfig(f.db,'super_admin',{follow:75,gift:125});
  assert.equal(f.state.batches[0].length,2);
  assert.match(f.state.batches[0][1].sql,/sharika_daily_task_config_audit/);
  await assert.rejects(()=>saveDailyTaskConfig(f.db,'super_admin',{follow:-1,gift:125}),
    /invalid_daily_task_rewards/);
  assert.equal(f.state.batches.length,1);
  const admin=await dailyTaskAdminStatus(f.db,NOW);
  assert.equal(admin.task_rewards.follow,50);
});
