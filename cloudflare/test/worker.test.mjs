import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { verifyFirebaseToken } from '../src/auth.mjs';
import { handleRequest, publicId, ageFromDate } from '../src/index.mjs';

globalThis.crypto ??= webcrypto;
const project = 'sharika-preview-1234';
const jwkUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
function encode(value) {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : (typeof value === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value)));
  return bytes.toString('base64url');
}
const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicKey = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-key-01', alg: 'RS256', use: 'sig' };
const certFetch = async url => {
  assert.equal(url, jwkUrl);
  return { ok: true, headers: new Headers({ 'cache-control': 'max-age=300' }),
    json: async () => ({ keys: [publicKey] }) };
};
async function token(changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', kid: 'test-key-01', typ: 'JWT' });
  const body = encode({
    aud: project, iss: 'https://securetoken.google.com/' + project,
    sub: 'secure-user', exp: now + 3600, iat: now - 60,
    auth_time: now - 60, email_verified: true, ...changes
  });
  const content = header + '.' + body;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(content));
  return content + '.' + encode(new Uint8Array(sig));
}
function fakeDb() {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const self = {
        sql, values: [],
        bind(...vals) { this.values = vals; return this; },
        async first() {
          calls.push(['first', sql, this.values]);
          if (sql.includes('SELECT 1')) return { ok: 1 };
          return null;
        },
        async all() { calls.push(['all', sql, this.values]); return { results: [] }; },
        async run() { calls.push(['run', sql, this.values]); return { success: true }; },
      };
      return self;
    },
    async batch(stmts) { calls.push(['batch', stmts]); return [{ success: true }, { success: true }]; }
  };
  return db;
}

test('profile identifiers are 8 digits; age validates real dates', () => {
  assert.equal(publicId(10000001), '10000001');
  assert.equal(ageFromDate('2020-02-30'), null);
  assert.equal(ageFromDate('2040-01-01'), null);
  assert.equal(ageFromDate('2000-01-01') > 13, true);
});
test('requires a cryptographically valid Firebase ID token', async () => {
  const jwt = await token();
  assert.equal((await verifyFirebaseToken('Bearer ' + jwt, project, certFetch))?.uid,
    'firebase:' + project + ':secure-user');
  assert.equal(await verifyFirebaseToken('Bearer ' + await token({ aud: 'wrong-project' }), project, certFetch), null);
  assert.equal(await verifyFirebaseToken('Bearer ' + await token({ exp: 1 }), project, certFetch), null);
  assert.equal(await verifyFirebaseToken('Bearer broken', project, certFetch), null);
  const sigPart = jwt.split('.')[2];
  const damaged = jwt.slice(0, -sigPart.length) + (sigPart[0] === 'A' ? 'B' : 'A') + sigPart.slice(1);
  assert.equal(await verifyFirebaseToken('Bearer ' + damaged, project, certFetch), null);
});
test('unknown HTTP origin is denied before credentials', async () => {
  const response = await handleRequest(new Request('https://example.test/health', { headers: { Origin: 'https://untrusted.example' } }),
    { DB: fakeDb(), FIREBASE_PROJECT_ID: project, ALLOWED_ORIGINS: 'https://sharika.example' });
  assert.equal(response.status, 403);
});
test('health checks database and never requires the user token', async () => {
  const response = await handleRequest(new Request('https://example.test/health'),
    { DB: fakeDb(), FIREBASE_PROJECT_ID: project });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environment, 'staging');
});
test('staging health reports D1 availability without opening protected APIs', async () => {
  const db = fakeDb();
  const response = await handleRequest(new Request('https://example.test/health'), { DB: db });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).auth_configured, false);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0][1], /SELECT 1/);
});
test('fails closed with no identity configuration', async () => {
  const response = await handleRequest(new Request('https://example.test/api/v1/me'), { DB: fakeDb() });
  assert.equal(response.status, 503);
});
test('private wallet rejects anonymous requests before D1 reads', async () => {
  const db = fakeDb();
  const response = await handleRequest(new Request('https://example.test/api/v1/wallet'),
    { DB: db, FIREBASE_PROJECT_ID: project });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});
test('verified but unregistered users cannot read someone else wallet', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = certFetch;
  try {
    const db = fakeDb();
    const response = await handleRequest(new Request('https://example.test/api/v1/wallet', {
      headers: { Authorization: 'Bearer ' + await token() }
    }), { DB: db, FIREBASE_PROJECT_ID: project });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'profile_not_found');
  } finally { globalThis.fetch = originalFetch; }
});
test('unimplemented money-changing endpoints fail closed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = certFetch;
  try {
    // Give the verified actor a real active profile; no money mutation should run.
    const db = fakeDb();
    const original = db.prepare.bind(db);
    db.prepare = sql => {
      const stmt = original(sql);
      if (sql.includes('FROM sharika_users WHERE auth_uid')) stmt.first = async () => ({ status:'active', coins:2000, diamonds:0, xp:0 });
      return stmt;
    };
    const response = await handleRequest(new Request('https://example.test/api/v1/exchange', {
      method: 'POST', headers: { Authorization: 'Bearer ' + await token() }, body: JSON.stringify({ diamonds: 500 })
    }), { DB: db, FIREBASE_PROJECT_ID: project });
    assert.equal(response.status, 501);
    assert.equal((await response.json()).error, 'migration_pending');
  } finally { globalThis.fetch = originalFetch; }
});

