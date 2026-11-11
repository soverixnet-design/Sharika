import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agencyGiftEarningStatements,handleAgencyApp,handleAgencyAdmin} from '../src/agency.mjs';

const reply=(body,status)=>Response.json(body,{status});
const fail=(error,status)=>Response.json({error},{status});
const statementDb={prepare(sql){return {sql,values:[],bind(...v){this.values=v;return this;}};}};

test('gift recipient including self-gifts earns separate 40/10/5 records only for regular gifts',()=>{
  const statements=agencyGiftEarningStatements(statementDb,'sender','gift-request-123',0);
  assert.equal(statements.length,3);
  assert.deepEqual(statements.map(s=>s.values),[
    ['sender','gift-request-123'],['sender','gift-request-123'],['sender','gift-request-123']]);
  assert.ok(statements.every(s=>s.sql.includes('e.recipient_uid')));
  assert.ok(statements.every(s=>!s.sql.includes('e.sender_uid<>e.recipient_uid')));
  assert.ok(statements.every(s=>s.sql.includes("g.tab IN (0,1)")));
  assert.ok(statements.every(s=>s.sql.includes('e.quantity*e.price_coins*p.')));
  assert.match(statements[0].sql,/h.host_uid,'host_salary',p.host_bps/);
  assert.match(statements[1].sql,/f.owner_uid,'agency',p.agency_bps/);
  assert.match(statements[2].sql,/f.bd_uid,'bd',p.bd_bps/);
  assert.match(statements[2].sql,/sharika_bd_agents b.*b.active=1/);
  assert.deepEqual(agencyGiftEarningStatements(statementDb,'sender','gift-request-123',2),[]);
  assert.ok(statements.every(s=>!s.sql.includes('UPDATE sharika_users')),
    'Pending earnings must never directly change balances');
});

