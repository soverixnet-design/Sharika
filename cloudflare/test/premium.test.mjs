import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handlePremiumApp,handlePremiumAdmin,selectPremiumTier} from '../src/premium.mjs';

const tiers=[
  {tier:'vip',rank:1,min_wealth_level:10,min_gift_coins:10_000,
    price_coins:10_000,duration_days:30,daily_bonus_coins:100},
  {tier:'svip',rank:2,min_wealth_level:25,min_gift_coins:100_000,
    price_coins:50_000,duration_days:30,daily_bonus_coins:300},
  {tier:'noble',rank:3,min_wealth_level:50,min_gift_coins:1_000_000,
    price_coins:200_000,duration_days:30,daily_bonus_coins:1000}
];
const svipLevels=Array.from({length:8},(_,i)=>({level:i+1,
  price_coins:(i+1)*1_000_000,daily_bonus_coins:(i+1)*1_000,enabled:1}));
const policy={purchase_enabled:true,admin_grant_enabled:true,auto_enabled:true,
  auto_by_level:true,auto_by_gifts:true};
const nowMs=Date.UTC(2026,9,31,12);
const cors={};
const reply=(data,status)=>Response.json(data,{status});
const fail=(error,status)=>Response.json({error},{status});

function mockDB({wealthLevel=3,giftCoins=0,coins=500_000,manual=null,
  purchased=null,claimed=null,userActive=true,policyOverride={}}={}){
  const state={queries:[],batches:[]};
  const currentPolicy={key:'standard',...Object.fromEntries(
    Object.entries({...policy,...policyOverride}).map(([key,value])=>[key,Number(value)]))};
  const db={
    prepare(sql){
      return {sql,params:[],bind(...params){this.params=params;return this;},
        async first(){
          state.queries.push({sql,params:this.params});
          if(sql.includes('FROM sharika_premium_policy'))return currentPolicy;
          if(sql.includes('FROM sharika_premium_memberships WHERE auth_uid=?'))return manual;
          if(sql.includes('FROM sharika_gift_events WHERE sender_uid=?'))
            return {gift_coins:giftCoins};
          if(sql.includes('FROM sharika_premium_daily_claims'))return claimed;
          if(sql.includes('FROM sharika_premium_purchases WHERE auth_uid=?'))return purchased;
          if(sql.includes('SELECT auth_uid,public_no,coins,wealth_level,status FROM sharika_users'))
            return {auth_uid:'user1',public_no:10000008,coins,wealth_level:wealthLevel,
              status:userActive?'active':'blocked'};
          if(sql.includes('SELECT auth_uid FROM sharika_users WHERE public_no=?'))
            return {auth_uid:'user1'};
          if(sql.includes('SELECT auth_uid,status FROM sharika_users WHERE public_no=?'))
            return {auth_uid:'user1',status:'active'};
          return null;
        },
        async all(){
          state.queries.push({sql,params:this.params});
          if(sql.includes('sharika_premium_tiers'))return {results:tiers};
          if(sql.includes('FROM sharika_svip_levels'))return {results:svipLevels};
          if(sql.includes('GROUP BY tier'))return {results:[]};
          return {results:[]};
        }};
    },
    async batch(stmts){
      state.batches.push(stmts.map(s=>({sql:s.sql,params:s.params})));
      return stmts.map(()=>({success:true}));
    }
  };
  return {db,state};
}
async function app(db,method,path,body){
  const request=new Request('https://staging.test'+path,{
    method,body:body===undefined?undefined:JSON.stringify(body)
  });
  const response=await handlePremiumApp({request,env:{DB:db},uid:'user1',
    path,cors,reply,fail,nowMs});
  return {status:response.status,data:await response.json()};
}
async function admin(db,role,method,operation,body,pathSuffix=''){
  const request=new Request('https://staging.test/api/v1/admin/'+operation+pathSuffix,{
    method,body:body===undefined?undefined:JSON.stringify(body)
  });
  const response=await handlePremiumAdmin({request,env:{DB:db},uid:'owner',
    actor:{role},operation,cors,reply,fail,nowMs});
  return {status:response.status,data:await response.json()};
}

test('automatic premium is ON and wealth OR settled gifts independently qualifies',()=>{
  const base={policy,tiers,wealthLevel:3,giftCoins:0,manual:null,nowMs};
  assert.equal(selectPremiumTier({...base,wealthLevel:10}).tier,'vip');
  assert.equal(selectPremiumTier({...base,giftCoins:100_000}).tier,'svip');
  assert.equal(selectPremiumTier({...base,wealthLevel:50}).tier,'noble');
  assert.equal(selectPremiumTier({...base,wealthLevel:25,giftCoins:1_000_000}).tier,'noble');
  assert.equal(selectPremiumTier({...base,policy:{...policy,auto_by_gifts:false},
    giftCoins:1_000_000}).tier,'none');
  assert.equal(selectPremiumTier({...base,policy:{...policy,auto_by_level:false},
    wealthLevel:50}).tier,'none');
  assert.equal(selectPremiumTier({...base,policy:{...policy,auto_enabled:false},
    wealthLevel:50,giftCoins:1_000_000}).tier,'none');
});

