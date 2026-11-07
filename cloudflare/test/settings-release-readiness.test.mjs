import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('Settings is a separate full screen page on the verified Main Profile',()=>{
  const js=read('android-staging/staging-connection.js');
  for(const marker of [
    "page.id='sh-settings-page'",
    "window.settingsSheet=sharikaOpenSettings",
    "window.sharikaOpenSettings=sharikaOpenSettings",
    "data-sh-settings-route",
    "view==='safety'",
    "view==='policies'",
    "view==='voice'",
    "view==='account'"
  ]) assert.ok(js.includes(marker),'Settings feature missing '+marker);
  assert.ok(js.includes("const target=event.target.closest?.('#mtopset,[data-m=\"set\"]')"));
  assert.ok(js.includes("document.getElementById('v-me')?.addEventListener('click'"));
});
test('Settings safety controls are real authenticated support requests',()=>{
  const js=read('android-staging/staging-connection.js');
  assert.ok(js.includes("api('POST','/support/messages'"));
  assert.ok(js.includes("'[ACCOUNT DELETION REQUEST] Verified user '"));
  assert.ok(js.includes("'[Safety report] User ID: '"));
  assert.ok(js.includes("button.disabled=true"));
  assert.ok(js.includes("page.querySelector('#sh-set-delete-confirm')?.checked"));
  assert.ok(js.includes('Your account is NOT automatically deleted'));
});
test('Mic diagnostic requests permission only on tap and always stops streams',()=>{
  const js=read('android-staging/staging-connection.js');
  assert.ok(js.includes("if(action==='microphone')"));
  assert.ok(js.includes('echoCancellation:true,noiseSuppression:true,autoGainControl:true'));
  assert.ok(js.includes('stream.getTracks().forEach(track=>track.stop())'));
  assert.ok(js.includes("if(action==='enablepush')"));
});
test('Native Android Back respects Settings subpages',()=>{
  const js=read('android-staging/back-navigation.js');
  assert.ok(js.includes("get('sh-settings-page')"));
  assert.ok(js.includes('window.sharikaSettingsBack()'));
});
test('Play-review AAB is distinguished from production, with API 36 and stable signer',()=>{
  const build=read('android-staging/app/build.gradle');
  const native=read('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java');
  assert.ok(build.includes('compileSdk 36'));
  assert.ok(build.includes('targetSdk 36'));
  assert.ok(build.includes('release {'));
  assert.ok(build.includes('signingConfig signingConfigs.sharikaStaging'));
  assert.ok(native.includes('BuildConfig.SHARIKA_API_ORIGIN'));
  assert.ok(build.includes('https://sharika-api-staging.soverixnet.workers.dev'));
  assert.ok(build.includes('SHARIKA_PLAY_API_ORIGIN'));
  assert.ok(build.includes('SHARIKA_PLAY_STAGING_CANDIDATE'));
});
