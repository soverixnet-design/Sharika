import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPlayTesters } from '../src/play-tester-admin.mjs';

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
        return Response.json({ role }, { status: role === null ? 403 : 200 });
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

test('Admin frontend exposes a separate Play tester page without Play wallet edits', () => {
  const root = new URL('../../', import.meta.url);
  const frontend = readFileSync(new URL('cloudflare/src/admin-frontend-worker.mjs', root), 'utf8');
  const ui = readFileSync(new URL('admin/connection.js', root), 'utf8');
  const config = readFileSync(new URL('cloudflare/wrangler.admin.jsonc', root), 'utf8');
  assert.match(frontend, /path === '\/api\/v1\/admin\/play-testers'/);
  assert.match(ui, /P\.playTesters=async function/);
  assert.match(ui, /previous_staging_id/);
  assert.match(ui, /role!=='super'/);
  assert.match(config, /"binding": "PLAY_DB"/);
  assert.match(config, /"binding": "STAGING_DB"/);
});
