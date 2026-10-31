import test from 'node:test';
import assert from 'node:assert/strict';
import {validEventPayload,handleEventAdmin,handleEventApp,listEventData} from '../src/events.mjs';

const reply=(data,status=200)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
const eventPayload={
  title:'Weekend Gift Race',kind:'gift_race',description:'Top gifters win verified coins',
  starts_at:'2026-10-28T00:00:00.000Z',ends_at:'2026-11-03T00:00:00.000Z',
  status:'published',prizes:[10000,5000,2500]
};
function fixture({event=null,oldAward=null,recipient=null}={}){
  const state={queries:[],batches:[]};
  const db={
    prepare(sql){
      return {sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('FROM sharika_events WHERE id'))return event;
          if(sql.includes('FROM sharika_event_awards a')&&sql.includes('a.rank=?'))
            return oldAward;
          if(sql.includes('FROM sharika_event_awards WHERE event_id=?'))
            return null;
          if(sql.includes('FROM sharika_users WHERE public_no=?'))
            return recipient;
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))
            return {public_no:10000001};
          return null;
        },
        async all(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('FROM sharika_events'))return {results:[]};
          return {results:[]};
        }
      };
    },
    async batch(statements){
      state.batches.push(statements.map(s=>({sql:s.sql,args:s.args})));
      return [{meta:{last_row_id:7}}];
    }
  };
  return {db,state};
}
async function admin(f,operation,method,body,role='super'){
  const request=new Request('https://staging.invalid/api/v1/admin/'+operation,{
    method,body:body===undefined?undefined:JSON.stringify(body)
  });
  const response=await handleEventAdmin({request,env:{DB:f.db},uid:'admin',actor:{role},
    operation,cors:{},reply,fail});
  return {status:response.status,data:await response.json()};
}
test('valid event requires truthful UTC window and integer coin tiers',()=>{
  assert.equal(validEventPayload(eventPayload),true);
  assert.equal(validEventPayload({...eventPayload,prizes:[0,0,0]}),false);
  assert.equal(validEventPayload({...eventPayload,prizes:[1,-1,2]}),false);
  assert.equal(validEventPayload({...eventPayload,prizes:[1,2,1.5]}),false);
  assert.equal(validEventPayload({...eventPayload,ends_at:eventPayload.starts_at}),false);
  assert.equal(validEventPayload({...eventPayload,status:'live'}),false);
  assert.equal(validEventPayload({...eventPayload,kind:'casino_jackpot'}),false);
});
test('support staff cannot read events and finance cannot create payouts',async()=>{
  const f=fixture();
  assert.equal((await admin(f,'events','GET',undefined,'support')).status,403);
  assert.equal((await admin(f,'events','POST',eventPayload,'finance')).status,403);
  assert.equal(f.state.batches.length,0);
});
test('invalid event forms cannot write any D1 records',async()=>{
  const f=fixture();
  const result=await admin(f,'events','POST',{...eventPayload,prizes:[99999999,2,3]});
  assert.equal(result.data.error,'invalid_event_fields');
  assert.equal(f.state.batches.length,0);
});
test('Super Admin can create scheduled event without rewarding any user',async()=>{
  const f=fixture();
  const result=await admin(f,'events','POST',eventPayload);
  assert.equal(result.status,201);
  assert.equal(f.state.batches.length,1);
  assert.equal(f.state.batches[0].length,2);
  assert.match(f.state.batches[0][0].sql,/INSERT INTO sharika_events/);
  assert.ok(!f.state.batches[0].some(s=>s.sql.includes('UPDATE sharika_users')));
});
test('prizes cannot be credited until the event ends',async()=>{
  const f=fixture({event:{id:1,status:'published',ends_at:'2099-01-01T00:00:00.000Z',
    prize_1:500,prize_2:200,prize_3:100}});
  const r=await admin(f,'events/1/award','POST',{
    rank:1,public_id:'10000001',request_id:'test-event-award-001'});
  assert.equal(r.data.error,'event_not_ended');
  assert.equal(f.state.batches.length,0);
});
test('retry for same rank and ID returns existing receipt without new coins',async()=>{
  const f=fixture({event:{id:1,status:'published',ends_at:'2025-01-01T00:00:00.000Z',
    prize_1:500,prize_2:200,prize_3:100},
    oldAward:{id:42,public_no:10000001,coins:500}});
  const r=await admin(f,'events/1/award','POST',{
    rank:1,public_id:'10000001',request_id:'test-event-award-001'});
  assert.equal(r.data.duplicate,true);
  assert.equal(f.state.batches.length,0);
});
test('new paid award writes receipt, wallet update, immutable ledger, admin audit in one D1 batch',async()=>{
  const f=fixture({event:{id:1,status:'published',ends_at:'2025-01-01T00:00:00.000Z',
    prize_1:500,prize_2:200,prize_3:100},
    recipient:{auth_uid:'winner',coins:120}});
  const r=await admin(f,'events/1/award','POST',{
    rank:1,public_id:'10000001',request_id:'test-event-award-001'});
  assert.equal(r.status,201);
  assert.equal(f.state.batches.length,1);
  assert.equal(f.state.batches[0].length,4);
  assert.match(f.state.batches[0][0].sql,/INSERT INTO sharika_event_awards/);
  assert.match(f.state.batches[0][1].sql,/UPDATE sharika_users/);
  assert.match(f.state.batches[0][2].sql,/INSERT INTO sharika_wallet_ledger/);
  assert.match(f.state.batches[0][3].sql,/event_prize_awarded/);
});
test('app GET lists only published public events while writes are denied',async()=>{
  const f=fixture();
  const data=await listEventData(f.db,false);
  assert.deepEqual(data.events,[]);
  const statement=f.state.queries.find(x=>x.sql.includes('FROM sharika_events'));
  assert.match(statement.sql,/WHERE status=\? AND ends_at>=\?/);
  const response=await handleEventApp({request:new Request('https://x.invalid/api/v1/events',{
    method:'POST'}),env:{DB:f.db},uid:'winner',path:'/api/v1/events',cors:{},reply,fail});
  assert.equal(response.status,405);
});