test('verified active users receive only the enabled D1 gift catalog',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const db=fakeDb(), old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active'});
      if(sql.includes('FROM sharika_gifts WHERE active=1'))
        stmt.all=async()=>({results:[{id:1,name:'Rose',emoji:'🌹',tab:0,price_coins:5}]});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/gifts',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,200);
    assert.equal((await res.json()).gifts[0].name,'Rose');
  }finally{globalThis.fetch=originalFetch;}
});

test('only the verified room owner can save room settings in D1',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const owner='firebase:'+project+':secure-user';
    const buildDb=(roomOwner,canUpdate=true)=>{
      const db=fakeDb(),old=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=old(sql);
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({status:'active'});
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
          stmt.first=async()=>({id:'10000001',owner_id:roomOwner,name:'My Room',seat_count:12});
        if(sql.startsWith('UPDATE sharika_rooms SET name='))
          stmt.run=async()=>({meta:{changes:canUpdate?1:0}});
        return stmt;
      };
      return db;
    };
    const request=async()=>new Request('https://example.test/api/v1/rooms/10000001',{
      method:'PATCH',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({name:'Fresh Room',seat_count:10})
    });
    const allowed=await handleRequest(await request(),{DB:buildDb(owner),FIREBASE_PROJECT_ID:project});
    assert.equal(allowed.status,200);
    const denied=await handleRequest(await request(),{DB:buildDb('other-owner'),FIREBASE_PROJECT_ID:project});
    assert.equal(denied.status,403);
    const occupied=await handleRequest(await request(),{DB:buildDb(owner,false),FIREBASE_PROJECT_ID:project});
    assert.equal(occupied.status,409);
    const changedTheme=await handleRequest(new Request(
      'https://example.test/api/v1/rooms/10000001',{
        method:'PATCH',headers:{Authorization:'Bearer '+await token()},
        body:JSON.stringify({name:'Fresh Room',seat_count:10,theme:'ocean'})
      }),{DB:buildDb(owner),FIREBASE_PROJECT_ID:project});
    assert.equal(changedTheme.status,200);
    const invalidTheme=await handleRequest(new Request(
      'https://example.test/api/v1/rooms/10000001',{
        method:'PATCH',headers:{Authorization:'Bearer '+await token()},
        body:JSON.stringify({name:'Fresh Room',seat_count:10,theme:'../../unsafe'})
      }),{DB:buildDb(owner),FIREBASE_PROJECT_ID:project});
    assert.equal(invalidTheme.status,400);
  }finally{globalThis.fetch=originalFetch;}
});

test('support history requires Firebase authentication and scopes reads to the signer',async()=>{
  const anon=await handleRequest(new Request('https://example.test/api/v1/support/messages'),{
    DB:fakeDb(),FIREBASE_PROJECT_ID:project
  });
  assert.equal(anon.status,401);
  const prior=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),orig=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=orig(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active'});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/support/messages',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,200);
    assert.deepEqual((await res.json()).messages,[]);
    const call=db.calls.find(c=>c[0]==='all' && c[1].includes('FROM sharika_support_messages'));
    assert.equal(call[2][0],'firebase:'+project+':secure-user');
  }finally{globalThis.fetch=prior;}
});

test('anonymous users cannot list follows or read private conversations',async()=>{
  for(const route of ['/api/v1/follows','/api/v1/messages','/api/v1/messages/10000003']){
    const response=await handleRequest(new Request('https://example.test'+route),{
      DB:fakeDb(),FIREBASE_PROJECT_ID:project
    });
    assert.equal(response.status,401,route);
  }
});

test('only the authenticated user can list their real following and followers',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))stmt.first=async()=>({status:'active'});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/follows',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,200);
    assert.deepEqual((await res.json()).following,[]);
    const queries=db.calls.filter(c=>c[0]==='all' && c[1].includes('sharika_follows'));
    assert.equal(queries.length,2);
    for(const q of queries)assert.equal(q[2].at(-1),'firebase:'+project+':secure-user');
  }finally{globalThis.fetch=prior;}
});

test('direct messages reject unilateral follows before storing anything',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))stmt.first=async()=>({status:'active'});
      if(sql.includes('FROM sharika_users WHERE public_no'))stmt.first=async()=>({
        auth_uid:'firebase:'+project+':recipient',public_no:10000003,
        name:'Recipient',status:'active'
      });
      if(sql.includes('SELECT follower_uid FROM sharika_follows'))stmt.all=async()=>({
        results:[{follower_uid:'firebase:'+project+':secure-user'}]
      });
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/messages/10000003',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({body:'hello',request_id:'verified_message_12345'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,403);
    assert.equal((await res.json()).error,'mutual_follow_required');
    assert.equal(db.calls.filter(c=>c[0]==='run' && c[1].includes('sharika_private_messages')).length,0);
  }finally{globalThis.fetch=prior;}
});

