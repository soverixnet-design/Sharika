import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSellerApp, handleSellerAdmin } from '../src/sellers.mjs';

function mockDB({seller=true,actor=true,minor=0,stock=3000,recipient=true,duplicate=false}={}){
  const state={batch:[],queries:[]};
  const DB={
    prepare(sql){
      const statement={
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args||[]});
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))return actor?{auth_uid:'seller1',minor}:null;
          if(sql.includes('FROM sharika_coin_sellers WHERE seller_uid=?'))
            return seller?{active:1,available_coins:stock}:null;
          if(sql.includes('FROM sharika_users WHERE public_no=?'))
            return recipient?{auth_uid:'recipient2',coins:20,status:'active'}:null;
          if(sql.includes('FROM sharika_coin_seller_transfers t'))return duplicate?{id:12,amount:200,target_uid:'recipient2'}:null;
          if(sql.includes('SELECT id,stock_after FROM sharika_coin_seller_transfers'))return {id:12,stock_after:stock-200};
          if(sql.includes('FROM sharika_coin_seller_allocations WHERE'))return null;
          if(sql.includes('SELECT s.seller_uid'))return seller?{seller_uid:'seller1',active:1,available_coins:stock}:null;
          if(sql.includes('SELECT id,stock_after FROM sharika_coin_seller_allocations'))return {id:13,stock_after:stock+200};
          if(sql.includes('SELECT auth_uid,status,minor FROM sharika_users'))return actor?{auth_uid:'seller1',status:'active',minor}:null;
          return null;
        },
        async all(){return {results:[]}}
      };
      return statement;
    },
    async batch(stmts){state.batch.push(stmts.map(x=>({sql:x.sql||'',args:x.args||[]})));return stmts.map(()=>({success:true}));}
  };
  return {DB,state};
}
const cors={};
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});
const app=async (db,method,path,body)=>{
  const req=new Request('https://staging.test'+path,{method,body:body?JSON.stringify(body):undefined});
  const res=await handleSellerApp({request:req,env:db,uid:'seller1',path,cors,reply,fail});
  return {status:res.status,data:await res.json()};
};
const admin=async (db,role,method,operation,body)=>{
  const request=new Request('https://staging.test/api/v1/admin/'+operation,{
    method,body:body?JSON.stringify(body):undefined
  });
  const res=await handleSellerAdmin({request,env:db,uid:'owner',actor:{role},
    operation,cors,reply,fail});
  return {status:res.status,data:await res.json()};
};
const validTransfer={
  target_public_id:'10000002',coins:200,request_id:'seller-transfer-test-1'
};
const validAllocation={
  seller_public_id:'10000002',coins:200,request_id:'seller-allocate-test-1'
};

test('seller listing and profile are real database reads',async()=>{
  const {DB,state}=mockDB();
  assert.equal((await app(DB,'GET','/api/v1/sellers')).status,200);
  assert.equal((await app(DB,'GET','/api/v1/sellers/me')).status,200);
  assert.equal(state.batch.length,0);
});
test('invalid seller transfer cannot touch any wallet',async()=>{
  const {DB,state}=mockDB();
  const response=await app(DB,'POST','/api/v1/sellers/transfer',{
    ...validTransfer,target_public_id:'bad-id'
  });
  assert.equal(response.status,400);
  assert.equal(state.batch.length,0);
});
test('unapproved seller cannot transfer coins',async()=>{
  const {DB,state}=mockDB({seller:false});
  assert.equal((await app(DB,'POST','/api/v1/sellers/transfer',validTransfer)).status,403);
  assert.equal(state.batch.length,0);
});
test('seller stock insufficient rejects without touching user coins',async()=>{
  const {DB,state}=mockDB({stock:199});
  assert.equal((await app(DB,'POST','/api/v1/sellers/transfer',validTransfer)).status,409);
  assert.equal(state.batch.length,0);
});
test('verified seller transfer changes stock, user wallet, immutable ledger in one batch',async()=>{
  const {DB,state}=mockDB();
  const result=await app(DB,'POST','/api/v1/sellers/transfer',validTransfer);
  assert.equal(result.status,201);
  assert.equal(state.batch.length,1);
  assert.equal(state.batch[0].length,4);
  assert.ok(state.queries.some(q=>q.sql.includes('sharika_coin_seller_transfers')));
});
test('idempotent transfer never credits twice',async()=>{
  const {DB,state}=mockDB({duplicate:true});
  const result=await app(DB,'POST','/api/v1/sellers/transfer',validTransfer);
  assert.equal(result.status,200);
  assert.equal(result.data.duplicate,true);
  assert.equal(state.batch.length,0);
});
test('finance may inspect sellers but cannot mint inventory',async()=>{
  const {DB,state}=mockDB();
  assert.equal((await admin(DB,'finance','GET','sellers')).status,200);
  assert.equal((await admin(DB,'finance','POST','sellers/allocate',validAllocation)).status,403);
  assert.equal(state.batch.length,0);
});
test('super-admin allocation is audited and no user wallet changes',async()=>{
  const {DB,state}=mockDB();
  const result=await admin(DB,'super','POST','sellers/allocate',validAllocation);
  assert.equal(result.status,201);
  assert.equal(state.batch[0].length,3);
});
