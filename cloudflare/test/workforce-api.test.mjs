import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWorkforceApp,handleWorkforceAdmin} from '../src/workforce.mjs';

const reply=(value,status)=>Response.json(value,{status});
const fail=(error,status)=>Response.json({error},{status});
const policy={id:1,enabled:1,host_bps:4000,agency_bps:1000,bd_bps:500,
  direct_exchange_bps:3000,coins_per_usd:500000,settlement_mode:'weekly',
  salary_exchange_enabled:0,version:1};
function mock(){
  const calls=[];
  const db={prepare(sql){
    return {sql,values:[],bind(...values){this.values=values;return this;},
      async first(){calls.push({sql,values:this.values});
        if(sql.includes('FROM sharika_workforce_policy'))return policy;
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          return {auth_uid:'admin',public_no:10000001,name:'Admin',minor:0};
        if(sql.includes('FROM sharika_workforce_members WHERE auth_uid'))return null;
        return null;},
      async all(){calls.push({sql,values:this.values});return {results:[]};}};
  },async batch(statements){calls.push({batch:statements});return [];}};
  return {db,calls};
}
async function admin({method='GET',operation='workforce',role='super',body}={}){
  const {db,calls}=mock();
  const request=new Request('https://sharika.test/api/v1/admin/'+operation,
    {method,body:body?JSON.stringify(body):undefined});
  const response=await handleWorkforceAdmin({request,env:{DB:db},uid:'admin',actor:{role},
    operation,cors:{},reply,fail});
  return {status:response.status,data:await response.json(),calls};
}

test('admin workforce exposes server-owned default percentages and 5M target policy',async()=>{
  const result=await admin();
  assert.equal(result.status,200);
  assert.equal(result.data.policy.host_bps,4000);
  assert.equal(result.data.policy.agency_bps,1000);
  assert.equal(result.data.policy.bd_bps,500);
  assert.equal(result.data.policy.direct_exchange_bps,3000);
  assert.equal(result.data.policy.coins_per_usd,500000);
  assert.equal(result.data.policy.salary_exchange_enabled,0);
});

test('finance may inspect but cannot change workforce percentages or assign a BD',async()=>{
  const changed=await admin({method:'PATCH',operation:'workforce/policy',role:'finance',
    body:{expected_version:1}});
  assert.equal(changed.status,403);
  assert.equal(changed.calls.some(c=>'batch' in c),false);
  const assigned=await admin({method:'POST',operation:'workforce/assign',role:'finance',
    body:{role:'bd',public_id:'10000002'}});
  assert.equal(assigned.status,403);
  assert.equal(assigned.calls.some(c=>'batch' in c),false);
});

test('stale policy versions and impossible 100% distributions reject without writes',async()=>{
  const stale=await admin({method:'PATCH',operation:'workforce/policy',
    body:{expected_version:9}});
  assert.equal(stale.status,409);
  const invalid=await admin({method:'PATCH',operation:'workforce/policy',
    body:{expected_version:1,host_bps:8000,targets:[5000000]}});
  assert.equal(invalid.status,400);
  assert.equal(invalid.calls.some(c=>'batch' in c),false);
});

test('salary exchange refuses unapproved payouts before attempting a D1 credit',async()=>{
  const {db,calls}=mock();
  const request=new Request('https://sharika.test/api/v1/workforce/salary/exchange',{
    method:'POST',body:JSON.stringify({coins:100,expected_version:1,request_id:'salary-test-12345'})
  });
  const response=await handleWorkforceApp({request,env:{DB:db},uid:'admin',
    path:'/api/v1/workforce/salary/exchange',cors:{},reply,fail});
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'salary_exchange_disabled');
  assert.equal(calls.some(c=>'batch' in c),false);
});
