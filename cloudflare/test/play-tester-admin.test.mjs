import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readPlayTesters, handlePlayTestAdmin } from '../src/play-tester-admin.mjs';

function harness(role = 'super') {
  const calls = [];
  const play = [
    { auth_uid: 'play-uid-1', public_no: 10000001, name: 'New Tester', country: 'BD',
      status: 'active', created_at: '2026-11-09' },
    { auth_uid: 'shared-google-uid', public_no: 10000002, name: 'Shakil', country: 'BD',
      status: 'active', created_at: '2026-11-09' }
  ];
  const staging = [
    { auth_uid: 'unrelated-old-user', public_no: 10000001 },
    { auth_uid: 'shared-google-uid', public_no: 10000003 }
  ];
  const env = {
    SHARIKA_API: {
      async fetch(request) {
        calls.push(['role_check', request.url, request.headers.get('authorization')]);
        return Response.json({ role, public_id: '10000009' }, { status: role === null ? 403 : 200 });
      }
    },
    PLAY_DB: {
      prepare(sql) {
        calls.push(['play_sql', sql]);
        return {
          bind(...params) { calls.push(['play_bind', params]); return this; },
          async all() { return { results: play }; }
        };
      }
    },
    STAGING_DB: {
      prepare(sql) {
        calls.push(['staging_sql', sql]);
        return {
          bind(...params) {
            calls.push(['staging_bind', params]);
            this.params = params;
            return this;
          },
          async all() {
            return { results: staging.filter(person => this.params.includes(person.auth_uid)) };
          }
        };
      }
    }
  };
  return { env, calls };
}

async function get(env, route = '/api/v1/admin/play-testers', bearer = 'Bearer valid_jwt', method = 'GET') {
  const response = await readPlayTesters(new Request('https://admin.test' + route,
    { method, headers: bearer ? { authorization: bearer } : {} }), env);
  return { status: response.status, data: await response.json(), headers: response.headers };
}

test('only verified old staging Super Admin can view Play tester records', async () => {
  for (const role of ['finance', 'support', 'staff', null]) {
    const { env, calls } = harness(role);
    const result = await get(env);
    assert.equal(result.status, 403);
    assert.equal(calls.filter(call => call[0] === 'play_sql').length, 0,
      'must not access Play user DB before role verification');
  }
  const { env, calls } = harness();
  assert.equal((await get(env, '/api/v1/admin/play-testers', '')).status, 401);
  assert.equal(calls.length, 0);
});

