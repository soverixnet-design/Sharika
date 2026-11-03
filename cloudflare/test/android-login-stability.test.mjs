import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const legacy=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');

test('Google click bypasses legacy demo handler and reports state/errors inline',()=>{
  assert.match(legacy,/Google Login will work once the server is connected/);
  assert.match(adapter,/button\.id === 'wg'/);
  assert.match(adapter,/event\.stopImmediatePropagation\(\);\s*googleLogin\(\)/);
  assert.match(adapter,/googleLoginStatus\('Connecting to Google…'\)/);
  assert.match(adapter,/googleLoginStatus\(message,true\)/);
  assert.match(adapter,/window\.enter\(local,'Welcome to Sharika!'\)/);
});

test('Google credential selection falls back to all accounts without bypassing Firebase',()=>{
  assert.match(java,/new GetSignInWithGoogleOption\.Builder/);
  assert.match(java,/error instanceof NoCredentialException && !allowAllAccounts/);
  assert.match(java,/setFilterByAuthorizedAccounts\(false\)/);
  assert.match(java,/auth\.signInWithCredential\(GoogleAuthProvider\.getCredential\(token, null\)\)/);
  assert.match(java,/googlePending = false;/);
});

test('cached startup session and verified profile avoid optional blocking work',()=>{
  const session=java.slice(java.indexOf('case "session":'),java.indexOf('case "emailSignIn":'));
  assert.match(session,/identity\(auth\.getCurrentUser\(\)\)/);
  assert.doesNotMatch(session,/\.reload\(\)/);
  const authenticated=adapter.slice(adapter.indexOf('async function authenticated('),adapter.indexOf('// Add one optional field'));
  assert.match(authenticated,/const current = await ensureProfile\(account, form\)/);
  assert.match(authenticated,/reloadWallet\(\)\.catch/);
  assert.match(authenticated,/reloadRooms\(\)\.catch/);
  assert.doesNotMatch(authenticated,/await Promise\.allSettled/);
  assert.match(java,/verify|FirebaseAuth/);
});
