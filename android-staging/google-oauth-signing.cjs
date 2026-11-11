const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const PACKAGE = 'com.soverixnet.sharika';

function normalizeSha1(value) {
  return String(value || '').replace(/:/g, '').toLowerCase();
}

function inspectGoogleOAuthSigning(config, sha1, packageName = PACKAGE) {
  const fingerprint = normalizeSha1(sha1);
  if (!/^[a-f0-9]{40}$/.test(fingerprint))
    throw new Error('Expected a complete 40-character APK signer SHA-1 fingerprint');
  const app = (config.client || []).find(client =>
    client.client_info?.android_client_info?.package_name === packageName);
  if (!app) throw new Error('Firebase Android app package missing from google-services.json');
  const clients = app.oauth_client || [];
  const hasWebClient = clients.some(client => client.client_type === 3 && client.client_id);
  const hasAndroidSigner = clients.some(client => client.client_type === 1 &&
    client.android_info?.package_name === packageName &&
    normalizeSha1(client.android_info.certificate_hash) === fingerprint);
  return { fingerprint, hasWebClient, hasAndroidSigner };
}

if (require.main === module) {
  try {
    const config = JSON.parse(readFileSync(join(__dirname, 'app/google-services.json'), 'utf8'));
    const result = inspectGoogleOAuthSigning(config, process.argv[2]);
    if (!result.hasWebClient) throw new Error('Missing Firebase Web OAuth client used to request Google ID tokens');
    if (!result.hasAndroidSigner)
      throw new Error('The actual signed QA APK SHA-1 is missing from Firebase Android OAuth clients. Add this certificate fingerprint in Firebase, download fresh google-services.json, then rebuild. SHA-1: ' + result.fingerprint);
    console.log('SHARIKA_GOOGLE_QA_APK_SIGNER_REGISTERED_SHA1=' + result.fingerprint);
  } catch (error) {
    console.error('SHARIKA_GOOGLE_OAUTH_PREFLIGHT_FAILED:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { inspectGoogleOAuthSigning };
