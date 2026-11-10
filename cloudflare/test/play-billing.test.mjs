import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handlePlayBillingApp, PLAY_COIN_PRODUCTS, sha256Hex, verifyGooglePurchase } from '../src/play-billing.mjs';

globalThis.crypto ||= webcrypto;
const validToken = 'play_purchase_token_12345678901234567890';
const uid = 'firebase-owner-123';

function output() {
  return { reply: (body, status) => ({ body, status }),
    fail: (error, status) => ({ error, status }) };
}

test('Play catalog is exact and does not pretend to provide prices', async () => {
  const result = await handlePlayBillingApp({
    request: new Request('https://example.com/api/v1/play-billing/catalog'),
    env: { SHARIKA_PLAY_BILLING_ENABLED: 'false' }, uid,
    path: '/api/v1/play-billing/catalog', readBody: async () => ({}), ...output()
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, false);
  assert.equal(result.body.prices_from_google_play, true);
  assert.deepEqual(result.body.products.map(p => p.coins), [500000, 2500000, 5000000]);
  assert.equal(PLAY_COIN_PRODUCTS.sharika_coins_500k, 500000);
});

test('No credit attempt occurs when billing is off or service account is missing', async () => {
  const request = new Request('https://example.com/api/v1/play-billing/claim', { method: 'POST' });
  const result = await handlePlayBillingApp({ request,
    env: { SHARIKA_PLAY_BILLING_ENABLED: 'false' }, uid,
    path: '/api/v1/play-billing/claim', ...output(),
    readBody: async () => ({ product_id: 'sharika_coins_500k', purchase_token: validToken })
  });
  assert.equal(result.status, 503);
  const missing = await handlePlayBillingApp({ request,
    env: { SHARIKA_PLAY_BILLING_ENABLED: 'true' }, uid,
    path: '/api/v1/play-billing/claim', ...output(), readBody: async () => ({})
  });
  assert.equal(missing.status, 503);
});

async function fixture(receiptOverride = {}) {
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)).toString('base64');
  const env = { PLAY_BILLING_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'billing-sharika@example.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`
  }) };
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push({ url, method: options?.method, authorization: options?.headers?.authorization });
    if (url.endsWith('/token')) return Response.json({ access_token: 'server-token', token_type: 'Bearer' });
    return Response.json({ purchaseState: 0, consumptionState: 0,
      productId: 'sharika_coins_500k', orderId: 'GPA.0123-4567-8901-23456', quantity: 1,
      obfuscatedExternalAccountId: await sha256Hex(uid), ...receiptOverride });
  };
  return { env, fetcher, urls };
}

