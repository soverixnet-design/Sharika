const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const script = readFileSync(join(__dirname, 'staging-connection.js'), 'utf8');
const nativeSource = readFileSync(join(
  __dirname, 'app/src/main/java/com/soverixnet/sharika/SharikaActivity.java'
), 'utf8');

function signupHarness(playStoreMode) {
  const start = script.indexOf('  window.API.signup = async function (form) {');
  const end = script.indexOf('  function showConnectionRecovery(', start);
  assert.ok(start > 0 && end > start);
  const calls = [], profiles = [], saved = [];
  const window = { API: {} };
  new Function('window', 'native', 'playModeReady', 'playVirtualIdentityAllowed',
    'authAttemptId', 'localStorage', 'META_KEY', 'manualCountryCode',
    'document', 'deferredInviteCode', 'authenticated', 'errText', script.slice(start, end))(
    window,
    async (action, input) => {
      calls.push({ action, input });
      return { signedIn: true, emailVerified: false, email: input.email, verificationSent: true };
    }, Promise.resolve(playStoreMode), playStoreMode, 0,
    { setItem: (key, value) => saved.push({ key, value }) },
    'profile-meta', country => country,
    { getElementById: () => null }, '',
    async (account, form) => {
      profiles.push({ account, form });
      return { key: account.email, p: { name: form.name } };
    }, error => String(error.message || error)
  );
  return { signup: window.API.signup, calls, profiles, saved };
}

test('Play virtual signup enters the same newly created Firebase identity', async () => {
  const harness = signupHarness(true);
  const form = { key: 'tester@example.com', pw: 'a-long-passphrase', name: 'Tester', dob: '2000-01-01', country: 'BD' };
  const result = await harness.signup(form);
  assert.equal(result.ok, true);
  assert.equal(result.acct.key, form.key);
  assert.deepEqual(harness.calls, [{ action: 'emailSignUp', input: { email: form.key, password: form.pw } }]);
  assert.equal(harness.profiles.length, 1);
  assert.equal(harness.profiles[0].account.emailVerified, false);
  assert.equal(harness.saved.length, 1);
});

test('non-Play staging preserves email confirmation requirement', async () => {
  const harness = signupHarness(false);
  const result = await harness.signup({ key: 'tester@example.com', pw: 'a-long-passphrase', name: 'Tester', dob: '2000-01-01', country: 'BD' });
  assert.equal(result.ok, false);
  assert.match(result.msg, /Verify your email/);
  assert.equal(harness.profiles.length, 0);
});

test('Only the isolated Play backend bypasses verification email; normal staging does not', () => {
  assert.match(nativeSource, /private static boolean isIsolatedPlayVirtualBuild\(\) \{\s*return BuildConfig\.SHARIKA_PLAY_BUILD &&\s*"https:\/\/sharika-api-play-virtual\.soverixnet\.workers\.dev"\.equals\(BuildConfig\.SHARIKA_API_ORIGIN\);/);
  assert.match(nativeSource, /if \(isIsolatedPlayVirtualBuild\(\)\) \{\s*sendResult\(id, result\(true, identity\(user\), null\)\);/);
  assert.match(nativeSource, /user\.sendEmailVerification\(\)/);
  assert.match(script, /!account\.signedIn \|\| \(!account\.emailVerified && !playVirtualIdentityAllowed\)/);
  assert.match(script, /let playVirtualIdentityAllowed=false;/);
  assert.match(script, /playVirtualIdentityAllowed=playStoreMode && result\.api_origin===/);
});

test('Native API requests accept unverified Firebase identity only on isolated Play virtual origin', () => {
  const start = nativeSource.indexOf('    private void callStagingApi(');
  const end = nativeSource.indexOf('    private boolean isRealtimeVoiceRoute(', start);
  assert.ok(start > 0 && end > start);
  const callApi = nativeSource.slice(start, end);
  assert.match(callApi, /if \(user\.isEmailVerified\(\) \|\| isIsolatedPlayVirtualBuild\(\)\) \{\s*requestStagingToken\(id, method, path, data, user\);/);
  assert.match(callApi, /if \(!current\.isEmailVerified\(\)\) \{\s*sendResult\(id, result\(false,null,"email_verification_required"\)\);/);
  assert.match(nativeSource, /private static boolean isIsolatedPlayVirtualBuild\(\)/);
});
