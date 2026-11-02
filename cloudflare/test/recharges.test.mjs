import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRechargeAdmin} from '../src/recharges.mjs';
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
function mock({requestExists=true,review=null,receiptUsed=false,active=true,inviter=true}={}){
  const state={queries:[],batches:[]};
  const DB={
    prepare(sql){
      const stmt={sql,args:[],
        bind(...values){this.args=values;return this;},
        async first(){
          state.queries.push({sql,args:this.args});
          if(sql.startsWith('SELECT m.id,m.user_id'))
            return requestExists?{id:71,user_id:'new-user',public_no:10000017,
              name:'New User',coins:100,status:active?'active':'blocked',
              body:'Recharge request · 1,000 Coins',created_at:'2026-10-30'}:null;
          if(sql.includes('FROM sharika_manual_recharge_reviews WHERE support_message_id'))
            return review;
          if(sql.includes("WHERE status='approved' AND lower(payment_method)"))
            return receiptUsed?{support_message_id:11}:null;
          if(sql.includes('SELECT u.auth_uid,u.status,u.coins FROM sharika_referrals'))
            return inviter?{auth_uid:'inviter',status:'active',coins:5000}:null;
          return null;
        },
        async all(){
          state.queries.push({sql,args:this.args});
          if(sql.includes('SELECT m.id AS request_id'))return {results:[
            {request_id:71,public_no:10000017,name:'New User',
             body:'Recharge request · 1,000 Coins',created_at:'2026-10-30',
             status:'pending',coins:null}
          ]};
          return {results:[]};
        }
      };
      return stmt;
    },
    async batch(stmts){state.batches.push(stmts);return stmts.map(()=>({success:true}));}
  };
  return {DB,state};
}
const req=(path,body,method='POST')=>new Request('https://example.test/api/v1/admin/'+path,{
  method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)
});
async function call(db,operation,body,actor={role:'finance'},method='POST'){
  return handleRechargeAdmin({request:req(operation,body,method),env:{DB:db},
    uid:'finance-user',actor,operation,cors:{},reply,fail});
}
const approved={support_message_id:71,coins:1000,payment_method:'bKash',
  payment_reference:'TXN-20261030-123',confirm_payment_verified:true};
test('finance can list real support recharge requests but cannot credit merely by listing',async()=>{
  const f=mock();
  const response=await call(f.DB,'recharges',undefined,{role:'finance'},'GET');
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.requests[0].request_id,71);
  assert.equal(data.manual_verification_required,true);
  assert.equal(f.state.batches.length,0);
});
test('support agents cannot approve or list recharge requests',async()=>{
  const f=mock();
  assert.equal((await call(f.DB,'recharges',undefined,{role:'support'},'GET')).status,403);
  assert.equal((await call(f.DB,'recharges/approve',approved,{role:'support'})).status,403);
  assert.equal(f.state.queries.length,0);
});
test('request without verified receipt confirmation cannot mint coins',async()=>{
  const f=mock();
  const invalid={...approved,confirm_payment_verified:false};
  assert.equal((await call(f.DB,'recharges/approve',invalid)).status,400);
  assert.equal((await call(f.DB,'recharges/approve',{...approved,coins:1000000000001})).status,400);
  assert.equal(f.state.batches.length,0);
});
test('manual approval atomically grants 40% first recharge and 5% inviter commission',async()=>{
  const f=mock();
  const response=await call(f.DB,'recharges/approve',approved);
  const result=await response.json();
  assert.equal(response.status,201);
  assert.equal(result.credited_coins,1000);
  assert.equal(result.referral_bonus_coins,50);
  assert.equal(result.first_recharge_bonus_coins,400);
  assert.equal(f.state.batches.length,1);
  const queries=f.state.batches[0];
  assert.equal(queries.length,10);
  assert.match(queries[0].sql,/INSERT INTO sharika_manual_recharge_reviews/);
  assert.match(queries[1].sql,/UPDATE sharika_users/);
  assert.equal(queries[1].args[1],1000);
  assert.match(queries[2].sql,/sharika_wallet_ledger/);
  assert.equal(queries[2].args[1],1000);
  assert.match(queries[3].sql,/sharika_first_recharge_bonuses/);
  assert.equal(queries[4].args[1],400);
  assert.equal(queries[5].args[1],400);
  assert.equal(queries[6].args[1],50);
  assert.equal(queries[7].args[1],50);
  assert.match(queries[8].sql,/sharika_support_messages/);
  assert.match(queries[9].sql,/sharika_admin_audit/);
});
test('a repeat review returns same result without another batch',async()=>{
  const f=mock({review:{support_message_id:71,user_uid:'new-user',status:'approved',
    coins:1000,payment_method:'bKash',payment_reference:'TXN-20261030-123'}});
  const response=await call(f.DB,'recharges/approve',approved);
  assert.equal(response.status,200);
  assert.equal((await response.json()).duplicate,true);
  assert.equal(f.state.batches.length,0);
});
test('reused payment receipt on another request is rejected',async()=>{
  const f=mock({receiptUsed:true});
  assert.equal((await call(f.DB,'recharges/approve',approved)).status,409);
  assert.equal(f.state.batches.length,0);
});
test('blocked recipient and nonexistent recharge request cannot be credited',async()=>{
  const blocked=mock({active:false});
  assert.equal((await call(blocked.DB,'recharges/approve',approved)).status,403);
  const missing=mock({requestExists:false});
  assert.equal((await call(missing.DB,'recharges/approve',approved)).status,404);
});
test('rejection writes a reviewed decision and audit but no wallet credit',async()=>{
  const f=mock();
  const response=await call(f.DB,'recharges/reject',{support_message_id:71,note:'Payment never received'});
  assert.equal(response.status,201);
  assert.equal((await response.json()).coins_credited,0);
  assert.equal(f.state.batches[0].length,3);
  assert.match(f.state.batches[0][0].sql,/recharge_reviews/);
  assert.match(f.state.batches[0][1].sql,/sharika_support_messages/);
  assert.match(f.state.batches[0][2].sql,/sharika_admin_audit/);
});
