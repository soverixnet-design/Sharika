import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSellerApp, handleSellerAdmin } from '../src/sellers.mjs';
import {readFileSync} from 'node:fs';

function mockDB({seller=true,actor=true,minor=0,stock=3000,recipient=true,duplicate=false,selfRecipient=false}={}){
  const state={batch:[],queries:[]};
  const DB={
    prepare(sql){
      const statement={
        sql,
        bind(...args){this.args=args;return this;},
        async first(){
          state.queries.push({sql,args:this.args||[]});
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))return actor?{auth_uid:'seller1',public_no:10000003,minor}:null;
          if(sql.includes('FROM sharika_coin_sellers WHERE seller_uid=?'))
            return seller?{active:1,available_coins:stock}:null;
          if(sql.includes('FROM sharika_users WHERE public_no=?'))
            return recipient?{auth_uid:selfRecipient?'seller1':'recipient2',coins:20,status:'active'}:null;
          if(sql.includes('FROM sharika_coin_seller_transfers t'))return duplicate?{id:12,amount:200,target_uid:selfRecipient?'seller1':'recipient2'}:null;
          if(sql.includes('SELECT id,stock_after FROM sharika_coin_seller_transfers'))return {id:12,stock_after:stock-200};
          if(sql.includes('SELECT id,amount,stock_after,seller_uid FROM sharika_coin_seller_allocations'))return null;
          if(sql.includes('SELECT s.seller_uid'))return seller?{seller_uid:'seller1',active:1,available_coins:stock}:null;
          if(sql.includes('SELECT id,stock_after FROM sharika_coin_seller_allocations'))return {id:13,stock_after:stock+200};
          if(sql.includes('FROM sharika_coin_sellers s JOIN sharika_users u'))
            return {public_no:10000003,name:'Approved Seller',pic:null,
              active:1,available_coins:stock};
          if(sql.includes('SELECT auth_uid,status,minor FROM sharika_users'))return actor?{auth_uid:'seller1',status:'active',minor}:null;
          return null;
        },
        async all(){
          state.queries.push({sql,args:this.args||[]});
          if(sql.includes('FROM sharika_coin_sellers s JOIN sharika_users u'))
            return {results:[{public_no:10000003,name:'Approved Seller',pic:null,
              active:1,available_coins:stock}]};
          if(sql.includes('FROM sharika_coin_seller_transfers t ')){
            return {results:[{id:7,sender_no:10000003,seller_no:10000003,
              recipient_no:10000002,amount:250,stock_after:2750,created_at:'2026-10-30'}]};
          }
          if(sql.includes('FROM sharika_coin_seller_allocations a ')){
            return {results:[{id:5,sender_no:10000001,seller_no:10000003,
              amount:3000,stock_after:3000,created_at:'2026-10-30'}]};
          }
          return {results:[]};
        }
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
  const res=await handleSellerApp({request:req,env:{DB:db},uid:'seller1',path,cors,reply,fail});
  return {status:res.status,data:await res.json()};
};
const admin=async (db,role,method,operation,body)=>{
  const request=new Request('https://staging.test/api/v1/admin/'+operation,{
    method,body:body?JSON.stringify(body):undefined
  });
  const res=await handleSellerAdmin({request,env:{DB:db},uid:'owner',actor:{role},
    operation,cors,reply,fail});
  return {status:res.status,data:await res.json()};
};
const validTransfer={
  target_public_id:'10000002',coins:200,request_id:'seller-transfer-test-1'
};
const validAllocation={
  seller_public_id:'10000002',coins:200,request_id:'seller-allocate-test-1'
};

test('public seller list shows verified IDs but hides wallet stock',async()=>{
  const {DB,state}=mockDB();
  const list=await app(DB,'GET','/api/v1/sellers');
  assert.equal(list.status,200);
  assert.deepEqual(list.data.sellers,[{
    public_id:'10000003',name:'Approved Seller',pic:null
  }]);
  assert.ok(state.queries.some(q=>q.sql.includes("WHERE s.active=1")));
  assert.ok(!state.queries.some(q=>q.sql.includes('SELECT u.public_no,u.name,u.pic,s.active,s.available_coins')));
  const mine=await app(DB,'GET','/api/v1/sellers/me');
  assert.equal(mine.status,200);
  assert.equal(mine.data.seller.available_coins,3000);
  assert.equal(state.batch.length,0);
});
test('seller directory is read-only and recharge exists only in private wallet UI',()=>{
  const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  const entry=source.indexOf('async function showVerifiedCoinSellers');
  const directory=source.slice(source.indexOf('if(!walletOnly){',entry),
    source.indexOf('// Private wallet:',entry));
  assert.match(directory,/api\('GET','\/sellers'\)/);
  assert.doesNotMatch(directory,/\/sellers\/transfers|\/sellers\/allocations|sharika-seller-send/);
  assert.match(source,/button\.id='sharika-recharge-seller-wallet'/);
  assert.match(source,/button\.onclick=\(\)=>showVerifiedCoinSellers\(\{walletOnly:true\}\)/);
});
test('seller recharge stays in Seller Wallet and defaults to the verified seller ID',()=>{
  const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/button\.textContent='🪙 Recharge my ID · Seller stock '/);
  assert.match(source,/button\.textContent='Seller Wallet'/);
  assert.match(source,/data\.seller\?\.active/);
  assert.match(source,/targetField\.value=\/\^\[0-9\]\{8\}\$\/\.test\(targetId\)/);
  assert.match(source,/\?targetId:self\.public_id/);
  assert.match(source,/if\(document\.querySelector\('#rcp #rcl2'\)!==listButton\)\s*mountRechargeSellerWallet\(\);/);
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
test('seller can recharge own verified ID, debiting stock and crediting personal coins once',async()=>{
  const {DB,state}=mockDB({selfRecipient:true});
  const result=await app(DB,'POST','/api/v1/sellers/transfer',{
    ...validTransfer,target_public_id:'10000003'
  });
  assert.equal(result.status,201);
  assert.equal(result.data.self_recharge,true);
  assert.equal(result.data.recipient_public_id,'10000003');
  assert.equal(result.data.referral_bonus_coins,0);
  assert.equal(state.batch.length,1);
  assert.equal(state.batch[0].length,4);
  const [stockDebit,walletCredit,transferRecord,walletLedger]=state.batch[0];
  assert.match(stockDebit.sql,/UPDATE sharika_coin_sellers/);
  assert.deepEqual(stockDebit.args,[200,200,'seller1']);
  assert.match(walletCredit.sql,/UPDATE sharika_users/);
  assert.equal(walletCredit.args[2],'seller1');
  assert.match(transferRecord.sql,/INSERT INTO sharika_coin_seller_transfers/);
  assert.equal(transferRecord.args[1],'seller1');
  assert.match(walletLedger.sql,/INSERT INTO sharika_wallet_ledger/);
  assert.equal(walletLedger.args[0],'seller1');
  assert.equal(state.queries.some(q=>q.sql.includes('sharika_referrals')),false);
});
test('repeated self recharge request is idempotent and cannot credit twice',async()=>{
  const {DB,state}=mockDB({selfRecipient:true,duplicate:true});
  const result=await app(DB,'POST','/api/v1/sellers/transfer',{
    ...validTransfer,target_public_id:'10000003'
  });
  assert.equal(result.status,200);
  assert.equal(result.data.duplicate,true);
  assert.equal(result.data.self_recharge,true);
  assert.equal(state.batch.length,0);
});
test('seller cannot self recharge beyond stock',async()=>{
  const {DB,state}=mockDB({selfRecipient:true,stock:199});
  const result=await app(DB,'POST','/api/v1/sellers/transfer',{
    ...validTransfer,target_public_id:'10000003'
  });
  assert.equal(result.status,409);
  assert.equal(result.data.error,'seller_stock_insufficient');
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
  assert.equal(result.data.sender_public_id,'10000003');
  assert.equal(state.batch.length,1);
  assert.equal(state.batch[0].length,4);
  assert.ok(state.queries.some(q=>q.sql.includes('sharika_coin_seller_transfers')));
});
test('seller transfer list shows verified sender and recipient IDs, scoped to caller',async()=>{
  const {DB,state}=mockDB();
  const result=await app(DB,'GET','/api/v1/sellers/transfers');
  assert.equal(result.status,200);
  assert.equal(result.data.transfers[0].sender_public_id,'10000003');
  assert.equal(result.data.transfers[0].recipient_public_id,'10000002');
  assert.ok(state.queries.some(q=>q.sql.includes('WHERE t.seller_uid=?')&&q.args[0]==='seller1'));
  assert.equal(state.batch.length,0);
});
test('seller wallet shows stock allocations with admin sender ID',async()=>{
  const {DB,state}=mockDB();
  const result=await app(DB,'GET','/api/v1/sellers/allocations');
  assert.equal(result.status,200);
  assert.equal(result.data.allocations[0].sender_public_id,'10000001');
  assert.equal(result.data.allocations[0].seller_public_id,'10000003');
  assert.ok(state.queries.some(q=>q.sql.includes('WHERE a.seller_uid=?')&&q.args[0]==='seller1'));
  assert.equal(state.batch.length,0);
});
test('admin transfers and allocations keep public IDs visible without wallet mutation',async()=>{
  const {DB,state}=mockDB();
  const history=await admin(DB,'finance','GET','sellers/transfers');
  const credits=await admin(DB,'finance','GET','sellers/allocations');
  assert.equal(history.data.transfers[0].sender_public_id,'10000003');
  assert.equal(credits.data.allocations[0].seller_public_id,'10000003');
  assert.equal(state.batch.length,0);
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
