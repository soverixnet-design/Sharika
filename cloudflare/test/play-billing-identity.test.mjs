import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handlePlayBillingIdentity } from '../src/play-billing-identity.mjs';

globalThis.crypto ||= webcrypto;
const endpoint = 'https://billing-identity.sharika.app/internal/google-wif/subject-token';
const issuer = 'https://broken-dew-401f.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const clientId = 'e367826f93b8d71185e03fe518aff3b4.access';
const env = {
  PLAY_BILLING_WIF_IDENTITY_HOST: 'billing-identity.sharika.app',
  PLAY_BILLING_WIF_ACCESS_ISSUER: issuer,
  PLAY_BILLING_WIF_ACCESS_AUDIENCE: audience,
  PLAY_BILLING_WIF_ACCESS_CLIENT_ID: clientId
};

function encode(input) { return Buffer.from(JSON.stringify(input)).toString('base64url'); }

async function keyFixture() {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const getJwks = async url => {
    assert.equal(url, `${issuer}/cdn-cgi/access/certs`);
    return Response.json({ keys: [{ kid: 'fixture-key', ...jwk }] });
  };
  const sign = async (extra = {}) => {
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture-key' });
    const claims = encode({ iss: issuer, aud: [audience], type: 'app',
      common_name: clientId, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900, ...extra });
    const content = `${header}.${claims}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey,
      new TextEncoder().encode(content));
    return `${content}.${Buffer.from(signature).toString('base64url')}`;
  };
  return { getJwks, sign };
}

test('Identity endpoint returns only a verified Cloudflare Access JWT with no-store', async () => {
  const fixture = await keyFixture(), jwt = await fixture.sign();
  const response = await handlePlayBillingIdentity(new Request(endpoint,
    { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), env, fixture.getJwks);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { subject_token: jwt });
});

test('Identity endpoint rejects public workers.dev bypasses and unauthenticated callers', async () => {
  const fixture = await keyFixture(), jwt = await fixture.sign();
  for (const [url, options, status] of [
    ['https://sharika-play-billing-identity.example.workers.dev/internal/google-wif/subject-token',
      { headers: { 'Cf-Access-Jwt-Assertion': jwt } }, 404],
    [endpoint, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt } }, 404],
    [endpoint, {}, 403]
  ]) {
    const response = await handlePlayBillingIdentity(new Request(url, options), env, fixture.getJwks);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const incomplete = await handlePlayBillingIdentity(new Request(endpoint),
    { ...env, PLAY_BILLING_WIF_ACCESS_CLIENT_ID: '' });
  assert.equal(incomplete.status, 503);
});

test('Identity endpoint rejects a tampered signature or mismatched security claims', async () => {
  const fixture = await keyFixture();
  const signed = await fixture.sign();
  const alteredSignature = signed.slice(0, -2) + (signed.endsWith('AA') ? 'BB' : 'AA');
  for (const jwt of [
    alteredSignature,
    await fixture.sign({ common_name: 'attacker.access' }),
    await fixture.sign({ aud: ['b'.repeat(64)] }),
    await fixture.sign({ iss: 'https://other.cloudflareaccess.com' }),
    await fixture.sign({ exp: Math.floor(Date.now() / 1000) + 1 }),
    await fixture.sign({ type: 'org' })
  ]) {
    const response = await handlePlayBillingIdentity(new Request(endpoint,
      { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), env, fixture.getJwks);
    assert.equal(response.status, 403);
  }
});
