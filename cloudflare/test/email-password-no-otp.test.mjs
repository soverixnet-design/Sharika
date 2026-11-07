import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const native=readFileSync(new URL('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',root),'utf8');
const client=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const html=readFileSync(new URL('app/index.html',root),'utf8');

test('new password accounts open without confirmation or SMS OTP',()=>{
  assert.match(native,/auth\.createUserWithEmailAndPassword\(email, password\)/);
  assert.doesNotMatch(native,/user\.sendEmailVerification\(/);
  assert.match(native,/sendResult\(id, result\(true, identity\(user\), null\)\)/);
  assert.match(client,/const local=await authenticated\(result,form,attempt\)/);
  assert.doesNotMatch(client,/!account\.emailVerified/);
  assert.match(html,/Password \(at least 12 characters\)/);
});

test('sign-in keeps password verification, Firebase token verification and logout',()=>{
  assert.match(native,/auth\.signInWithEmailAndPassword\(email, password\)/);
  assert.match(native,/user\.getIdToken\(false\)/);
  assert.match(native,/case "signOut":/);
  assert.match(native,/requestStagingToken\(id, method, path, data, user\)/);
  assert.doesNotMatch(native,/email_verification_required/);
});
