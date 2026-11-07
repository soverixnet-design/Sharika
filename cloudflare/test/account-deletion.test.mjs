import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicAccountDeletion, handleAdminAccountDeletion } from '../src/account-deletion.mjs';

function db() {
  const rows = [];
  const calls = [];
  return {
    rows, calls,
    prepare(sql) {
      calls.push(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('sharika_admin_roles')) return { role: args[0] === 'super-user' ? 'super' : 'member' };
              if (sql.includes('account_deletion_requests')) return rows.find(r => r.public_id === args[0] && r.contact_email === args[1]) || null;
              return null;
            },
            async run() { rows.push({ public_id: args[0], contact_email: args[1], reason: args[2] }); return { success: true }; },
          };
        },
        async all() { return { results: rows }; },
      };
    }
  };
}

function request(body, headers = {}) {
  return new Request('https://sharika.example/account-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://sharika.example', ...headers },
    body: new URLSearchParams(body).toString()
  });
}

const valid = { public_id: '1010', contact_email: 'Player@Example.org', reason: 'Please delete my account', confirm: 'yes' };

test('public deletion form is available anonymously and has secure response headers', async () => {
  const response = await handlePublicAccountDeletion(new Request('https://sharika.example/account-deletion'), {}, '/account-deletion');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Request account and data deletion/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('valid public request creates only a pending review ticket', async () => {
  const database = db();
  const env = { DB: database, SHARIKA_ENV: 'staging', SHARIKA_ACTION_RATE_LIMIT: { limit: async () => ({ success: true }) } };
  const response = await handlePublicAccountDeletion(request(valid), env, '/account-deletion');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Request received/);
  assert.deepEqual(database.rows, [{ public_id: '1010', contact_email: 'player@example.org', reason: 'Please delete my account' }]);
  assert.equal(database.calls.some(sql => /DELETE\s+FROM|UPDATE\s+sharika_users/i.test(sql)), false);
  await handlePublicAccountDeletion(request(valid), env, '/account-deletion');
  assert.equal(database.rows.length, 1, 'duplicate requests within one day are not inserted again');
});

test('public form rejects invalid ID, foreign origin, oversized body and rate-limit denial', async () => {
  const database = db();
  const env = { DB: database, SHARIKA_ENV: 'staging', SHARIKA_ACTION_RATE_LIMIT: { limit: async () => ({ success: true }) } };
  assert.equal((await handlePublicAccountDeletion(request({ ...valid, public_id: 'abc' }), env, '/account-deletion')).status, 400);
  assert.equal((await handlePublicAccountDeletion(request(valid, { origin: 'https://attacker.invalid' }), env, '/account-deletion')).status, 403);
  assert.equal((await handlePublicAccountDeletion(request({ ...valid, reason: 'x'.repeat(3500) }), env, '/account-deletion')).status, 413);
  assert.equal((await handlePublicAccountDeletion(request(valid), { ...env, SHARIKA_ACTION_RATE_LIMIT: { limit: async () => ({ success: false }) } }, '/account-deletion')).status, 429);
  assert.equal(database.rows.length, 0);
});

test('production form fails closed when abuse rate limiting is missing', async () => {
  const response = await handlePublicAccountDeletion(request(valid), { DB: db(), SHARIKA_ENV: 'production' }, '/account-deletion');
  assert.equal(response.status, 503);
});

test('only verified support or super admins can read deletion requests', async () => {
  const database = db();
  database.rows.push({ public_id: '1010', contact_email: 'player@example.org', reason: '' });
  const options = { request: new Request('https://sharika.example/api/v1/admin/account-deletion-requests'), env: { DB: database }, path: '/api/v1/admin/account-deletion-requests', cors: {}, reply: (body, status) => Response.json(body, { status }), fail: (error, status) => Response.json({ error }, { status }) };
  const denied = await handleAdminAccountDeletion({ ...options, uid: 'ordinary-user' });
  assert.equal(denied.status, 403);
  const allowed = await handleAdminAccountDeletion({ ...options, uid: 'super-user' });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).requests[0].public_id, '1010');
});