test('diamond exchange is authenticated and rejects invalid or unaffordable amounts',async()=>{
  const anon=await handleRequest(new Request('https://example.test/api/v1/wallet/exchange',{
    method:'POST',body:JSON.stringify({diamonds:100,request_id:'exchange_test_12345'})
  }),{DB:fakeDb(),FIREBASE_PROJECT_ID:project});
  assert.equal(anon.status,401);
  const originalFetch=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const makeDb=()=>{
      const db=fakeDb(),prior=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=prior(sql);
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({status:'active',minor:0,coins:2000,diamonds:500});
        return stmt;
      };
      return db;
    };
    const request=(diamonds)=>new Request('https://example.test/api/v1/wallet/exchange',{
      method:'POST',headers:{Authorization:'Bearer '+tokenValue},
      body:JSON.stringify({diamonds,request_id:'exchange_test_12345'})
    });
    const tokenValue=await token();
    const invalidDB=makeDb();
    const invalid=await handleRequest(request(125),{DB:invalidDB,FIREBASE_PROJECT_ID:project});
    assert.equal(invalid.status,400);
    assert.equal(invalidDB.calls.filter(c=>c[0]==='batch').length,0);
    const tooBigDB=makeDb();
    const tooBig=await handleRequest(request(1000),{DB:tooBigDB,FIREBASE_PROJECT_ID:project});
    assert.equal(tooBig.status,409);
    assert.equal((await tooBig.json()).error,'insufficient_diamonds');
    assert.equal(tooBigDB.calls.filter(c=>c[0]==='batch').length,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('diamond exchange batches both balances and immutable double-entry ledger',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',minor:0,coins:2000,diamonds:500});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/wallet/exchange',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({diamonds:100,request_id:'exchange_test_atomic123'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,200);
    assert.equal((await res.json()).credited_coins,70);
    const batch=db.calls.find(c=>c[0]==='batch');
    assert.equal(batch[1].length,4);
    assert.deepEqual(batch[1].map(s=>s.values[0]),[100,'firebase:'+project+':secure-user',70,'firebase:'+project+':secure-user']);
    assert.equal(batch[1][1].values[1],-100);
    assert.equal(batch[1][3].values[1],70);
  }finally{globalThis.fetch=originalFetch;}
});

test('replayed exchange request with a different amount is rejected',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',minor:0,coins:2000,diamonds:500});
      if(sql.includes("FROM sharika_wallet_ledger WHERE auth_uid")&&sql.includes("reason='diamond_exchange'"))
        stmt.first=async()=>({id:1,delta:-100});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/wallet/exchange',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({diamonds:500,request_id:'exchange_test_replay123'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,409);
    assert.equal((await res.json()).error,'idempotency_conflict');
    assert.equal(db.calls.some(c=>c[0]==='batch'),false);
  }finally{globalThis.fetch=originalFetch;}
});

test('room gifts require Firebase auth and a verified room membership',async()=>{
  const anon=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
    method:'POST',body:JSON.stringify({gift_id:9,quantity:1,
      recipient_public_ids:['10000001'],request_id:'gift_auth_12345678'})
  }),{DB:fakeDb(),FIREBASE_PROJECT_ID:project});
  assert.equal(anon.status,401);
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000});
      if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
        stmt.first=async()=>({id:'10000001',owner_id:'firebase:'+project+':secure-user'});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({gift_id:9,quantity:1,
        recipient_public_ids:['10000001'],request_id:'gift_auth_12345678'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,403);
    assert.equal(db.calls.some(c=>c[0]==='batch'),false);
  }finally{globalThis.fetch=prior;}
});

test('regular gift sending uses catalog price and atomically settles one coin debit with recipient XP',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const uid='firebase:'+project+':secure-user';
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000,diamonds:0});
      if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
        stmt.first=async()=>({id:'10000001',owner_id:uid});
      if(sql.startsWith('SELECT * FROM sharika_room_members WHERE room_id='))
        stmt.first=async()=>({room_id:'10000001',user_id:uid,role:'owner'});
      if(sql.includes('FROM sharika_gifts')&&sql.includes('tab IN (0,1,2)'))
        stmt.first=async()=>({id:9,name:'Rose',emoji:'🌹',price_coins:10,tab:0});
      if(sql.includes('JOIN sharika_room_members m ON m.user_id'))
        stmt.all=async()=>({results:[{auth_uid:uid,public_no:10000001,status:'active'}]});
      if(sql.startsWith('SELECT id,total_coins FROM sharika_gift_transactions'))
        stmt.first=async()=>({id:71,total_coins:50});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({gift_id:9,quantity:5,
        recipient_public_ids:['10000001'],request_id:'gift_atomic_12345678'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,201);
    const json=await res.json();
    assert.equal(json.spent_coins,50);
    assert.equal(json.room_reward_coins,5);
    assert.deepEqual(json.recipients,['10000001']);
    const stmts=db.calls.find(c=>c[0]==='batch')?.[1];
    assert.equal(stmts.length,7);
    assert.equal(stmts[0].values[0],50);
    assert.equal(stmts[2].values[1],-50);
    assert.equal(stmts[5].values[0],50);
    assert.equal(stmts[5].values[2],uid);
    assert.match(stmts[6].sql,/sharika_regular_room_rewards/);
    assert.equal(stmts[6].values[3],500);
  }finally{globalThis.fetch=prior;}
});

test('room rewards show immutable 10% ordinary-gift shares, never personal wallet credit',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const uid='firebase:'+project+':secure-user';
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000,diamonds:0});
      if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
        stmt.first=async()=>({id:'10000001',owner_id:uid});
      if(sql.startsWith('SELECT * FROM sharika_room_members WHERE room_id='))
        stmt.first=async()=>({room_id:'10000001',user_id:uid,role:'owner'});
      if(sql.includes('FROM sharika_regular_room_rewards WHERE room_id='))
        stmt.first=async()=>({points:1234});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/rewards',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project,SHARIKA_LUCKY_GIFTS_ENABLED:'false'});
    assert.equal(res.status,200);
    const data=await res.json();
    assert.equal(data.reward_hundredths,1234);
    assert.equal(data.regular_reward_hundredths,1234);
    assert.equal(data.reward_coins,12);
    assert.equal(data.reward_fraction_hundredths,34);
    assert.equal(data.owner_wallet_credited,false);
    assert.equal(data.withdrawal_enabled,false);
    assert.equal(db.calls.some(x=>x[1]?.includes?.('sharika_lucky_room_rewards')),false);
  }finally{globalThis.fetch=prior;}
});

