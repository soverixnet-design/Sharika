import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const java = readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java', import.meta.url), 'utf8');
const build = readFileSync(new URL('../../android-staging/app/build.gradle', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../../android-staging/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');

test('WebView static guard: subframes cannot navigate to external origins', () => {
  const guard = java.match(/shouldOverrideUrlLoading\(WebView view, WebResourceRequest request\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(guard, 'navigation guard required');
  assert.match(guard[1], /!request\.isForMainFrame\(\)/);
  assert.match(guard[1], /"about:srcdoc"/);
  assert.match(guard[1], /"file:\/\/\/android_asset\/"/);
  assert.doesNotMatch(guard[1], /if \(!request\.isForMainFrame\(\)\) return false/);
});

test('WebView static guard: microphone origin and Android runtime grant are required', () => {
  const mic = java.slice(java.indexOf('private void requestMicrophone('), java.indexOf('@Override public void onRequestPermissionsResult'));
  assert.match(mic, /request\.getOrigin\(\)/);
  assert.match(mic, /"file"\.equalsIgnoreCase\(origin\.getScheme\(\)\)/);
  assert.match(mic, /"file:\/\/\/android_asset\/index\.html"\.equals\(browser\.getUrl\(\)\)/);
  assert.match(mic, /Manifest\.permission\.RECORD_AUDIO/);
  assert.match(mic, /request\.deny\(\)/);
});

test('WebView static guard: packaged HTML limits nested frames', () => {
  assert.match(build, /Content-Security-Policy/);
  assert.match(build, /frame-src 'self' about:/);
  assert.match(build, /object-src 'none'/);
  assert.match(build, /base-uri 'none'/);
});

test('Android and Worker baseline safety gates stay present', () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(java, /private boolean allowedApi\(/);
  assert.match(java, /FirebaseUser user = auth\.getCurrentUser\(\)/);
  assert.match(worker, /verifyFirebaseToken\(request\.headers\.get\('authorization'\)/);
});

// These are SOURCE REGRESSION checks, not a dynamic penetration test.
// Microphone grant and embedded-room voice still require on-device regression.
