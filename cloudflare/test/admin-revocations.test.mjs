import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStaffAdmin} from '../src/staff.mjs';
import {handleCosmeticAdmin} from '../src/cosmetics.mjs';

const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});
const superUid='firebase:sharika-voice-chat-app:verified-super';
const memberUid='firebase:sharika-voice-chat-app:existing-member';

function dbMock({debitReceipt=null,inventorySource='admin_grant',balance=500}={}){
  const state={batch:null,queries:[],applied:false};
  const db={
    prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
      async first(){
        state.queries.push({sql,args:this.args});
        if(sql.includes('FROM sharika_users WHERE public_no=?'))return {
          auth_uid:memberUid,public_no:10000017,name:'Existing Member',coins:balance,status:'active'
        };
        if(sql.includes('FROM sharika_admin_roles WHERE auth_uid=?'))return null;
        if(sql.includes('FROM sharika_admin_staff_accounts WHERE auth_uid=?'))return null;
        if(sql.includes('FROM sharika_admin_coin_adjustments a JOIN sharika_users'))
          return debitReceipt||(state.applied?{id:79,public_no:10000017,coins:200,
            reason:'Correct an accidental credit',balance_after:300}:null);
        if(sql.includes('FROM sharika_cosmetic_inventory i JOIN sharika_cosmetics_catalog'))
          return inventorySource?{source:inventorySource,kind:'frame_style',name:'Gold Crown'}:null;
        return null;
      },
      async all(){state.queries.push({sql,args:this.args});return {results:[]};},
      async run(){state.queries.push({sql,args:this.args});return {meta:{changes:1}};}
    };},
    async batch(statements){
      state.batch=statements.map(s=>({sql:s.sql,args:s.args}));
      state.applied=true;
      return statements.map(()=>({meta:{last_row_id:23,changes:1}}));
    }
  };
  return {db,state};
}

async function staff(db,role,operation,method='POST',body={}){
  const request=new Request('https://example.test/api/v1/admin/'+operation,{
    method,headers:{'content-type':'application/json'},
    body:method==='GET'?undefined:JSON.stringify(body)
  });
  const response=await handleStaffAdmin({request,env:{DB:db},uid:superUid,
    actor:{role},operation,cors:{},reply,fail});
  return {status:response.status,data:await response.json()};
}

test('only Super Admin grants existing member narrowly scoped panel permissions',async()=>{
  const {db,state}=dbMock();
  const body={target_public_id:'10000017',permissions:['view_users'],daily_coin_limit:0};
  assert.equal((await staff(db,'staff','staff/existing','POST',body)).status,403);
  assert.equal(state.batch,null);
  const result=await staff(db,'super','staff/existing','POST',body);
  assert.equal(result.status,201);
  assert.equal(result.data.login_with_existing_account,true);
  assert.equal(state.batch.length,2);
  assert.match(state.batch[0].sql,/INSERT INTO sharika_admin_staff_accounts/);
  assert.equal(state.batch[0].args[0],memberUid);
  assert.equal(state.batch[0].args[3],'["view_users"]');
  assert.equal(state.batch[0].args[4],0);
  assert.equal(state.batch[0].args.some(a=>String(a).includes('password')),false);
});

test('coin subtraction writes immutable negative ledger and receipt atomically',async()=>{
  const {db,state}=dbMock();
  const body={target_public_id:'10000017',coins:200,
    reason:'Correct an accidental credit',request_id:'admin-debit-request-0001'};
  assert.equal((await staff(db,'finance','coin-adjustments','POST',body)).status,403);
  assert.equal(state.batch,null);
  const result=await staff(db,'super','coin-adjustments','POST',body);
  assert.equal(result.status,201);
  assert.equal(result.data.balance_after,300);
  assert.equal(state.batch.length,4);
  assert.match(state.batch[0].sql,/coins=CASE WHEN status='active' AND coins>=\?/);
  assert.match(state.batch[1].sql,/INSERT INTO sharika_admin_coin_adjustments/);
  assert.match(state.batch[2].sql,/INSERT INTO sharika_wallet_ledger/);
  assert.equal(state.batch[2].args[1],-200);
  assert.match(state.batch[3].sql,/INSERT INTO sharika_admin_audit/);
});

test('debit is idempotent, and insufficient coins cannot enter a batch',async()=>{
  const body={target_public_id:'10000017',coins:200,
    reason:'Correct an accidental credit',request_id:'admin-debit-request-0001'};
  const original={id:22,public_no:10000017,coins:200,
    reason:body.reason,balance_after:300};
  const repeated=dbMock({debitReceipt:original});
  const same=await staff(repeated.db,'super','coin-adjustments','POST',body);
  assert.equal(same.status,200);assert.equal(same.data.duplicate,true);
  assert.equal(repeated.state.batch,null);
  assert.equal((await staff(repeated.db,'super','coin-adjustments','POST',
    {...body,coins:201})).status,409);
  const insufficient=dbMock({balance:10});
  const denied=await staff(insufficient.db,'super','coin-adjustments','POST',body);
  assert.equal(denied.status,409);
  assert.equal(denied.data.error,'recipient_balance_insufficient');
  assert.equal(insufficient.state.batch,null);
});

async function cosmetic(db,role,kind,body){
  const request=new Request('https://example.test/api/v1/admin/cosmetics/'+kind,{
    method:'POST',body:JSON.stringify(body)});
  const response=await handleCosmeticAdmin({request,db,uid:superUid,role,
    path:'/api/v1/admin/cosmetics/'+kind,readBody:request=>request.json(),
    reply,fail,cors:{}});
  return {status:response.status,data:await response.json()};
}

test('Super Admin can revoke an admin-granted item but never a paid purchase',async()=>{
  const body={public_id:'10000017',item_id:'frame_style:gold',
    reason:'Incorrect gift assignment'};
  const {db,state}=dbMock();
  assert.equal((await cosmetic(db,'support','revoke',body)).status,403);
  assert.equal(state.batch,null);
  const result=await cosmetic(db,'super','revoke',body);
  assert.equal(result.status,200);
  assert.equal(state.batch.length,3);
  assert.match(state.batch[0].sql,/DELETE FROM sharika_cosmetic_equipped/);
  assert.match(state.batch[1].sql,/source='admin_grant'/);
  assert.equal(state.batch[2].args[1],'cosmetic_admin_grant_revoke');
  const purchased=dbMock({inventorySource:'purchase'});
  const blocked=await cosmetic(purchased.db,'super','revoke',body);
  assert.equal(blocked.status,409);
  assert.equal(purchased.state.batch,null);
});