test('lucky gifts cannot issue unverified payouts through the regular gift endpoint',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const uid='firebase:'+project+':secure-user';
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000});
      if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
        stmt.first=async()=>({id:'10000001',owner_id:uid});
      if(sql.startsWith('SELECT * FROM sharika_room_members WHERE room_id='))
        stmt.first=async()=>({room_id:'10000001',user_id:uid});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({gift_id:999,quantity:1,
        recipient_public_ids:['10000001'],request_id:'gift_lucky_block_123'})
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,404);
    assert.equal((await res.json()).error,'gift_unavailable');
    assert.equal(db.calls.some(c=>c[0]==='batch'),false);
  }finally{globalThis.fetch=prior;}
});


test('Lucky Gift requires an explicit virtual-only economy and checks age',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try {
    const uid='firebase:'+project+':secure-user';
    async function attempt(minor,enabled,redeemable) {
      const db=fakeDb(),old=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=old(sql);
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({status:'active',coins:2000,minor,birthdate:minor?'2016-01-01':'1998-01-01'});
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
          stmt.first=async()=>({id:'10000001',owner_id:uid});
        if(sql.startsWith('SELECT * FROM sharika_room_members WHERE room_id='))
          stmt.first=async()=>({room_id:'10000001',user_id:uid});
        if(sql.includes('FROM sharika_gifts')&&sql.includes('tab IN (0,1,2)'))
          stmt.first=async()=>({id:10,name:'Lucky Clover',emoji:'🍀',price_coins:10,tab:2});
        if(sql.includes('JOIN sharika_room_members m ON m.user_id'))
          stmt.all=async()=>({results:[{auth_uid:uid,public_no:10000001,status:'active'}]});
        return stmt;
      };
      const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
        method:'POST',headers:{Authorization:'Bearer '+await token()},
        body:JSON.stringify({gift_id:10,quantity:1,
          recipient_public_ids:['10000001'],request_id:'gift_lucky_age_123'})
      }),{DB:db,FIREBASE_PROJECT_ID:project,
        SHARIKA_LUCKY_GIFTS_ENABLED:enabled?'true':'false',
        SHARIKA_COINS_CASH_REDEEMABLE:redeemable});
      return {res,db};
    }
    const disabled=await attempt(0,false);
    assert.equal(disabled.res.status,503);
    assert.equal((await disabled.res.json()).error,'lucky_gifts_disabled');
    assert.equal(disabled.db.calls.some(c=>c[0]==='batch'),false);
    for(const economy of [undefined,'true']) {
      const blocked=await attempt(0,true,economy);
      assert.equal(blocked.res.status,403);
      assert.equal((await blocked.res.json()).error,'lucky_requires_non_redeemable_coins');
      assert.equal(blocked.db.calls.some(c=>c[0]==='batch'),false);
    }
    const minor=await attempt(1,true,'false');
    assert.equal(minor.res.status,403);
    assert.equal((await minor.res.json()).error,'lucky_gifts_adult_only');
    assert.equal(minor.db.calls.some(c=>c[0]==='batch'),false);
  }finally{globalThis.fetch=prior;}
});

test('verified adult Lucky Gift uses one wallet debit and receiver/room rewards',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try {
    const uid='firebase:'+project+':secure-user';
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000,birthdate:'1998-01-01',minor:0});
      if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id='))
        stmt.first=async()=>({id:'10000001',owner_id:uid});
      if(sql.startsWith('SELECT * FROM sharika_room_members WHERE room_id='))
        stmt.first=async()=>({room_id:'10000001',user_id:uid});
      if(sql.includes('FROM sharika_gifts')&&sql.includes('tab IN (0,1,2)'))
        stmt.first=async()=>({id:10,name:'Lucky Clover',emoji:'🍀',price_coins:10,tab:2});
      if(sql.includes('JOIN sharika_room_members m ON m.user_id'))
        stmt.all=async()=>({results:[{auth_uid:uid,public_no:10000001,status:'active'}]});
      if(sql.startsWith('SELECT id,total_coins FROM sharika_gift_transactions'))
        stmt.first=async()=>({id:75,total_coins:10});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms/10000001/gifts',{
      method:'POST',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({gift_id:10,quantity:1,
        recipient_public_ids:['10000001'],request_id:'gift_lucky_virtual_12345'})
    }),{DB:db,FIREBASE_PROJECT_ID:project,SHARIKA_LUCKY_GIFTS_ENABLED:'true',
      SHARIKA_COINS_CASH_REDEEMABLE:'false'});
    assert.equal(res.status,201);
    const receipt=await res.json();
    assert.equal(receipt.spent_coins,10);
    assert.equal(receipt.lucky.recipient_reward_diamonds,0.5);
    assert.equal(receipt.lucky.room_reward_coins,0.1);
    assert.ok([0,1,2,5,10,50].includes(receipt.lucky.max_multiplier));
    const stmts=db.calls.find(c=>c[0]==='batch')?.[1]||[];
    assert.equal(stmts.filter(x=>x.sql.startsWith('UPDATE sharika_users SET coins=CASE')).length,1);
    assert.equal(stmts.filter(x=>x.sql.includes('sharika_lucky_recipient_rewards')).length,1);
    assert.equal(stmts.filter(x=>x.sql.includes('sharika_lucky_room_rewards')).length,1);
    assert.equal(stmts.filter(x=>x.sql.includes('sharika_lucky_gift_outcomes')).length,1);
  }finally{globalThis.fetch=prior;}
});