test('Play IDs and old staging IDs map ONLY by verified Firebase UID', async () => {
  const { env, calls } = harness();
  const result = await get(env);
  assert.equal(result.status, 200);
  assert.equal(result.data.read_only, true);
  assert.equal(result.data.identity_match, 'firebase_uid');
  assert.equal(result.data.users[0].public_id, '10000001');
  assert.equal(result.data.users[0].previous_staging_id, null,
    'do not map a colliding public number to a different Google identity');
  assert.equal(result.data.users[1].public_id, '10000002');
  assert.equal(result.data.users[1].previous_staging_id, '10000003');
  assert.equal(JSON.stringify(result.data).includes('shared-google-uid'), false);
  assert.equal(JSON.stringify(result.data).includes('auth_uid'), false);
  assert.deepEqual(calls.find(call => call[0] === 'staging_bind')[1],
    ['play-uid-1', 'shared-google-uid']);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('Play testers list is read-only, bounded and requires all private services', async () => {
  const { env } = harness();
  assert.equal((await get(env, '/api/v1/admin/play-testers', 'Bearer valid_jwt', 'POST')).status, 405);
  assert.equal((await get(env, '/api/v1/admin/play-testers?random=1')).status, 400);
  assert.equal((await get(env, '/api/v1/admin/play-testers?q=' + 'x'.repeat(81))).status, 400);
  delete env.PLAY_DB;
  assert.equal((await get(env)).status, 503);
});

test('Admin frontend routes Play grants only to the isolated test handler', () => {
  const root = new URL('../../', import.meta.url);
  const frontend = readFileSync(new URL('cloudflare/src/admin-frontend-worker.mjs', root), 'utf8');
  const ui = readFileSync(new URL('admin/connection.js', root), 'utf8');
  const config = readFileSync(new URL('cloudflare/wrangler.admin.jsonc', root), 'utf8');
  assert.match(frontend, /path === '\/api\/v1\/admin\/play-testers'/);
  assert.match(frontend, /handlePlayTestAdmin\(request, env\)/);
  assert.match(ui, /P\.playTesters=async function/);
  assert.match(ui, /previous_staging_id/);
  assert.match(ui, /role!=='super'/);
  assert.match(ui, /api\('POST','play-testers\/coins'/);
  assert.match(ui, /api\('POST','play-testers\/cosmetics\/grant'/);
  assert.match(ui, /NON-REDEEMABLE TEST coins/);
  assert.match(frontend, /path\.startsWith\('\/api\/v1\/admin\/play-testers\/'\)/);
  assert.match(config, /"binding": "PLAY_DB"/);
  assert.match(config, /"binding": "STAGING_DB"/);
});

function isolatedPlayDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE sharika_users(public_no INTEGER PRIMARY KEY,auth_uid TEXT UNIQUE NOT NULL,'+
    "name TEXT,country TEXT,status TEXT DEFAULT 'active',coins INTEGER DEFAULT 0 CHECK(coins>=0),"+
    "diamonds INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)");
  db.exec("INSERT INTO sharika_users VALUES (10000001,'play-uid-1','Tester','BD','active',245,5,'2026-11-10',NULL)");
  db.exec("INSERT INTO sharika_users VALUES (10000002,'play-uid-2','Blocked','BD','blocked',0,0,'2026-11-10',NULL)");
  db.exec('CREATE TABLE sharika_wallet_ledger(id INTEGER PRIMARY KEY,auth_uid TEXT REFERENCES sharika_users(auth_uid),'+
    'currency TEXT,delta INTEGER,balance_after INTEGER,reason TEXT,request_id TEXT,UNIQUE(auth_uid,currency,request_id))');
  db.exec('CREATE TABLE sharika_admin_direct_recharges(id INTEGER PRIMARY KEY,actor_uid TEXT,'+
    'recipient_uid TEXT REFERENCES sharika_users(auth_uid),coins INTEGER,reason TEXT,'+
    'request_id TEXT,balance_after INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(actor_uid,request_id))');
  db.exec('CREATE TABLE sharika_cosmetics_catalog(id TEXT PRIMARY KEY,kind TEXT,name TEXT,active INTEGER DEFAULT 1)');
  db.exec("INSERT INTO sharika_cosmetics_catalog VALUES ('frame_style:royal-gold','frame_style','Royal Gold',1)");
  db.exec('CREATE TABLE sharika_cosmetic_inventory(auth_uid TEXT REFERENCES sharika_users(auth_uid),'+
    'item_id TEXT REFERENCES sharika_cosmetics_catalog(id),source TEXT,request_id TEXT,'+
    'PRIMARY KEY(auth_uid,item_id),UNIQUE(auth_uid,request_id))');
  db.exec('CREATE TABLE sharika_cosmetic_equipped(auth_uid TEXT REFERENCES sharika_users(auth_uid),'+
    'kind TEXT,item_id TEXT, equipped_at TEXT,PRIMARY KEY(auth_uid,kind))');
  db.exec(readFileSync(new URL('../migrations/0080_play_closed_test_admin_item_grants.sql',
    import.meta.url),'utf8'));
  db.exec('CREATE TABLE sharika_notifications(id INTEGER PRIMARY KEY,recipient_uid TEXT,kind TEXT,'+
    "title TEXT,body TEXT,dedupe_key TEXT,created_by TEXT,read_at TEXT,push_status TEXT DEFAULT 'pending',"+
    'created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(recipient_uid,dedupe_key))');
  const play = {
    prepare(query) {
      const statement = db.prepare(query);
      const prepared = {
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() { return statement.get(...this.params) || null; },
        async all() { return { results: statement.all(...this.params) }; },
        async run() {
          const result = statement.run(...this.params);
          return { meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        }
      };
      return prepared;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  const env = {
    PLAY_DB: play, STAGING_DB: { prepare() { throw Error('staging write forbidden'); } },
    SHARIKA_API: { async fetch() { return Response.json({ role: 'super', public_id: '10000009' }); } }
  };
  return { env, db };
}

async function virtual(env, method, path, body, token = 'Bearer verified') {
  const result = await handlePlayTestAdmin(new Request('https://admin.test/api/v1/admin/'+path,{
    method, headers: { authorization: token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }),env);
  return { status: result.status, data: await result.json() };
}

test('Play coins are isolated, idempotent, audited and visible in Play wallet', async () => {
  const { env, db } = isolatedPlayDatabase();
  try {
    const payload = { target_public_id:'10000001', coins:500, reason:'QA test allocation',
      request_id:'play-credit:abc12345' };
    const first=await virtual(env,'POST','play-testers/coins',payload);
    assert.equal(first.status,201);
    assert.equal(first.data.balance_after,745);
    assert.equal(first.data.environment,'play_virtual');
    const again=await virtual(env,'POST','play-testers/coins',payload);
    assert.equal(again.status,200);
    assert.equal(again.data.duplicate,true);
    assert.equal(db.prepare('SELECT coins FROM sharika_users WHERE public_no=10000001').get().coins,745);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_wallet_ledger').get().n,1);
    assert.equal(db.prepare('SELECT reason FROM sharika_wallet_ledger').get().reason,
      'play_virtual_admin_credit');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_notifications').get().n,1);
    assert.equal((await virtual(env,'POST','play-testers/coins',{...payload,coins:501})).status,409);
    assert.equal((await virtual(env,'POST','play-testers/coins',{
      ...payload,target_public_id:'10000002',request_id:'play-credit:blocked-123'
    })).status,409);
    assert.equal((await virtual(env,'POST','play-testers/coins',{
      ...payload,coins:1000001,request_id:'play-credit:overcap-123'
    })).status,400);
  } finally { db.close(); }
});

test('Play cosmetic grant equips only the selected test UID and has immutable receipt', async () => {
  const { env, db } = isolatedPlayDatabase();
  try {
    const payload = {target_public_id:'10000001',item_id:'frame_style:royal-gold',
      request_id:'play-item:unique-12345'};
    const first=await virtual(env,'POST','play-testers/cosmetics/grant',payload);
    assert.equal(first.status,201);
    assert.equal(first.data.equipped,true);
    assert.equal((await virtual(env,'POST','play-testers/cosmetics/grant',payload)).data.duplicate,true);
    const equipped=db.prepare('SELECT auth_uid,item_id FROM sharika_cosmetic_equipped').get();
    assert.equal(equipped.auth_uid,'play-uid-1');
    assert.equal(equipped.item_id,'frame_style:royal-gold');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_play_admin_item_grants').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sharika_notifications').get().n,1);
    assert.throws(()=>db.exec('DELETE FROM sharika_play_admin_item_grants'),/play_grant_immutable/);
    assert.equal((await virtual(env,'POST','play-testers/cosmetics/grant',{
      ...payload,target_public_id:'10000002'
    })).status,404);
  } finally { db.close(); }
});

test('Play test writes fail closed for non-Super and malformed recipients', async()=>{
  const { env, db }=isolatedPlayDatabase();
  try {
    env.SHARIKA_API.fetch=async()=>Response.json({role:'finance',public_id:'10000009'});
    assert.equal((await virtual(env,'POST','play-testers/coins',{
      target_public_id:'10000001',coins:10,reason:'QA test only',request_id:'play-credit:denied-123'
    })).status,403);
    env.SHARIKA_API.fetch=async()=>Response.json({role:'super',public_id:'10000009'});
    assert.equal((await virtual(env,'POST','play-testers/coins',{
      target_public_id:'10000003',coins:10,reason:'QA test only',request_id:'play-credit:missing-123'
    })).status,404);
    assert.equal((await virtual(env,'POST','play-testers/coins',{
      target_public_id:'10000001',coins:10,reason:'QA test only',request_id:'play-credit:denied-123'
    },'')).status,401);
    assert.equal(db.prepare('SELECT coins FROM sharika_users WHERE public_no=10000001').get().coins,245);
    assert.equal((await virtual(env,'GET','play-testers/catalog')).status,200);
    assert.equal((await virtual(env,'GET','play-testers/credits')).status,200);
  } finally { db.close(); }
});

test('main Admin Users view shows both environments and never sends Play IDs to staging block controls',()=>{
  const ui=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  const start=ui.indexOf('  P.users=async function');
  const end=ui.indexOf('  P.playTesters=async function',start);
  assert.ok(start>=0 && end>start);
  const users=ui.slice(start,end);
  assert.match(users,/Verified users · Staging/);
  assert.match(users,/Verified users · Play closed test/);
  assert.match(users,/api\('GET','play-testers'\+suffix\)/);
  assert.match(users,/Promise\.allSettled/);
  assert.match(users,/view only until ID reconciliation/);
  assert.match(users,/data-status-id/);
  assert.match(users,/Play balances and roles are never combined/);
});

test('admin user search takes direct credit to the correct isolated wallet screen',()=>{
  const ui=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');
  assert.match(ui,/data-credit-staging=/);
  assert.match(ui,/pendingStagingCreditTarget=credit\.dataset\.creditStaging/);
  assert.match(ui,/window\.V='rech';window\.shell\(\)/);
  assert.match(ui,/data-credit-play=/);
  assert.match(ui,/pendingPlayCreditTarget=credit\.dataset\.creditPlay/);
  assert.match(ui,/window\.V='playTesters';window\.shell\(\)/);
  assert.match(ui,/byId\('direct-user'\)\.value=pendingStagingCreditTarget/);
  assert.match(ui,/byId\('play-credit-id'\)\.value=pendingPlayCreditTarget/);
});
