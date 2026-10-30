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
