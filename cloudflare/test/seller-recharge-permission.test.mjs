import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSellerApp,handleSellerAdmin} from '../src/sellers.mjs';

function harness({active=1,allowed=0,role='super'}={}) {
 const queries=[];const batches=[];
 const DB={prepare(sql){const st={sql,args:[],bind(...args){this.args=args;return this;},
 async first(){queries.push({sql,args:this.args});
 if(sql.includes('SELECT auth_uid,minor,public_no FROM sharika_users'))return {auth_uid:'seller',minor:0,public_no:10000003};
 if(sql.includes('SELECT active,play_recharge_allowed FROM sharika_coin_sellers'))return {active,play_recharge_allowed:allowed};
 if(sql.includes('SELECT s.seller_uid FROM sharika_coin_sellers'))return active?{seller_uid:'seller'}:null;
 return null;},async all(){queries.push({sql,args:this.args});if(sql.includes('sharika_seller_recharge_permission_audit a'))return {results:[{id:7,admin_no:10000001,seller_no:10000003,allowed:1,reason:'approved for testing',created_at:'2026-11-09 11:20:00'}]};return {results:[]};}};return st;},async batch(stmts){batches.push(stmts.map(s=>({sql:s.sql,args:s.args})));return [];}};
 const reply=(data,status)=>Response.json(data,{status});const fail=(error,status)=>Response.json({error},{status});
 async function app(){const path='/api/v1/sellers/recharge-status';const request=new Request('https://test.invalid'+path);
 const res=await handleSellerApp({request,env:{DB},uid:'seller',path,cors:{},reply,fail});return {status:res.status,body:await res.json()};}
 async function admin(body,asRole=role){const operation='sellers/play-recharge-permission';const request=new Request('https://test.invalid/admin/'+operation,{method:'POST',body:JSON.stringify(body)});
 const res=await handleSellerAdmin({request,env:{DB},uid:'admin',actor:{role:asRole},operation,cors:{},reply,fail});return {status:res.status,body:await res.json()};}
 async function audit(asRole=role){const operation='sellers/play-recharge-permission-audit';const request=new Request('https://test.invalid/admin/'+operation);const res=await handleSellerAdmin({request,env:{DB},uid:'admin',actor:{role:asRole},operation,cors:{},reply,fail});return {status:res.status,body:await res.json()};}
 return {app,admin,audit,queries,batches};
}
const payload={seller_public_id:'10000003',allowed:true,reason:'approved for testing'};
test('seller recharge status is fail-closed even with admin permission',async()=>{
 const h=harness({allowed:1});const res=await h.app();assert.equal(res.status,200);
 assert.equal(res.body.approved,true);assert.equal(res.body.admin_allowed,true);
 assert.equal(res.body.recharge_enabled,false);assert.equal(h.batches.length,0);
});
test('non-super admins cannot change seller recharge permission',async()=>{
 const h=harness();const res=await h.admin(payload,'finance');assert.equal(res.status,403);assert.equal(h.batches.length,0);
});
test('permission changes require reason and validated seller ID',async()=>{
 const h=harness();const res=await h.admin({...payload,reason:'no'});assert.equal(res.status,400);assert.equal(h.batches.length,0);
});
test('permission updates are audited in same D1 batch',async()=>{
 const h=harness();const res=await h.admin(payload);assert.equal(res.status,200);
 assert.equal(res.body.recharge_enabled,false);assert.equal(h.batches.length,1);
 assert.equal(h.batches[0].length,2);
 assert.match(h.batches[0][0].sql,/UPDATE sharika_coin_sellers/);
 assert.match(h.batches[0][1].sql,/sharika_seller_recharge_permission_audit/);
});
test('inactive seller cannot be granted recharge permission',async()=>{
 const h=harness({active:0});const res=await h.admin(payload);assert.equal(res.status,404);assert.equal(h.batches.length,0);
});

test('permission audit is readable by finance, read-only and maps public IDs',async()=>{
 const h=harness();const res=await h.audit('finance');assert.equal(res.status,200);
 assert.equal(res.body.read_only,true);assert.equal(res.body.changes.length,1);
 assert.deepEqual(res.body.changes[0],{id:7,admin_public_id:'10000001',seller_public_id:'10000003',allowed:true,reason:'approved for testing',created_at:'2026-11-09 11:20:00'});
 assert.equal(h.batches.length,0);
});
test('unprivileged role cannot read seller recharge permission audit',async()=>{
 const h=harness();const res=await h.audit('support');assert.equal(res.status,403);
 assert.equal(h.queries.length,0);
});
test('seller recharge stays disabled for inactive and unapproved sellers',async()=>{
 for(const cfg of [{active:0,allowed:1},{active:1,allowed:0}]){
  const h=harness(cfg);const res=await h.app();assert.equal(res.status,200);
  assert.equal(res.body.recharge_enabled,false);assert.equal(h.batches.length,0);
 }
});
test('revoking permission records disabled state and never grants coins',async()=>{
 const h=harness({allowed:1});const res=await h.admin({...payload,allowed:false});
 assert.equal(res.status,200);assert.equal(res.body.admin_allowed,false);
 assert.equal(res.body.recharge_enabled,false);assert.equal(h.batches.length,1);
 assert.equal(h.batches[0][0].args[0],0);assert.equal(h.batches[0][1].args[2],0);
 assert.equal(h.batches[0].some(st=>/UPDATE sharika_users SET coins|INSERT INTO sharika_wallet_ledger/.test(st.sql)),false);
});
