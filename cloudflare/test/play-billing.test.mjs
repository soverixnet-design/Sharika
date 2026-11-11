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

function federationFixture() {
  const env = {
    SHARIKA_PLAY_BILLING_ENABLED: 'true',
    PLAY_BILLING_AUTH_MODE: 'wif',
    PLAY_BILLING_WIF_IDENTITY_URL:
      'https://billing-identity.sharika.app/internal/google-wif/subject-token',
    PLAY_BILLING_WIF_ACCESS_ISSUER: 'https://sharika.cloudflareaccess.com',
    PLAY_BILLING_WIF_ACCESS_AUDIENCE: 'a'.repeat(64),
    PLAY_BILLING_WIF_ACCESS_CLIENT_ID: 'sharikabillingtestclient01234567890.access',
    PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET: 'test-only-access-service-secret',
    PLAY_BILLING_WIF_PROVIDER_AUDIENCE: '//iam.googleapis.com/projects/558304223315/' +
      'locations/global/workloadIdentityPools/sharika-play-billing/providers/cloudflare-access',
    PLAY_BILLING_WIF_SERVICE_ACCOUNT_EMAIL: 'sharika-play-billing@sharika-project.iam.gserviceaccount.com'
  };
  const payload = {
    iss: env.PLAY_BILLING_WIF_ACCESS_ISSUER,
    aud: [env.PLAY_BILLING_WIF_ACCESS_AUDIENCE], type: 'app',
    common_name: env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600
  };
  const subjectToken = ['eyJhbGciOiJSUzI1NiJ9',
    Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2ln'].join('.');
  return { env, subjectToken };
}

test('WIF exchanges a verified Access identity for a scoped Google Play token', async () => {
  const { env, subjectToken } = federationFixture();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === env.PLAY_BILLING_WIF_IDENTITY_URL)
      return Response.json({ subject_token: subjectToken });
    if (url === 'https://sts.googleapis.com/v1/token')
      return Response.json({ access_token: 'federated-token', token_type: 'Bearer' });
    if (url.includes(':generateAccessToken'))
      return Response.json({ accessToken: 'android-publisher-token', expireTime: '2026-11-10T19:00:00Z' });
    return Response.json({ purchaseState: 0, consumptionState: 0,
      productId: 'sharika_coins_500k', orderId: 'GPA.1111-2222-3333-44444', quantity: 1,
      obfuscatedExternalAccountId: await sha256Hex(uid) });
  };
  const verified = await verifyGooglePurchase({env, uid, productId: 'sharika_coins_500k',
    purchaseToken: validToken, fetcher });
  assert.equal(verified.orderId, 'GPA.1111-2222-3333-44444');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.headers['CF-Access-Client-Id'], env.PLAY_BILLING_WIF_ACCESS_CLIENT_ID);
  assert.equal(calls[0].options.headers['CF-Access-Client-Secret'], env.PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET);
  assert.equal(calls[0].options.redirect, 'manual');
  const exchange = JSON.parse(calls[1].options.body);
  assert.equal(exchange.audience, env.PLAY_BILLING_WIF_PROVIDER_AUDIENCE);
  assert.equal(exchange.subjectToken, subjectToken);
  assert.equal(exchange.scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.match(calls[2].url, /^https:\/\/iamcredentials\.googleapis\.com\//);
  assert.equal(calls[2].options.headers.authorization, 'Bearer federated-token');
  assert.deepEqual(JSON.parse(calls[2].options.body).scope,
    ['https://www.googleapis.com/auth/androidpublisher']);
  assert.equal(calls[3].options.headers.authorization, 'Bearer android-publisher-token');
});

test('WIF fails closed on missing values, untrusted identity host and wrong mode', async () => {
  const { env } = federationFixture();
  for (const override of [
    { PLAY_BILLING_WIF_ACCESS_CLIENT_SECRET: '' },
    { PLAY_BILLING_WIF_IDENTITY_URL: 'https://untrusted.example/internal/google-wif/subject-token' },
    { PLAY_BILLING_AUTH_MODE: 'unrecognized' }
  ]) {
    const result = await handlePlayBillingApp({
      request: new Request('https://example.com/api/v1/play-billing/catalog'),
      env: { ...env, ...override }, uid, path: '/api/v1/play-billing/catalog',
      readBody: async () => ({}), ...output()
    });
    assert.equal(result.body.enabled, false);
  }
});

test('WIF rejects mismatched identity JWT and STS or impersonation failures', async () => {
  const { env, subjectToken } = federationFixture();
  for (const failureAt of ['identity', 'sts', 'impersonation']) {
    const visited = [];
    const fetcher = async url => {
      visited.push(url);
      if (failureAt === 'identity') return Response.json({ subject_token: 'not-a-jwt' });
      if (url === env.PLAY_BILLING_WIF_IDENTITY_URL)
        return Response.json({ subject_token: subjectToken });
      if (url === 'https://sts.googleapis.com/v1/token')
        return failureAt === 'sts' ? new Response('Forbidden', { status: 403 }) :
          Response.json({ access_token: 'federated-token', token_type: 'Bearer' });
      return new Response('Forbidden', { status: 403 });
    };
    await assert.rejects(verifyGooglePurchase({ env, uid, productId: 'sharika_coins_500k',
      purchaseToken: validToken, fetcher }), /play_wif_/);
    assert.equal(visited.length, failureAt === 'identity' ? 1 : failureAt === 'sts' ? 2 : 3);
  }
});
