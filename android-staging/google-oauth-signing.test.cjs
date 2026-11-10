const test = require('node:test');
const assert = require('node:assert/strict');
const googleServices = require('./app/google-services.json');
const { inspectGoogleOAuthSigning } = require('./google-oauth-signing.cjs');

test('Firebase OAuth config registers the known stable Sharika APK signer', () => {
  const result = inspectGoogleOAuthSigning(googleServices,
    'AB:49:1A:1A:90:5A:42:BF:42:41:7D:7B:62:C6:58:B3:79:F3:2B:B0');
  assert.equal(result.hasAndroidSigner, true);
  assert.equal(result.hasWebClient, true);
});

test('a valid but unknown Google Play/upload signer fails the OAuth check', () => {
  const result = inspectGoogleOAuthSigning(googleServices, '0'.repeat(40));
  assert.equal(result.hasAndroidSigner, false);
  assert.equal(result.hasWebClient, true);
});

test('rejects malformed signer fingerprints and mismatched Android packages', () => {
  assert.throws(() => inspectGoogleOAuthSigning(googleServices, '123'), /40-character/);
  assert.throws(() => inspectGoogleOAuthSigning(googleServices, 'a'.repeat(40), 'com.other.app'), /package missing/);
});
