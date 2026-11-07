import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/child-safety-worker.mjs';

const request = (path, method = 'GET') =>
  new Request(`https://sharika-child-safety.soverixnet.workers.dev${path}`, { method });

test('public Sharika CSAE standards are available without authentication', async () => {
  const response = await worker.fetch(request('/child-safety'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /public/);
  const html = await response.text();
  for (const term of ['Sharika voice chat app', 'CSAE', 'CSAM', 'grooming',
    'Report this room', 'soverixnet@gmail.com', 'NCMEC']) assert.ok(html.includes(term), term);
  assert.match(html, /Child Safety Standards/);
});

test('HEAD and unsupported routes and methods have safe responses', async () => {
  const head = await worker.fetch(request('/child-safety', 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(request('/random'))).status, 404);
  assert.equal((await worker.fetch(request('/child-safety', 'POST'))).status, 405);
});