test('a current purchased or granted tier survives auto OFF, but expires by server time',()=>{
  const manual={tier:'svip',source:'admin',expires_at_ms:nowMs+86_400_000};
  const base={policy:{...policy,auto_enabled:false},tiers,wealthLevel:50,
    giftCoins:1_000_000,manual,nowMs};
  assert.equal(selectPremiumTier(base).tier,'svip');
  assert.equal(selectPremiumTier({...base,nowMs:manual.expires_at_ms}).tier,'none');
  assert.equal(selectPremiumTier({...base,policy,wealthLevel:50}).tier,'noble');
});

test('status uses real verified gift-event aggregates and never a client-sent volume',async()=>{
  const {db,state}=mockDB({giftCoins:100_000});
  const response=await app(db,'GET','/api/v1/premium');
  assert.equal(response.status,200);
  assert.equal(response.data.status.tier,'svip');
  assert.equal(response.data.status.source,'automatic_gifts');
  assert.equal(response.data.status.wallet_coins,500_000);
  assert.ok(state.queries.some(q=>q.sql.includes(
    'FROM sharika_gift_events WHERE sender_uid=? AND recipient_uid<>sender_uid')&&q.params[0]==='user1'));
});

test('purchase atomically debits verified coins and adds auditable membership',async()=>{
  const {db,state}=mockDB({coins:2_000_000});
  const result=await app(db,'POST','/api/v1/premium/purchase',
    {tier:'svip',svip_level:1,request_id:'premium-request-0001',gift_coins:99_999_999});
  assert.equal(result.status,201);
  assert.equal(result.data.price_coins,1_000_000);
  assert.equal(result.data.duration_days,30);
  assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].length,12);
  assert.match(state.batches[0][0].sql,/INSERT INTO sharika_premium_purchases/);
  assert.match(state.batches[0][1].sql,/UPDATE sharika_users SET coins=CASE/);
  assert.deepEqual(state.batches[0][1].params,[1_000_000,1_000_000,'user1']);
  assert.match(state.batches[0][2].sql,/INSERT INTO sharika_premium_memberships/);
  assert.match(state.batches[0][3].sql,/INSERT INTO sharika_wallet_ledger/);
  assert.equal(state.batches[0][3].params[1],-1_000_000);
  assert.equal(state.batches[0].filter(x=>x.sql.includes('sharika_cosmetic_inventory')).length,4);
  assert.equal(state.batches[0].filter(x=>x.sql.includes('sharika_cosmetic_equipped')).length,4);
});

test('same purchase ID is idempotent and cannot charge again',async()=>{
  const {db,state}=mockDB({purchased:{
    tier:'vip',price_coins:10_000,expires_at_ms:nowMs+86_400_000}});
  const result=await app(db,'POST','/api/v1/premium/purchase',
    {tier:'vip',request_id:'premium-request-0001'});
  assert.equal(result.status,200);
  assert.equal(result.data.duplicate,true);
  assert.equal(state.batches.length,0);
  const conflict=await app(db,'POST','/api/v1/premium/purchase',
    {tier:'noble',request_id:'premium-request-0001'});
  assert.equal(conflict.status,409);
  assert.equal(state.batches.length,0);
});

test('disabled purchases, insufficient wallet and invalid body never debit',async()=>{
  const disabled=mockDB({policyOverride:{purchase_enabled:false}});
  assert.equal((await app(disabled.db,'POST','/api/v1/premium/purchase',
    {tier:'vip',request_id:'premium-request-0002'})).status,403);
  assert.equal(disabled.state.batches.length,0);
  const poor=mockDB({coins:999});
  assert.equal((await app(poor.db,'POST','/api/v1/premium/purchase',
    {tier:'vip',request_id:'premium-request-0002'})).status,409);
  assert.equal((await app(poor.db,'POST','/api/v1/premium/purchase',
    {tier:'vip',request_id:'bad'})).status,400);
  assert.equal(poor.state.batches.length,0);
});

test('daily premium coins are unique per UTC date and have immutable ledger entry',async()=>{
  const {db,state}=mockDB({wealthLevel:10});
  const first=await app(db,'POST','/api/v1/premium/daily/claim',{});
  assert.equal(first.status,201);
  assert.equal(first.data.reward_coins,100);
  assert.equal(state.batches.length,1);
  assert.deepEqual(state.batches[0][0].params,['user1','2026-10-31','vip',100]);
  assert.match(state.batches[0][1].sql,/UPDATE sharika_users SET coins=CASE/);
  assert.equal(state.batches[0][2].params[3],'premium:daily:2026-10-31');
  const claimed=mockDB({wealthLevel:10,claimed:{tier:'vip',reward_coins:100}});
  const again=await app(claimed.db,'POST','/api/v1/premium/daily/claim',{});
  assert.equal(again.status,200);
  assert.equal(again.data.duplicate,true);
  assert.equal(claimed.state.batches.length,0);
});

