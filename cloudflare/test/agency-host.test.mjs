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
test('salary transfer adds virtual seller stock with an immutable D1 receipt, never cash',async()=>{
  const {db}=mockDb(),operations=[];
  db.batch=async statements=>{operations.push(...statements);};
  const original=db.prepare.bind(db);
  db.prepare=sql=>{
    const statement=original(sql);
    if(sql.includes('FROM sharika_agency_salary_config'))statement.first=async()=>({
      coins_per_usd:500000,min_host_target_coins:5000000,
      exchange_enabled:1,version:1
    });
    if(sql.includes('FROM sharika_coin_sellers s'))statement.first=async()=>({
      seller_uid:'verified-seller',name:'Approved Seller'
    });
    return statement;
  };
  const path='/api/v1/agency/salary/transfer-to-seller';
  const response=await handleAgencyApp({request:new Request('https://test.invalid'+path,{
    method:'POST',body:JSON.stringify({seller_public_id:'10000053',coins:123,
      expected_version:1,request_id:'seller-virtual-123456'})}),
    env:{DB:db},uid:'host',path,cors:{},reply,fail});
  assert.equal(response.status,200);
  assert.equal(operations.length,2);
  assert.match(operations[0].sql,/INSERT INTO sharika_agency_salary_seller_transfers/);
  assert.match(operations[1].sql,/UPDATE sharika_coin_sellers SET available_coins/);
  assert.equal(operations[0].values[3],1230000);
  assert.equal(operations[1].values[0],123);
  assert.ok(operations.every(op=>!/bank|cash|withdraw|UPDATE sharika_users SET coins/i.test(op.sql)));
});
test('virtual seller transfer replay succeeds after a seller is suspended without a second credit',async()=>{
  const {db}=mockDb();
  db.batch=async()=>{throw Error('A replay must never credit twice');};
  const original=db.prepare.bind(db);
  db.prepare=sql=>{
    const stmt=original(sql);
    if(sql.includes('FROM sharika_agency_salary_seller_transfers t'))
      stmt.first=async()=>({seller_uid:'suspended-seller',seller_no:10000053,
        credited_coins:123});
    if(sql.includes('FROM sharika_coin_sellers s'))
      stmt.first=async()=>{throw Error('Replay must not query current seller approval');};
    return stmt;
  };
  const path='/api/v1/agency/salary/transfer-to-seller';
  const response=await handleAgencyApp({request:new Request('https://test.invalid'+path,{
    method:'POST',body:JSON.stringify({seller_public_id:'10000053',coins:123,
      expected_version:1,request_id:'seller-virtual-123456'})}),
    env:{DB:db},uid:'host',path,cors:{},reply,fail});
  assert.equal(response.status,200);
  assert.equal((await response.json()).duplicate,true);
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
    'Salary Wallet','/agency/salary/exchange','/agency/salary/transfer-to-seller'])
    assert.ok(js.includes(required),required);
  assert.match(native,/sharikaOpenAgencyCenter/);
  assert.match(back,/sharikaAgencyBack/);
  assert.match(gradle,/agency-center\.js/);
  assert.match(gradle,/agency-center\.css/);
  assert.match(gradle,/special-id-crest\.jpg/);
});