test('Google verification requires purchased, unconsumed product and matched Firebase account', async () => {
  const { env, fetcher, urls } = await fixture();
  const verified = await verifyGooglePurchase({env, uid, productId: 'sharika_coins_500k',
    purchaseToken: validToken, fetcher });
  assert.equal(verified.orderId, 'GPA.0123-4567-8901-23456');
  assert.equal(urls.length, 2);
  assert.match(urls[1].url, /^https:\/\/androidpublisher\.googleapis\.com\//);
  assert.equal(urls[1].authorization, 'Bearer server-token');
});

test('Reject pending, mismatched, or already-consumed receipts before wallet writes', async () => {
  for (const override of [
    {purchaseState: 2}, {productId: 'other_product'},
    {consumptionState: 1}, {quantity: 2},
    {obfuscatedExternalAccountId: 'another-user'}
  ]) {
    const { env, fetcher } = await fixture(override);
    await assert.rejects(verifyGooglePurchase({env,uid,productId:'sharika_coins_500k',
      purchaseToken:validToken,fetcher}), /play_purchase_not_verified/);
  }
});

const wifIssuer = 'https://broken-dew-401f.cloudflareaccess.com';
const wifAccessAudience = 'a'.repeat(64);
const wifClientId = 'e367826f93b8d71185e03fe518aff3b4.access';

function wifEnv() {
  return {
    PLAY_BILLING_AUTH_MODE: 'wif_access',
    PLAY_BILLING_WIF_PROVIDER_AUDIENCE:
      '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sharika-billing/providers/cloudflare-access',
    PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL:
      'sharika-play-billing@project-dcd1acf2-621e-4aea-94b.iam.gserviceaccount.com',
    PLAY_BILLING_WIF_IDENTITY_URL:
      'https://billing-identity.sharika.app/internal/google-wif/subject-token',
    PLAY_BILLING_WIF_ACCESS_ISSUER: wifIssuer,
    PLAY_BILLING_WIF_ACCESS_AUDIENCE: wifAccessAudience,
    PLAY_BILLING_WIF_ACCESS_CLIENT_ID: wifClientId,
    PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET: 'test-only-secret-not-a-real-key'
  };
}

function accessAssertion(overrides = {}) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({
    iss: wifIssuer, aud: [wifAccessAudience], type: 'app',
    common_name: wifClientId, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900, ...overrides
  })}.signature`;
}

test('Play WIF exchanges a Cloudflare Access JWT via Google STS then impersonates the Play service account', async () => {
  const env = wifEnv(), calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === env.PLAY_BILLING_WIF_IDENTITY_URL)
      return Response.json({ subject_token: accessAssertion() });
    if (url === 'https://sts.googleapis.com/v1/token')
      return Response.json({ access_token: 'federated-google-token', token_type: 'Bearer' });
    if (url.includes(':generateAccessToken'))
      return Response.json({ accessToken: 'impersonated-play-token' });
    return Response.json({ purchaseState: 0, consumptionState: 0,
      productId: 'sharika_coins_500k', orderId: 'GPA.0123-4567-8901-23456',
      obfuscatedExternalAccountId: await sha256Hex(uid) });
  };
  const result = await verifyGooglePurchase({ env, uid,
    productId: 'sharika_coins_500k', purchaseToken: validToken, fetcher });
  assert.equal(result.accessToken, 'impersonated-play-token');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.headers['CF-Access-Client-Id'], wifClientId);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, 'https://sts.googleapis.com/v1/token');
  const sts = JSON.parse(calls[1].options.body);
  assert.equal(sts.audience, env.PLAY_BILLING_WIF_PROVIDER_AUDIENCE);
  assert.equal(sts.subjectTokenType, 'urn:ietf:params:oauth:token-type:jwt');
  assert.equal(calls[2].options.headers.authorization, 'Bearer federated-google-token');
  assert.deepEqual(JSON.parse(calls[2].options.body).scope,
    ['https://www.googleapis.com/auth/androidpublisher']);
  assert.equal(calls[3].options.headers.authorization, 'Bearer impersonated-play-token');
  assert.ok(calls.every(call => !String(call.options.body || '').includes(env.PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET)));
});

test('WIF fails closed for missing bindings, unsafe identity URLs and unknown auth modes', async () => {
  const request = new Request('https://example.com/api/v1/play-billing/claim', { method: 'POST' });
  for (const override of [
    { PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET: '' },
    { PLAY_BILLING_WIF_IDENTITY_URL: 'https://example.com/internal/google-wif/subject-token' },
    { PLAY_BILLING_WIF_IDENTITY_URL: 'http://billing-identity.sharika.app/internal/google-wif/subject-token' },
    { PLAY_BILLING_WIF_PROVIDER_AUDIENCE: '//iam.googleapis.com/projects/wrong' },
    { PLAY_BILLING_AUTH_MODE: 'unknown', PLAY_BILLING_SERVICE_ACCOUNT_JSON: '{}' }
  ]) {
    const env = { ...wifEnv(), SHARIKA_PLAY_BILLING_ENABLED: 'true', ...override };
    const response = await handlePlayBillingApp({ request, env, uid,
      path: '/api/v1/play-billing/claim', ...output(), readBody: async () => ({}) });
    assert.equal(response.status, 503);
    const catalog = await handlePlayBillingApp({
      request: new Request('https://example.com/api/v1/play-billing/catalog'), env, uid,
      path: '/api/v1/play-billing/catalog', ...output(), readBody: async () => ({})
    });
    assert.equal(catalog.body.enabled, false);
  }
});

test('WIF never exchanges a wrong-issuer, wrong-audience, wrong-client or expiring Access JWT', async () => {
  for (const wrongClaims of [
    { iss: 'https://attacker.cloudflareaccess.com' },
    { aud: ['b'.repeat(64)] },
    { common_name: 'attacker.access' },
    { exp: Math.floor(Date.now() / 1000) + 15 },
    { type: 'org' }
  ]) {
    const visited = [];
    const fetcher = async url => {
      visited.push(url);
      return Response.json({ subject_token: accessAssertion(wrongClaims) });
    };
    await assert.rejects(verifyGooglePurchase({ env: wifEnv(), uid,
      productId: 'sharika_coins_500k', purchaseToken: validToken, fetcher }),
    /play_wif_invalid_assertion/);
    assert.equal(visited.length, 1, 'Invalid JWT must never reach Google STS');
  }
});

test('WIF fails closed if Google STS or service-account impersonation fails', async () => {
  for (const failedStep of ['sts', 'impersonation']) {
    const calls = [];
    const fetcher = async url => {
      calls.push(url);
      if (url.includes('/internal/google-wif/subject-token'))
        return Response.json({ subject_token: accessAssertion() });
      if (url.includes('/v1/token'))
        return failedStep === 'sts' ? new Response('forbidden', { status: 403 }) :
          Response.json({ access_token: 'short-lived-google-token', token_type: 'Bearer' });
      return new Response('denied', { status: 403 });
    };
    await assert.rejects(verifyGooglePurchase({ env: wifEnv(), uid,
      productId: 'sharika_coins_500k', purchaseToken: validToken, fetcher }),
    /play_wif_(sts|impersonation)_unavailable/);
    assert.equal(calls.length, failedStep === 'sts' ? 2 : 3);
  }
});
