import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_PACKAGE,PLAY_COIN_PACKS,sha256Hex,billingEnabled,handlePlayBilling
} from '../src/play-billing.mjs';

const USER='firebase-user-play-1',OTHER='firebase-user-play-2';
const TOKEN='play_purchase_token_A34567890123456789';
const SKU='sharika_coins_500k';
const env=()=>({SHARIKA_PLAY_BILLING_ENABLED:'true',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:'{"client_email":"test@example.gserviceaccount.com","private_key":"test"}'});
const request=(method,path,body)=>new Request('https://sharika.example'+path,{
  method,headers:body?{'content-type':'application/json'}:{},
  body:body?JSON.stringify(body):undefined
});
const reply=(body,status=200)=>Response.json(body,{status});
const fail=(code,status)=>reply({error:code},status);
class Db {
  constructor(){
    this.receipts=new Map();
    this.users=new Map([[USER,{coins:50,status:'active',minor:0}],
      [OTHER,{coins:30,status:'active',minor:0}]]);
    this.ledger=[];
  }
  prepare(sql){
    return {bind:(...args)=>({sql,args,first:async()=>{
      if(sql.includes('FROM sharika_play_billing_purchases'))return this.receipts.get(args[0])||null;
      if(sql.includes('FROM sharika_users'))return this.users.get(args[0])||null;
      throw Error('unexpected_select');
    }})};
  }
  async batch(statements){
    assert.equal(statements.length,3);
    const [insert,update,ledger]=statements;
    const [hash,uid,sku,amount]=insert.args;
    if(this.receipts.has(hash))throw Error('unique_token');
    assert.equal(update.args[1],amount);
    assert.equal(ledger.args[1],amount);
    const user=this.users.get(uid);
    if(!user||user.status!=='active'||user.coins+amount>1e12)
      throw Error('invalid_balance');
    this.receipts.set(hash,{auth_uid:uid,product_id:sku,coins:amount});
    user.coins+=amount;
    this.ledger.push({uid,amount,request_id:ledger.args[3]});
  }
}
const googleRecord=async({uid=USER,sku=SKU,state='PURCHASED'}={})=>({
  obfuscatedExternalAccountId:await sha256Hex(uid),
  purchaseStateContext:{purchaseState:state},
  productLineItem:[{productId:sku}],orderId:'GPA.1234-5678-9012-34567',
  testPurchaseContext:{fopType:'TEST'}
});
async function api(db,uid,body,verification=async()=>googleRecord(),opts=env()){
  return handlePlayBilling({request:request('POST','/api/v1/billing/verify',body),
    env:{...opts,DB:db},uid,path:'/api/v1/billing/verify',cors:{},reply,fail,
    getStatus:verification});
}

test('Google Play Billing defaults closed without a configured service account',async()=>{
  assert.equal(billingEnabled({SHARIKA_PLAY_BILLING_ENABLED:'true'}),false);
  assert.equal(PLAY_PACKAGE,'com.soverixnet.sharika');
  assert.equal(PLAY_COIN_PACKS.sharika_coins_500k,500000);
  const output=await handlePlayBilling({request:request('GET','/api/v1/billing/catalog'),
    env:{DB:new Db(),SHARIKA_PLAY_BILLING_ENABLED:'false'},uid:USER,
    path:'/api/v1/billing/catalog',cors:{},reply,fail});
  const body=await output.json();
  assert.equal(body.enabled,false);
  assert.deepEqual(body.products,[]);
});

test('rejects purchases while Play configuration disabled',async()=>{
  const db=new Db();
  const response=await api(db,USER,{product_id:SKU,purchase_token:TOKEN},
    async()=>{throw Error('should never contact Google');},
    {SHARIKA_PLAY_BILLING_ENABLED:'false'});
  assert.equal(response.status,503);
  assert.equal(db.ledger.length,0);
});

test('rejects unknown products and malformed purchase tokens without Google lookup',async()=>{
  const db=new Db();
  for(const body of [{product_id:'attacker_coins_infinity',purchase_token:TOKEN},
    {product_id:SKU,purchase_token:'bad'},
    {product_id:SKU,purchase_token:'x'.repeat(5000)}]){
    const output=await api(db,USER,body,async()=>{throw Error('Google not called');});
    assert.equal(output.status,400);
  }
  assert.equal(db.ledger.length,0);
});

test('PENDING, cancelled, wrong SKU and stolen account tokens never credit',async()=>{
  const db=new Db();
  const records=[
    await googleRecord({state:'PENDING'}),
    await googleRecord({state:'CANCELLED'}),
    await googleRecord({sku:'sharika_coins_5000k'}),
    await googleRecord({uid:OTHER})
  ];
  for(const record of records){
    const output=await api(db,USER,{product_id:SKU,purchase_token:TOKEN},async()=>record);
    assert.equal(output.status,403);
  }
  assert.equal(db.ledger.length,0);
});

test('valid verified purchase credits once; same token is idempotent',async()=>{
  const db=new Db();
  const body={product_id:SKU,purchase_token:TOKEN};
  const record=await googleRecord();
  const first=await api(db,USER,body,async()=>record);
  assert.equal(first.status,201);
  assert.deepEqual(await first.json(),{
    credited:true,duplicate:false,coins:500000,product_id:SKU});
  assert.equal(db.users.get(USER).coins,500050);
  const second=await api(db,USER,body,async()=>{throw Error('not queried for duplicate');});
  assert.equal(second.status,200);
  assert.equal((await second.json()).duplicate,true);
  assert.equal(db.users.get(USER).coins,500050);
  assert.equal(db.ledger.length,1);
  assert.equal(db.ledger[0].request_id,'play:'+await sha256Hex(TOKEN));
});

test('cross-account token replay is rejected, even with another legal SKU',async()=>{
  const db=new Db();
  await api(db,USER,{product_id:SKU,purchase_token:TOKEN},async()=>googleRecord());
  const result=await api(db,OTHER,{product_id:SKU,purchase_token:TOKEN},
    async()=>{throw Error('no second verification');});
  assert.equal(result.status,409);
  assert.equal(db.users.get(OTHER).coins,30);
});

test('Google API failure or a blocked user never grants coins',async()=>{
  const db=new Db();
  const failGoogle=await api(db,USER,{product_id:SKU,purchase_token:TOKEN},
    async()=>{throw Error('google timeout');});
  assert.equal(failGoogle.status,503);
  db.users.get(USER).status='blocked';
  const blocked=await api(db,USER,{product_id:SKU,purchase_token:TOKEN},async()=>googleRecord());
  assert.equal(blocked.status,403);
  assert.equal(db.ledger.length,0);
});