function mockDb(){
  const queries=[];
  const db={
    prepare(sql){
      const stmt={sql,values:[],bind(...v){this.values=v;return this;},
        async first(){
          queries.push(this.sql);
          if(sql.includes('FROM sharika_users WHERE auth_uid=?'))
            return {auth_uid:'host',public_no:10000048,status:'active',name:'Ayesha'};
          if(sql.includes('FROM sharika_agency_policy'))return {
            active:1,host_bps:4000,agency_bps:1000,bd_bps:500,settlement_mode:'weekly'};
          if(sql.includes('FROM sharika_agency_salary_config'))return {
            coins_per_usd:500000,min_host_target_coins:5000000,exchange_enabled:0,version:1};
          if(sql.includes('FROM sharika_bd_agents WHERE bd_uid=?'))return {active:0};
          if(sql.includes('FROM sharika_families WHERE owner_uid=?'))return null;
          if(sql.includes('FROM sharika_agency_hosts h')&&sql.includes('WHERE h.host_uid=?'))
            return {active:1,family_id:1,family_name:'Royal'};
          return null;
        },
        async all(){queries.push(this.sql);return {results:[]};}
      };return stmt;
    }
  };return {db,queries};
}
test('authenticated host overview shows role and pending policy without wallet credit',async()=>{
  const {db}=mockDb();
  const path='/api/v1/agency/me';
  const result=await handleAgencyApp({request:new Request('https://test.invalid'+path),
    env:{DB:db},uid:'host',path,cors:{},reply,fail});
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.host.public_id,'10000048');
  assert.equal(data.policy.host_percent,40);
  assert.equal(data.policy.agency_percent,10);
  assert.equal(data.policy.bd_percent,5);
  assert.equal(data.payout_status,'pending_admin_verification');
  assert.equal(data.salary.min_host_target_coins,5000000);
  assert.equal(data.salary.exchange_enabled,false);
  assert.equal(data.coins,undefined);
});
test('finance cannot modify Host/Agency/BD policy',async()=>{
  const {db}=mockDb();
  const result=await handleAgencyAdmin({
    request:new Request('https://test.invalid/api/v1/admin/agency/policy',{
      method:'PATCH',body:JSON.stringify({enabled:true,host_bps:4000,
        agency_bps:1000,bd_bps:500,settlement_mode:'weekly'})}),
    env:{DB:db},uid:'finance',actor:{role:'finance'},operation:'agency/policy',
    cors:{},reply,fail
  });
  assert.equal(result.status,403);
});
test('salary exchange credits main wallet only in guarded D1 batch',async()=>{
  const {db}=mockDb(),operations=[];
  db.batch=async statements=>{operations.push(...statements);};
  const original=db.prepare.bind(db);
  db.prepare=sql=>{
    const statement=original(sql);
    if(sql.includes('FROM sharika_agency_salary_config'))statement.first=async()=>({
      coins_per_usd:500000,min_host_target_coins:5000000,
      exchange_enabled:1,version:1
    });
    return statement;
  };
  const path='/api/v1/agency/salary/exchange';
  const response=await handleAgencyApp({request:new Request('https://test.invalid'+path,{
    method:'POST',body:JSON.stringify({coins:40,expected_version:1,
      request_id:'salary-verified-123456'})}),
    env:{DB:db},uid:'host',path,cors:{},reply,fail});
  assert.equal(response.status,200);
  assert.equal(operations.length,3);
  assert.match(operations[0].sql,/INSERT INTO sharika_agency_salary_exchanges/);
  assert.match(operations[1].sql,/UPDATE sharika_users SET coins=CASE/);
  assert.match(operations[2].sql,/INSERT INTO sharika_wallet_ledger/);
  assert.equal(operations[0].values[2],400000);
  assert.equal(operations[1].values[1],40);
  assert.equal(operations[2].values[1],40);
});
test('salary target settings are Super Admin only',async()=>{
  const {db}=mockDb();
  const response=await handleAgencyAdmin({
    request:new Request('https://test.invalid/api/v1/admin/agency/salary/policy',{
      method:'PATCH',body:JSON.stringify({coins_per_usd:500000,
        exchange_enabled:true,targets:[5000000,10000000],expected_version:1})}),
    env:{DB:db},uid:'finance',actor:{role:'finance'},
    operation:'agency/salary/policy',cors:{},reply,fail});
  assert.equal(response.status,403);
});
test('packaged Agency UI has all three real-data screens and Android back navigation',()=>{
  const root=new URL('../../android-staging/',import.meta.url);
  const js=readFileSync(new URL('agency-center.js',root),'utf8');
  const native=readFileSync(new URL('staging-connection.js',root),'utf8');
  const back=readFileSync(new URL('back-navigation.js',root),'utf8');
  const gradle=readFileSync(new URL('app/build.gradle',root),'utf8');
  for(const required of ['BD Center','Host Roster','Host Earnings','Estimated Host Salary',
    '/agency/bd/center','/agency/hosts/assign','/agency/host/','Coin Transactions',
    'Crystal Wallet','Crystal Transfer','Crystal Coin Exchange','/agency/salary/exchange'])
    assert.ok(js.includes(required),required);
  assert.match(native,/sharikaOpenAgencyCenter/);
  assert.match(back,/sharikaAgencyBack/);
  assert.match(gradle,/agency-center\.js/);
  assert.match(gradle,/agency-center\.css/);
});

test('an Agency Owner can open Agency and Host earnings independently from main profile',()=>{
  const root=new URL('../../android-staging/',import.meta.url);
  const center=readFileSync(new URL('agency-center.js',root),'utf8');
  const profile=readFileSync(new URL('staging-connection.js',root),'utf8');
  assert.match(center,/prefer==='agency'&&me\.agency/);
  assert.match(center,/prefer==='host'&&me\.host\?\.active/);
  assert.match(center,/show\('host',me\.host\.public_id\)/);
  assert.match(profile,/id='sh-host-entry'/);
  assert.match(profile,/host\.hidden=true/);
  assert.match(profile,/tile\.hidden=!data\.host\?\.active/);
  assert.match(profile,/sharikaOpenAgencyCenter\?\.\('agency'\)/);
  assert.match(profile,/sharikaOpenAgencyCenter\?\.\('host'\)/);
  assert.match(profile,/sharika-agency-icons\/host\.webp/);
});
