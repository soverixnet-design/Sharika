import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/play-policy-worker.mjs';

const request = (path, method = 'GET') =>
  new Request(`https://sharika-play-policy.soverixnet.workers.dev${path}`, { method });

test('public privacy and account deletion pages route from isolated worker', async () => {
  const policy = await worker.fetch(request('/privacy-policy'), {});
  const deleteForm = await worker.fetch(request('/account-deletion'), {});
  assert.equal(policy.status, 200);
  assert.match(await policy.text(), /Privacy Policy/);
  assert.equal(deleteForm.status, 200);
  assert.match(await deleteForm.text(), /Submit deletion request/);
});

test('head and unknown routes do not leak content', async () => {
  const head = await worker.fetch(request('/account-deletion', 'HEAD'), {});
  const missing = await worker.fetch(request('/admin/'), {});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(missing.status, 404);
});
