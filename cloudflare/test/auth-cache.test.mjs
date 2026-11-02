import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { verifyFirebaseToken } from '../src/auth.mjs';

test('Firebase JWT verification reuses a current JWK import and refreshes after rotation', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'performance-cache-test', alg: 'RS256' };
  const projectId = 'sharika-cache-test-project';
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signedPart = encode({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }) + '.' +
    encode({ aud: projectId, iss: 'https://securetoken.google.com/' + projectId,
      sub: 'member-performance', email_verified: true,
      iat: now - 10, auth_time: now - 15, exp: now + 1800 });
  const jwt = signedPart + '.' +
    sign('RSA-SHA256', Buffer.from(signedPart), privateKey).toString('base64url');

  const oldCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let imports = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
    importKey(...args) { imports++; return webcrypto.subtle.importKey(...args); },
    verify(...args) { return webcrypto.subtle.verify(...args); },
  } } });
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return { ok: true,
      headers: { get: () => 'public, max-age=300' },
      json: async () => ({ keys: [{ ...jwk }] }) };
  };
  try {
    const first = await verifyFirebaseToken('Bearer ' + jwt, projectId, fetcher, now * 1000);
    const second = await verifyFirebaseToken('Bearer ' + jwt, projectId, fetcher, now * 1000);
    assert.equal(first?.verified, true);
    assert.equal(second?.uid, first.uid);
    assert.equal(requests, 1);
    assert.equal(imports, 1, 'identical JWK should import only once');

    const invalid = await verifyFirebaseToken('Bearer ' + jwt.slice(0, -3) + 'bad',
      projectId, fetcher, now * 1000);
    assert.equal(invalid, null, 'cached public key must still verify the signature');

    const refreshed = await verifyFirebaseToken('Bearer ' + jwt,
      projectId, fetcher, now * 1000 + 301000);
    assert.equal(refreshed?.verified, true);
    assert.equal(requests, 2, 'expired JWKS must be refreshed');
    assert.equal(imports, 2, 'a new JWK object must import again');
  } finally {
    if (oldCrypto) Object.defineProperty(globalThis, 'crypto', oldCrypto);
    else delete globalThis.crypto;
  }
});