test('only super admin may change the switches, thresholds or grant tiers',async()=>{
  const {db,state}=mockDB();
  const configuration={policy:{...policy,auto_by_gifts:false},tiers};
  assert.equal((await admin(db,'support','PATCH','premium',configuration)).status,403);
  assert.equal((await admin(db,'finance','POST','premium/grant',
    {public_id:'10000008',tier:'noble',duration_days:30})).status,403);
  assert.equal(state.batches.length,0);
  const response=await admin(db,'super','PATCH','premium',configuration);
  assert.equal(response.status,200);
  assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].length,5);
  assert.match(state.batches[0][4].sql,/sharika_premium_audit/);
  assert.equal(state.batches[0][0].params[4],0);
  const grant=await admin(db,'super','POST','premium/grant',
    {public_id:'10000008',tier:'noble',duration_days:14});
  assert.equal(grant.status,200);
  assert.equal(state.batches[1].length,2);
  assert.match(state.batches[1][1].sql,/sharika_premium_audit/);
});

test('invalid config cannot weaken monotonic tiers; admin may revoke when grants disabled',async()=>{
  const {db,state}=mockDB({policyOverride:{admin_grant_enabled:false}});
  const wrong={policy,tiers:tiers.map(t=>({...t}))};
  wrong.tiers[1].min_wealth_level=5;
  assert.equal((await admin(db,'super','PATCH','premium',wrong)).status,400);
  assert.equal((await admin(db,'super','POST','premium/grant',
    {public_id:'10000008',tier:'vip',duration_days:30})).status,403);
  const revoked=await admin(db,'super','POST','premium/grant',
    {public_id:'10000008',tier:'none'});
  assert.equal(revoked.status,200);
  assert.match(state.batches[0][0].sql,/DELETE FROM sharika_premium_memberships/);
});

test('schema enforces durable receipt uniqueness, non-negative wallets and audited grants',()=>{
  const schema=readFileSync(new URL('../migrations/0028_premium_memberships.sql',import.meta.url),'utf8');
  assert.match(schema,/UNIQUE\(auth_uid,request_id\)/);
  assert.match(schema,/PRIMARY KEY\(auth_uid,utc_day\)/);
  assert.match(schema,/premium_audit_immutable_update/);
  assert.match(schema,/premium_audit_immutable_delete/);
  assert.match(schema,/auto_enabled INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema,/auto_by_level INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema,/auto_by_gifts INTEGER NOT NULL DEFAULT 1/);
});

test('all eight paid SVIP levels use server-side prices, daily coins and 30-day passes',async()=>{
  const {db,state}=mockDB({coins:9_000_000});
  const purchase=await app(db,'POST','/api/v1/premium/purchase',{
    tier:'svip',svip_level:8,request_id:'premium-svip-eight-88'
  });
  assert.equal(purchase.status,201);
  assert.equal(purchase.data.svip_level,8);
  assert.equal(purchase.data.price_coins,8_000_000);
  assert.equal(purchase.data.expires_at_ms-nowMs,30*86_400_000);
  assert.equal(state.batches[0][1].params[1],8_000_000);
  const inventory=state.batches[0].filter(x=>x.sql.includes('sharika_cosmetic_inventory'));
  assert.equal(inventory.length,4);
  assert.ok(inventory.some(x=>x.params[1]==='frame_style:svip-frame-08'));
  assert.ok(inventory.some(x=>x.params[1]==='entry_style:svip-entry-08'));
  assert.ok(inventory.some(x=>x.params[1]==='medal_style:svip-medal-08'));
  assert.ok(inventory.some(x=>x.params[1]==='name_tag_style:svip-tag-08'));
  const status=selectPremiumTier({policy,tiers,svipLevels:svipLevels.map(x=>({...x,enabled:true})),
    wealthLevel:1,giftCoins:0,
    manual:{tier:'svip',source:'purchase',svip_level:8,expires_at_ms:nowMs+86_400_000},nowMs});
  assert.equal(status.daily_bonus_coins,8000);
  assert.equal(status.svip_level,8);
});

test('super admin can set SVIP 1–8 coin prices and free grants provision a Backpack pack',async()=>{
  const {db,state}=mockDB();
  const cfg={policy,tiers,svip_levels:svipLevels.map(x=>({...x,enabled:true}))};
  cfg.svip_levels[0].price_coins=1_250_000;
  cfg.svip_levels[0].daily_bonus_coins=1700;
  const update=await admin(db,'super','PATCH','premium',cfg);
  assert.equal(update.status,200);
  assert.equal(state.batches[0].filter(x=>x.sql.includes('UPDATE sharika_svip_levels')).length,8);
  const grant=await admin(db,'super','POST','premium/grant',
    {public_id:'10000008',tier:'svip',svip_level:3,duration_days:30});
  assert.equal(grant.status,200);
  assert.equal(state.batches[1].filter(x=>x.sql.includes('sharika_cosmetic_inventory')).length,4);
  const poor={...cfg,svip_levels:cfg.svip_levels.map(x=>({...x}))};
  poor.svip_levels[0].price_coins=-1;
  assert.equal((await admin(db,'super','PATCH','premium',poor)).status,400);
  assert.equal(state.batches.length,2);
});
