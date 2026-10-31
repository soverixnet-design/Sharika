import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_SCOPES, lookupStaffActor, staffProxyRole,
  handleStaffAdmin } from '../src/staff.mjs';

const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
function mock({
  staff={active:1,login_email:'helper@example.test',display_name:'Helper',
    permissions_json:'["view_users","coin_recharge"]',daily_coin_limit:5000},
  target={auth_uid:'recipient-uid',coins:100,status:'active'},
  existing=null,account=null
}={}) {
  const state={queries:[],batches:[]};
  const DB={
    prepare(sql){
      const stmt={sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('FROM sharika_admin_staff_accounts WHERE auth_uid=? OR login_email=?'))
            return null;
          if(sql.includes('FROM sharika_admin_staff_accounts WHERE auth_uid=?'))
            return staff;
          if(sql.includes('FROM sharika_admin_direct_recharges g ')&&
             sql.includes('WHERE g.actor_uid=?'))return existing;
          if(sql.includes('FROM sharika_users WHERE public_no=?'))return target;
          if(sql.includes('FROM sharika_admin_roles WHERE auth_uid=?'))return account;
          if(sql.includes('FROM sharika_admin_staff_accounts WHERE id=?'))
            return {id:7,login_email:'helper@example.test'};
          if(sql.includes('SELECT id,balance_after FROM sharika_admin_direct_recharges'))
            return {id:44,balance_after:300};
          return null;
        },
        async all(){state.queries.push({sql,args:this.args});return {results:[]};}
      };
      return stmt;
    },
    async batch(items){
      state.batches.push(items.map(s=>({sql:s.sql,args:s.args})));
      return items.map(()=>({meta:{last_row_id:7,changes:1}}));
    }
  };
  return {DB,state};
}
async function run(DB,actor,operation,method='GET',body,extra={}) {
  const request=new Request('https://staging.test/api/v1/admin/'+operation,{
    method,headers:body?{'content-type':'application/json'}:{},
    body:body?JSON.stringify(body):undefined
  });
  const response=await handleStaffAdmin({
    request,env:{DB,FIREBASE_PROJECT_ID:'sharika-voice-chat-app'},
    uid:actor.role==='staff'?'firebase:sharika-voice-chat-app:staff-id':'firebase:sharika-voice-chat-app:super-id',
    actor,operation,cors:{},reply,fail,...extra
  });
  return {status:response.status,data:await response.json()};
}
const staffActor={role:'staff',active:true,permissions:['view_users','coin_recharge'],daily_coin_limit:5000};
const grant={target_public_id:'10000017',coins:200,reason:'Promotional trial reward',
  request_id:'staff-manual-grant-0001'};

test('scoped staff can only access exact permitted routes and methods',()=>{
  assert.ok(STAFF_SCOPES.includes('coin_recharge'));
  assert.equal(staffProxyRole(staffActor,'GET','users'),'super');
  assert.equal(staffProxyRole(staffActor,'GET','ledger'),null);
  assert.equal(staffProxyRole(staffActor,'POST','users/10000017/status'),null);
  assert.equal(staffProxyRole(staffActor,'POST','sellers/allocate'),null);
  assert.equal(staffProxyRole({...staffActor,permissions:['support_reply']},
    'POST','support/10000017/reply'),'support');
  assert.equal(staffProxyRole({...staffActor,active:false},'GET','users'),null);
});

test('staff Firebase role requires active database record and recognized permission JSON',async()=>{
  const {DB}=mock();
  const actor=await lookupStaffActor(DB,'firebase:sharika-voice-chat-app:staff-id');
  assert.equal(actor.role,'staff');
  assert.deepEqual(actor.permissions,['view_users','coin_recharge']);
  assert.equal((await lookupStaffActor(mock({staff:{active:0}}).DB,'uid')),null);
  assert.equal((await lookupStaffActor(mock({staff:{active:1,permissions_json:'["super"]'}}).DB,'uid')),null);
});

test('super can create a Firebase-verified restricted staff record without storing password',async()=>{
  const {DB,state}=mock();
  const data={name:'Support Helper',email:'helper@example.test',
    new_staff_id_token:'a'.repeat(220),permissions:['view_users'],
    daily_coin_limit:0};
  const result=await run(DB,{role:'super'},'staff','POST',data,{
    verifyNewStaffToken:async()=>({uid:'firebase:sharika-voice-chat-app:new-staff',
      email:'helper@example.test',verified:false})
  });
  assert.equal(result.status,201);
  assert.equal(result.data.requires_email_verification,true);
  assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].length,2);
  assert.match(state.batches[0][0].sql,/INSERT INTO sharika_admin_staff_accounts/);
  assert.equal(JSON.stringify(state.batches).includes(data.new_staff_id_token),false);
  const denied=await run(DB,{role:'staff',active:true,permissions:['coin_recharge']},
    'staff','GET');
  assert.equal(denied.status,403);
});

test('staff account creation rejects mismatched Firebase identity proof',async()=>{
  const {DB,state}=mock();
  const r=await run(DB,{role:'super'},'staff','POST',{
    name:'Helper',email:'helper@example.test',new_staff_id_token:'a'.repeat(220),
    permissions:[],daily_coin_limit:0
  },{verifyNewStaffToken:async()=>({uid:'firebase:sharika-voice-chat-app:other',
    email:'different@example.test'})});
  assert.equal(r.status,403);
  assert.equal(state.batches.length,0);
});

test('direct staff grant atomically updates real wallet and immutable audit once',async()=>{
  const {DB,state}=mock();
  const result=await run(DB,staffActor,'recharge-user','POST',grant);
  assert.equal(result.status,201);
  assert.equal(result.data.transaction_id,44);
  assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].length,3);
  assert.match(state.batches[0][0].sql,/UPDATE sharika_users SET coins=/);
  assert.match(state.batches[0][1].sql,/INSERT INTO sharika_admin_direct_recharges/);
  assert.match(state.batches[0][2].sql,/INSERT INTO sharika_wallet_ledger/);
  assert.ok(state.batches[0][2].args.at(-1).includes(grant.request_id));
  assert.equal(JSON.stringify(state.batches).includes('password'),false);
});

test('duplicate direct credit is read-only and amount changes are rejected',async()=>{
  const saved={id:44,coins:200,reason:grant.reason,public_no:10000017,balance_after:300};
  const {DB,state}=mock({existing:saved});
  const duplicate=await run(DB,staffActor,'recharge-user','POST',grant);
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.data.duplicate,true);
  assert.equal(state.batches.length,0);
  const conflict=await run(DB,staffActor,'recharge-user','POST',{...grant,coins:201});
  assert.equal(conflict.status,409);
  assert.equal(state.batches.length,0);
});

test('staff cannot recharge without permission or exceed their configured request cap',async()=>{
  const {DB,state}=mock();
  const denied=await run(DB,{...staffActor,permissions:['view_users']},
    'recharge-user','POST',grant);
  assert.equal(denied.status,403);
  const tooMany=await run(DB,{...staffActor,daily_coin_limit:100},
    'recharge-user','POST',grant);
  assert.equal(tooMany.status,409);
  assert.equal(state.batches.length,0);
});
