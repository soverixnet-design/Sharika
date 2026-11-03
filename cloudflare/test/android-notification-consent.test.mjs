import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const native=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('Firebase login does not request Android notifications permission',()=>{
  const auth=bridge.slice(bridge.indexOf('  async function authenticated('),
    bridge.indexOf('  // Add one optional field to the original themed signup card'));
  const push=native.slice(native.indexOf('case "pushToken":'),
    native.indexOf('case "api":'));
  assert.match(auth,/registerPushDevice\(\)/);
  assert.match(push,/data\.optBoolean\("promptPermission", false\)/);
  assert.ok(push.indexOf('data.optBoolean("promptPermission", false)') <
    push.indexOf('requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}'));
  assert.match(push,/notification_permission_required/);
  assert.match(bridge,/native\('pushToken',\{promptPermission\}\)/);
});

test('Notifications page provides a user initiated opt-in with a completed callback',()=>{
  assert.match(bridge,/id="sh-notify-enable"/);
  assert.match(bridge,/registerPushDevice\(true\)/);
  assert.match(native,/if \(code == NOTIFICATION_PERMISSION_REQUEST\)/);
  assert.match(native,/sendPushToken\(id\)/);
  assert.match(native,/notification_permission_denied/);
});

test('Google sign-in errors remain visible long enough to screenshot',()=>{
  assert.match(bridge,/sh-google-login-error/);
  assert.match(bridge,/note\.setAttribute\('role','alert'\)/);
  assert.match(bridge,/note\.textContent='Google login: '\+message/);
});