test('Agency screens keep a visible retry path and optional requests do not block discovery',()=>{
  const center=readFileSync(new URL('../../android-staging/agency-center.js',import.meta.url),'utf8');
  assert.match(center,/warnIfSlow\(token,\(\)=>show\(type,id,period,false\)\)/);
  assert.match(center,/warnIfSlow\(token,\(\)=>open\(prefer\)\)/);
  assert.match(center,/button\.textContent='Retry loading'/);
  assert.match(center,/Promise\.allSettled\(\[\s*api\('GET','\/agency\/discover'\)/);
  assert.match(center,/if\(discovery\.status==='rejected'\)throw discovery\.reason/);
  assert.match(center,/else await renderUnassigned\(token\)/);
});

test('room entry avoids sequential teardown delays and does not poll owner profile every three seconds',()=>{
  const room=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
  assert.match(room,/Date\.now\(\)-cachedOwner\.fetchedAt<60000/);
  assert.match(room,/room\.__sharikaOwnerLastAttempt=Date\.now\(\)/);
  assert.match(room,/room\.__sharikaOwnerProfileInFlight=api\('GET','\/users\/'\+room\.id\)/);
  assert.match(room,/data=await api\('GET','\/rooms\/'\+room\.id\+'\/members'\)/);
  assert.match(room,/await Promise\.all\(\[\s*releaseVoice\(\),api\('POST','\/rooms\/'.*prior\.id.*'\/leave'/);
  assert.match(room,/Verified seats are delayed\. Retry room details or go back to rooms/);
  assert.match(room,/Waiting for room authorization\. Go back and try again/);
  assert.match(room,/window\.__sharikaRetryVerifiedRoom/);
  assert.match(room,/window\.addEventListener\('online',\(\)=>\{\s*const room=window\.cur/);
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
  assert.match(profile,/hostTile\.hidden=!data\.host\?\.active/);
  assert.match(profile,/bdTile\.hidden=!data\.bd\?\.active/);
  assert.match(profile,/sharikaOpenAgencyCenter\?\.\('agency'\)/);
  assert.match(profile,/sharikaOpenAgencyCenter\?\.\('host'\)/);
  assert.match(profile,/sharika-agency-icons\/host\.webp/);
});

test('Agency Center native bridge explicitly permits needed member endpoints, not admin',()=>{
  const native=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const center=readFileSync(new URL('../../android-staging/agency-center.js',import.meta.url),'utf8');
  for(const path of ['me','bd/center','discover','create/requests','requests',
    'bd/agencies','create/request','join','bd/grant','hosts/assign','salary/exchange']){
    assert.ok(native.includes('"/api/v1/agency/'+path+'"'),path+' blocked by native allowlist');
  }
  assert.match(native,/api\/v1\/agency\/host\/\[0-9\]\{8\}\/earnings\\\\\?period=\(today\|week\|month\)/);
  assert.match(native,/api\/v1\/agency\/requests\/\[1-9\]/);
  assert.match(center,/data-ag-grant-submit/);
  assert.match(center,/data-ag-create-request/);
  assert.match(center,/data-ag-accept/);
  assert.doesNotMatch(native,/if \(path\.startsWith\("\/api\/v1\/agency"\)\)/);
});

test('Agency application works when retired Family onboarding is off but Agency policy is on',async()=>{
  const written=[];
  const db={prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},
    async first(){
      if(sql.includes('SELECT country FROM sharika_users'))return {country:'BD'};
      if(sql.includes('FROM sharika_users WHERE auth_uid=?'))
        return {auth_uid:'applicant',public_no:10000100,name:'Applicant',status:'active',minor:0};
      if(sql.includes('FROM sharika_agency_policy'))return {active:1};
      if(sql.includes('FROM sharika_family_policy'))return {active:0,max_members:20};
      if(sql.includes('FROM sharika_family_settlement_preferences'))return {mode:'monthly'};
      if(sql.includes('SELECT id FROM sharika_family_creation_requests'))return {id:71};
      if(sql.includes('FROM sharika_family_creation_requests WHERE requester_uid=?'))return null;
      if(sql.includes('FROM sharika_families WHERE name=?'))return null;
      return null;
    },
    async run(){written.push({sql,values:this.values});return {meta:{changes:1}};}
  };}};
  const path='/api/v1/agency/create/request';
  const response=await handleAgencyApp({request:new Request('https://test.invalid'+path,{
    method:'POST',body:JSON.stringify({name:'Royal Star BD',description:'',accept_rules:true})}),
    env:{DB:db},uid:'applicant',path,cors:{},reply,fail});
  assert.equal(response.status,201);
  assert.equal((await response.json()).request_id,71);
  assert.equal(written.length,1);
  assert.match(written[0].sql,/INSERT INTO sharika_family_creation_requests/);
  assert.equal(written[0].values[1],'Royal Star BD');
  assert.equal(written[0].values[3],'BD');
});

test('Agency onboarding cannot write when the separate Agency policy is disabled',async()=>{
  const {db}=mockDb();
  const prior=db.prepare.bind(db);
  db.prepare=sql=>{
    const statement=prior(sql);
    if(sql.includes('FROM sharika_agency_policy'))statement.first=async()=>({active:0});
    return statement;
  };
  const path='/api/v1/agency/join';
  const response=await handleAgencyApp({request:new Request('https://test.invalid'+path,{
    method:'POST',body:JSON.stringify({family_id:1})}),env:{DB:db},uid:'host',
    path,cors:{},reply,fail});
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'agency_disabled');
});
