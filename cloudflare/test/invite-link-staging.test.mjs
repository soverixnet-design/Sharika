import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const manifest=readFileSync(new URL('android-staging/app/src/main/AndroidManifest.xml',root),'utf8');
const activity=readFileSync(new URL('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',root),'utf8');
const gradle=readFileSync(new URL('android-staging/app/build.gradle',root),'utf8');
const adapter=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const server=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');

test('installed-app HTTPS and scheme links persist the inviter without privileged API exposure',()=>{
  assert.match(manifest,/android:scheme="sharika" android:host="invite"/);
  assert.match(manifest,/android:scheme="https"/);
  assert.match(manifest,/android:host="\$\{sharikaInviteHost\}"/);
  assert.match(gradle,/manifestPlaceholders = \[sharikaInviteHost: 'sharika-api-staging.soverixnet.workers.dev'\]/);
  assert.match(manifest,/android:launchMode="singleTop"/);
  assert.match(activity,/"sharika".equals\(uri.getScheme\(\)\)/);
  assert.match(activity,/"https".equals\(uri.getScheme\(\)\)/);
  assert.match(activity,/code.matches\("\[0-9\]\{8\}"\)/);
  assert.match(activity,/getSharedPreferences\("sharika_pending_invite",MODE_PRIVATE\)/);
  assert.match(activity,/case "invitePending":/);
  assert.match(activity,/case "inviteClear":/);
  assert.match(activity,/case "copyInviteLink":/);
  assert.match(activity,/getPathSegments\(\).size\(\)==2/);
});
test('Google Play Install Referrer is read before the first profile is created',()=>{
  assert.match(gradle,/com.android.installreferrer:installreferrer:2.2/);
  assert.match(activity,/InstallReferrerClient.newBuilder\(this\).build\(\)/);
  assert.match(activity,/details.getInstallReferrer\(\)/);
  assert.match(activity,/params.getQueryParameter\("sharika_invite"\)/);
  assert.match(activity,/pendingInviteRequests.add\(id\)/);
  assert.match(activity,/getSharedPreferences\("sharika_play_install_referrer_v1",MODE_PRIVATE\)/);
  assert.match(adapter,/await invitePendingReady;/);
  assert.match(adapter,/const invitePendingReady=native\('invitePending'\)/);
});
test('signup and existing-account retry use one server-verified inviter without manual code',()=>{
  assert.match(adapter,/window.SharikaIncomingInvite=rememberIncomingInvite/);
  assert.match(adapter,/invite_code:deferredInviteCode\|\|cached.invite_code/);
  assert.match(adapter,/if\(saved.invite_bonused\)clearIncomingInvite\(\)/);
  assert.match(adapter,/claimPendingInviteAfterLogin/);
  assert.match(adapter,/api\('POST','\/invites\/redeem',\{invite_code:code\}\)/);
  assert.match(adapter,/copyInviteLink/);
  assert.match(adapter,/let PUBLIC_INVITE_URL='https:\/\/sharika-api-staging.soverixnet.workers.dev\/invite\/'/);
  assert.match(adapter,/PUBLIC_INVITE_URL=result.api_origin\+'\/invite\/'/);
  assert.match(activity,/API_ORIGIN\+"\/invite\/"\+linkCode/);
  assert.match(adapter,/Share your personal HTTPS invitation link/);
  assert.match(server,/const inviteLanding=handleInviteLanding\(request,path\)/);
  assert.doesNotMatch(activity,/creditWallet|mintCoins|awardReferralCoins/);
});