test('virtual-only Lucky catalogue returns odds, but cashable coins remain hidden',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',coins:2000,birthdate:'1998-01-01',minor:0});
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/gifts',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project,SHARIKA_LUCKY_GIFTS_ENABLED:'true'});
    assert.equal(res.status,200);
    assert.equal((await res.json()).lucky_enabled,false);
    const catalog=db.calls.find(c=>c[0]==='all'&&c[1].includes('FROM sharika_gifts'));
    assert.ok(catalog);
    assert.equal(catalog[2][0],0);
    const allowed=await handleRequest(new Request('https://example.test/api/v1/gifts',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project,SHARIKA_LUCKY_GIFTS_ENABLED:'true',
      SHARIKA_COINS_CASH_REDEEMABLE:'false'});
    assert.equal(allowed.status,200);
    const data=await allowed.json();
    assert.equal(data.lucky_enabled,true);
    assert.equal(data.lucky_odds.reduce((sum,o)=>sum+o.probability_percent,0),100);
    const calls=db.calls.filter(c=>c[0]==='all'&&c[1].includes('FROM sharika_gifts'));
    assert.equal(calls.at(-1)[2][0],1);
  }finally{globalThis.fetch=prior;}
});

test('gift leaderboards require Firebase auth and use only settled gift events',async()=>{
  const unauth=await handleRequest(new Request('https://example.test/api/v1/rankings'),
    {DB:fakeDb(),FIREBASE_PROJECT_ID:project});
  assert.equal(unauth.status,401);
  const prior=globalThis.fetch;globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),old=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=old(sql);
      if(sql.startsWith('SELECT * FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active',public_no:10000001});
      if(sql.includes('FROM sharika_gift_events'))
        stmt.all=async()=>{db.calls.push(['all',sql,stmt.values]);return {results:[{public_no:10000002,name:'A real recipient',
          pic:null,wealth_level:1,charm_level:2,total:75}]};};
      if(sql.includes('FROM sharika_wallet_ledger l'))
        stmt.all=async()=>{db.calls.push(['all',sql,stmt.values]);return {results:[{public_no:10000003,name:'Verified buyer',
          pic:null,wealth_level:1,charm_level:1,total:2500}]};};
      return stmt;
    };
    const headers={Authorization:'Bearer '+await token()};
    const ok=await handleRequest(new Request(
      'https://example.test/api/v1/rankings?kind=charm&period=weekly',{headers}),
      {DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(ok.status,200);
    const data=await ok.json();
    assert.equal(data.source,'settled_gift_events');
    assert.equal(data.kind,'charm');
    assert.deepEqual(data.leaders.map(x=>[x.public_id,x.total]),[['10000002',75]]);
    const query=db.calls.find(c=>c[0]==='all'&&c[1].includes('FROM sharika_gift_events'));
    assert.ok(query);
    assert.equal(query[2].length,2);
    const recharge=await handleRequest(new Request(
      'https://example.test/api/v1/rankings?kind=recharge&period=weekly',{headers}),
      {DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(recharge.status,200);
    const rechargeData=await recharge.json();
    assert.equal(rechargeData.source,'verified_recharge_ledger');
    assert.equal(rechargeData.leaders[0].public_id,'10000003');
    assert.equal(rechargeData.leaders[0].total,2500);
    const bad=await handleRequest(new Request(
      'https://example.test/api/v1/rankings?kind=play&period=weekly',{headers}),
      {DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(bad.status,400);
    assert.equal((await bad.json()).error,'invalid_ranking_filter');
  }finally{globalThis.fetch=prior;}
});


test('room text chat requires verified membership and uses server identity',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const principal='firebase:'+project+':secure-user';
    const room='10000001';
    function roomDb(joined){
      const db=fakeDb(),old=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=old(sql);
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id=?'))
          stmt.first=async()=>({id:room,owner_id:'different-owner'});
        if(sql.includes('FROM sharika_room_members WHERE room_id=?'))
          stmt.first=async()=>joined?{user_id:principal,role:'member',seat_no:null}:null;
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({auth_uid:principal,status:'active',
            public_no:10000002,name:'Verified Sharika User'});
        return stmt;
      };
      return db;
    }
    const calls=[];
    const rooms={
      getByName(name){
        assert.equal(name,'sharika:'+room);
        return {
          async roomChatRead(after){calls.push(['read',after]);return {messages:[]};},
          async roomChatSend(...params){
            calls.push(['send',...params]);
            return {message:{id:1,sender_id:params[1],name:params[2],
              body:params[3],created_at_ms:Date.now()},duplicate:false};
          }
        };
      }
    };
    const headers={Authorization:'Bearer '+await token()};
    const endpoint='https://example.test/api/v1/rooms/'+room+'/chat';
    const noMember=await handleRequest(new Request(endpoint,{headers}),
      {DB:roomDb(false),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(noMember.status,403);
    assert.equal(calls.length,0);
    const read=await handleRequest(new Request(endpoint+'?after=17',{headers}),
      {DB:roomDb(true),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(read.status,200);
    assert.deepEqual(calls[0],['read',17]);
    const invalid=await handleRequest(new Request(endpoint,{
      method:'POST',headers,
      body:JSON.stringify({body:'x'.repeat(301),request_id:'chat:request-12345'})
    }),{DB:roomDb(true),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(invalid.status,400);
    assert.equal(calls.filter(c=>c[0]==='send').length,0);
    const posted=await handleRequest(new Request(endpoint,{
      method:'POST',headers,
      body:JSON.stringify({body:'Hello voice room',request_id:'chat:request-12345',
        sender_id:'99999999',name:'Fake owner'})
    }),{DB:roomDb(true),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(posted.status,201);
    const response=await posted.json();
    assert.equal(response.message.sender_id,'10000002');
    assert.equal(response.message.name,'Verified Sharika User');
    assert.deepEqual(calls.at(-1).slice(0,5),
      ['send',principal,'10000002','Verified Sharika User','Hello voice room']);
  }finally{globalThis.fetch=originalFetch;}
});

test('room chat denies unverified requests before reaching the coordinator',async()=>{
  const response=await handleRequest(new Request(
    'https://example.test/api/v1/rooms/10000001/chat',{
      method:'POST',body:JSON.stringify({body:'hello'})}),
    {DB:fakeDb(),FIREBASE_PROJECT_ID:project});
  assert.equal(response.status,401);
});


test('room seat locks are owner-only and stop seat claims on the server',async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const uid='firebase:'+project+':secure-user';
    const makeDb=(roomOwner,joined=true)=>{
      const db=fakeDb(),prepare=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=prepare(sql);
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id=?'))
          stmt.first=async()=>({id:'10000001',owner_id:roomOwner,seat_count:12});
        if(sql.includes('FROM sharika_room_members WHERE room_id=?'))
          stmt.first=async()=>joined?{room_id:'10000001',user_id:uid,
            seat_no:null,muted:0,role:'member'}:null;
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({status:'active',public_no:10000002,name:'Verified'});
        if(sql.includes('FROM sharika_room_members m'))
          stmt.all=async()=>({results:[]});
        return stmt;
      };
      return db;
    };
    const calls=[];
    const coordinator={
      async lockedSeats(){return [3];},
      async changeSeatLock(roomId,seat,locked){
        calls.push(['lock',roomId,seat,locked]);return {locked_seats:locked?[3]:[]};
      },
      async changeMemberSeat(roomId,userId,seat){
        calls.push(['seat',roomId,userId,seat]);
        return seat===3?{error:'seat_locked'}:{member:{seat_no:seat}};
      }
    };
    const rooms={getByName(name){
      assert.equal(name,'sharika:10000001');return coordinator;
    }};
    const headers={Authorization:'Bearer '+await token()};
    const lockRequest=()=>new Request('https://example.test/api/v1/rooms/10000001/locks',{
      method:'PUT',headers,body:JSON.stringify({seat_no:3,locked:true})
    });
    const denied=await handleRequest(lockRequest(),{
      DB:makeDb('other-owner'),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project
    });
    assert.equal(denied.status,403);
    assert.equal(calls.length,0);
    const allowed=await handleRequest(lockRequest(),{
      DB:makeDb(uid),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project
    });
    assert.equal(allowed.status,200);
    assert.deepEqual((await allowed.json()).locked_seats,[3]);
    const seat=await handleRequest(new Request(
      'https://example.test/api/v1/rooms/10000001/seat',{
        method:'PUT',headers,body:JSON.stringify({seat_no:3})
      }),{DB:makeDb('other-owner'),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(seat.status,409);
    assert.equal((await seat.json()).error,'seat_locked');
    const members=await handleRequest(new Request(
      'https://example.test/api/v1/rooms/10000001/members',{headers}),
      {DB:makeDb(uid),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(members.status,200);
    const memberSnapshot=await members.json();
    assert.equal(memberSnapshot.seat_count,12,
      'room seat count is returned for other members to refresh their view');
    assert.deepEqual(memberSnapshot.locked_seats,[3]);
    const notJoined=await handleRequest(new Request(
      'https://example.test/api/v1/rooms/10000001/members',{headers}),
      {DB:makeDb(uid,false),VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project});
    assert.equal(notJoined.status,403);
    assert.deepEqual(calls.map(x=>x[0]),['lock','seat']);
  }finally{globalThis.fetch=oldFetch;}
});

test('mic invitations require room owner, an unseated real member and recipient consent',async()=>{
  const previousFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try {
    const uid='firebase:'+project+':secure-user';
    const roomId='10000001';
    const base='https://example.test/api/v1/rooms/'+roomId+'/invitations';
    const headers={Authorization:'Bearer '+await token()};
    function roomDb(owner,joined=true,targetJoined=true){
      const db=fakeDb(),previous=db.prepare.bind(db);
      db.prepare=sql=>{
        const statement=previous(sql);
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id=?'))
          statement.first=async()=>({id:roomId,owner_id:owner,seat_count:12});
        if(sql.includes('FROM sharika_room_members WHERE room_id=?'))
          statement.first=async()=>joined?{user_id:uid,seat_no:null,role:'member'}:null;
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          statement.first=async()=>({auth_uid:uid,status:'active',public_no:10000002});
        if(sql.includes('SELECT u.auth_uid,u.status,m.seat_no FROM sharika_room_members m'))
          statement.first=async()=>targetJoined?{
            auth_uid:'target-uid',status:'active',seat_no:null
          }:null;
        return statement;
      };
      return db;
    }
    const calls=[];
    const rooms={getByName(name){
      assert.equal(name,'sharika:'+roomId);
      return {
        async seatInvitePending(user){calls.push(['pending',user]);return {invite:null};},
        async seatInviteSend(...args){
          calls.push(['send',...args]);
          return {seat_no:args[3],invited_at_ms:1,expires_at_ms:2};
        },
        async seatInviteRespond(...args){
          calls.push(['respond',...args]);
          return {accepted:args[3],seat_no:args[2]};
        }
      };
    }};
    const post=(body)=>new Request(base,{
      method:'POST',headers,body:JSON.stringify(body)
    });
    const correct={seat_no:4,target_public_id:'10000003'};
    const env=(owner,joined=true,targetJoined=true)=>({
      DB:roomDb(owner,joined,targetJoined),
      VOICE_ROOMS:rooms,FIREBASE_PROJECT_ID:project
    });
    const denied=await handleRequest(post(correct),env('different-owner'));
    assert.equal(denied.status,403);
    assert.equal(calls.length,0);
    const outsider=await handleRequest(new Request(base,{headers}),env(uid,false));
    assert.equal(outsider.status,403);
    const missing=await handleRequest(post(correct),env(uid,true,false));
    assert.equal(missing.status,409);
    assert.equal(calls.length,0);
    const invalid=await handleRequest(post({seat_no:25,target_public_id:'10000003'}),env(uid));
    assert.equal(invalid.status,400);
    const sent=await handleRequest(post(correct),env(uid));
    assert.equal(sent.status,201);
    assert.deepEqual(calls[0],['send',roomId,uid,'target-uid',4]);
    const pending=await handleRequest(new Request(base,{headers}),env('different-owner'));
    assert.equal(pending.status,200);
    assert.deepEqual(calls[1],['pending',uid]);
    const response=(body)=>new Request(base+'/respond',{
      method:'POST',headers,body:JSON.stringify(body)
    });
    const bad=await handleRequest(response({seat_no:4,accept:'true'}),env('different-owner'));
    assert.equal(bad.status,400);
    const accepted=await handleRequest(response({seat_no:4,accept:true}),env('different-owner'));
    assert.equal(accepted.status,200);
    assert.equal((await accepted.json()).accepted,true);
    assert.deepEqual(calls[2],['respond',roomId,uid,4,true]);
    const declined=await handleRequest(response({seat_no:4,accept:false}),env('different-owner'));
    assert.equal(declined.status,200);
    assert.equal((await declined.json()).accepted,false);
  }finally{globalThis.fetch=previousFetch;}
});

test('mic invitations deny unauthenticated users before any database lookups',async()=>{
  const db=fakeDb();
  const response=await handleRequest(new Request(
    'https://example.test/api/v1/rooms/10000001/invitations'),{
    DB:db,FIREBASE_PROJECT_ID:project
  });
  assert.equal(response.status,401);
  assert.equal(db.calls.length,0);
});


test('room card image is publicly readable but cannot be edited without a verified login',async()=>{
  const db=fakeDb();
  const photo=Buffer.from([255,216,255,...Array(36).fill(3),255,217]);
  const prev=db.prepare.bind(db);
  db.prepare=sql=>{
    const stmt=prev(sql);
    if(sql.includes('SELECT mime,image_base64,version FROM sharika_room_covers'))
      stmt.first=async()=>({mime:'image/jpeg',image_base64:photo.toString('base64'),version:2});
    return stmt;
  };
  const path='https://example.test/api/v1/rooms/10000001/cover';
  const publicImage=await handleRequest(new Request(path,{headers:{Origin:'https://untrusted.example'}}),{DB:db,FIREBASE_PROJECT_ID:project});
  assert.equal(publicImage.status,200);
  assert.equal(publicImage.headers.get('content-type'),'image/jpeg');
  assert.equal(publicImage.headers.get('access-control-allow-origin'),'*');
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),photo);
  const anonymous=await handleRequest(new Request(path,{
    method:'PUT',body:JSON.stringify({image_data:'data:image/jpeg;base64,'+photo.toString('base64')})
  }),{DB:db,FIREBASE_PROJECT_ID:project});
  assert.equal(anonymous.status,401);
  assert.equal(db.calls.some(c=>c[0]==='run'),false);
});

test('room owner can upload a bounded photo and non-owners cannot change it',async()=>{
  const prevFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const actor='firebase:'+project+':secure-user';
    const room='10000001';
    const jpeg=Buffer.from([255,216,255,...Array(36).fill(3),255,217]);
    const image_data='data:image/jpeg;base64,'+jpeg.toString('base64');
    function makeDb(owner,changes=1){
      const db=fakeDb(),prev=db.prepare.bind(db);
      db.prepare=sql=>{
        const stmt=prev(sql);
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({status:'active'});
        if(sql.startsWith('SELECT * FROM sharika_rooms WHERE id=?'))
          stmt.first=async()=>({id:room,owner_id:owner});
        if(sql.startsWith('INSERT INTO sharika_room_covers'))
          stmt.run=async()=>{db.calls.push(['cover_run',sql,stmt.values]);return {meta:{changes}};};
        if(sql.startsWith('SELECT version,image_bytes FROM sharika_room_covers'))
          stmt.first=async()=>({version:2,image_bytes:jpeg.length});
        return stmt;
      };
      return db;
    }
    async function request(payload){
      return new Request('https://example.test/api/v1/rooms/'+room+'/cover',{
        method:'PUT',headers:{Authorization:'Bearer '+await token()},
        body:JSON.stringify({image_data:payload})
      });
    }
    const outsiderDb=makeDb('other-person');
    const outsider=await handleRequest(await request(image_data),{DB:outsiderDb,FIREBASE_PROJECT_ID:project});
    assert.equal(outsider.status,403);
    assert.equal(outsiderDb.calls.some(c=>c[0]==='cover_run'),false);
    const invalidDb=makeDb(actor);
    const invalid=await handleRequest(await request('data:image/png;base64,'+jpeg.toString('base64')),
      {DB:invalidDb,FIREBASE_PROJECT_ID:project});
    assert.equal(invalid.status,400);
    assert.equal(invalidDb.calls.some(c=>c[0]==='cover_run'),false);
    const ownerDb=makeDb(actor);
    const saved=await handleRequest(await request(image_data),
      {DB:ownerDb,FIREBASE_PROJECT_ID:project});
    assert.equal(saved.status,200);
    const savedBody=await saved.json();
    assert.equal(savedBody.cover_url,'https://example.test/api/v1/rooms/10000001/cover?v=2');
    assert.equal(savedBody.image_bytes,jpeg.length);
    assert.equal(ownerDb.calls.some(c=>c[0]==='cover_run'),true);
    const repeat=await handleRequest(await request(image_data),
      {DB:makeDb(actor,0),FIREBASE_PROJECT_ID:project});
    assert.equal(repeat.status,429);
  }finally{globalThis.fetch=prevFetch;}
});

test('room listing returns only a versioned cover image URL, never image bytes',async()=>{
  const prevFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const db=fakeDb(),prev=db.prepare.bind(db);
    db.prepare=sql=>{
      const stmt=prev(sql);
      if(sql.includes('FROM sharika_users WHERE auth_uid'))
        stmt.first=async()=>({status:'active'});
      if(sql.includes('FROM sharika_rooms r LEFT JOIN sharika_room_covers c')){
        stmt.all=async()=>({results:[
          {id:'10000001',name:'Room with cover',cover_version:7},
          {id:'10000002',name:'No cover',cover_version:null}
        ]});
      }
      return stmt;
    };
    const res=await handleRequest(new Request('https://example.test/api/v1/rooms',{
      headers:{Authorization:'Bearer '+await token()}
    }),{DB:db,FIREBASE_PROJECT_ID:project});
    assert.equal(res.status,200);
    const result=await res.json();
    assert.equal(result.rooms[0].cover_url,'https://example.test/api/v1/rooms/10000001/cover?v=7');
    assert.equal(result.rooms[1].cover_url,null);
    assert.equal(JSON.stringify(result).includes('image_base64'),false);
  }finally{globalThis.fetch=prevFetch;}
});

test('profile avatar is public JPEG but only an authenticated user can upload',async()=>{
  const db=fakeDb(),jpeg=Buffer.from([255,216,255,...Array(36).fill(5),255,217]);
  const original=db.prepare.bind(db);
  db.prepare=sql=>{
    const stmt=original(sql);
    if(sql.includes('SELECT a.image_base64 FROM sharika_user_avatars'))
      stmt.first=async()=>({image_base64:jpeg.toString('base64')});
    return stmt;
  };
  const endpoint='https://example.test/api/v1/users/10000001/avatar';
  const image=await handleRequest(new Request(endpoint,{headers:{Origin:'https://untrusted.example'}}),
    {DB:db,FIREBASE_PROJECT_ID:project});
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/jpeg');
  assert.equal(image.headers.get('access-control-allow-origin'),'*');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);
  const withoutLogin=await handleRequest(new Request('https://example.test/api/v1/me/avatar',{
    method:'PUT',body:JSON.stringify({image_data:'data:image/jpeg;base64,'+jpeg.toString('base64')})
  }),{DB:db,FIREBASE_PROJECT_ID:project});
  assert.equal(withoutLogin.status,401);
  assert.equal(db.calls.some(c=>c[0]==='run'),false);
});

test('profile avatar validates JPEG, persists only to own ID, and rate limits replacement',async()=>{
  const beforeFetch=globalThis.fetch;
  globalThis.fetch=certFetch;
  try{
    const userId='firebase:'+project+':secure-user';
    const jpeg=Buffer.from([255,216,255,...Array(36).fill(7),255,217]);
    const image_data='data:image/jpeg;base64,'+jpeg.toString('base64');
    function dbWithUser(changes=1){
      const db=fakeDb(),original=db.prepare.bind(db);
      let userPic=null;
      db.prepare=sql=>{
        const stmt=original(sql);
        if(sql.includes('SELECT * FROM sharika_users WHERE auth_uid'))
          stmt.first=async()=>({auth_uid:userId,public_no:10000001,name:'Guest',status:'active',pic:userPic});
        if(sql.startsWith('INSERT INTO sharika_user_avatars'))
          stmt.run=async()=>{db.calls.push(['avatar_run',sql,stmt.values]);return {meta:{changes}};};
        if(sql.startsWith('SELECT version FROM sharika_user_avatars'))
          stmt.first=async()=>({version:2});
        if(sql.startsWith('UPDATE sharika_users SET pic='))
          stmt.run=async()=>{userPic=stmt.values[0];db.calls.push(['profile_pic',sql,stmt.values]);return {meta:{changes:1}};};
        return stmt;
      };
      return db;
    }
    const req=async payload=>new Request('https://example.test/api/v1/me/avatar',{
      method:'PUT',headers:{Authorization:'Bearer '+await token()},
      body:JSON.stringify({image_data:payload})
    });
    const invalidDb=dbWithUser();
    const invalid=await handleRequest(await req('data:image/png;base64,'+jpeg.toString('base64')),
      {DB:invalidDb,FIREBASE_PROJECT_ID:project});
    assert.equal(invalid.status,400);
    assert.equal(invalidDb.calls.some(c=>c[0]==='avatar_run'),false);
    const goodDb=dbWithUser();
    const saved=await handleRequest(await req(image_data),{DB:goodDb,FIREBASE_PROJECT_ID:project});
    assert.equal(saved.status,200);
    assert.equal((await saved.json()).pic,'https://example.test/api/v1/users/10000001/avatar?v=2');
    assert.equal(goodDb.calls.some(c=>c[0]==='avatar_run'),true);
    assert.equal(goodDb.calls.some(c=>c[0]==='profile_pic'),true);
    const limited=await handleRequest(await req(image_data),{
      DB:dbWithUser(0),FIREBASE_PROJECT_ID:project
    });
    assert.equal(limited.status,429);
  }finally{globalThis.fetch=beforeFetch;}
});
