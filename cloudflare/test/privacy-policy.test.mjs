import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicPrivacyPolicy } from '../src/privacy-policy.mjs';

test('Sharika public privacy policy is accessible without authentication', async () => {
  const response = handlePublicPrivacyPolicy(new Request('https://sharika.example/privacy-policy'), '/privacy-policy');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sharika Privacy Policy/);
  assert.match(html, /Information we collect/);
  assert.match(html, /href="\/account-deletion"/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('privacy policy allows GET and HEAD only', async () => {
  const response = handlePublicPrivacyPolicy(new Request('https://sharika.example/privacy-policy', { method: 'POST' }), '/privacy-policy');
  assert.equal(response.status, 405);
  const head = handlePublicPrivacyPolicy(new Request('https://sharika.example/privacy-policy', { method: 'HEAD' }), '/privacy-policy');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
