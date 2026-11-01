import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const manifest=readFileSync(new URL('android-staging/app/src/main/AndroidManifest.xml',root),'utf8');
const activity=readFileSync(new URL('android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',root),'utf8');
const adapter=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');

test('installed-app invitation URL is handled without exporting privileged API routes',()=>{
  assert.match(manifest,/android:scheme="sharika" android:host="invite"/);
  assert.match(manifest,/android:launchMode="singleTop"/);
  assert.match(activity,/"sharika"\.equals\(uri\.getScheme\(\)\)/);
  assert.match(activity,/"invite"\.equals\(uri\.getHost\(\)\)/);
  assert.match(activity,/code\.matches\("\[0-9\]\{8\}"\)/);
  assert.match(activity,/getSharedPreferences\("sharika_pending_invite",MODE_PRIVATE\)/);
  assert.match(activity,/case "invitePending":/);
  assert.match(activity,/case "inviteClear":/);
});

test('new signup and manual claim keep server-verified Invite rules',()=>{
  assert.match(adapter,/window\.SharikaIncomingInvite=rememberIncomingInvite/);
  assert.match(adapter,/if\(deferredInviteCode\)auth\.querySelector\('#stage-invite-code'\)/);
  assert.match(adapter,/invite_code:cached\.invite_code\|\|deferredInviteCode/);
  assert.match(adapter,/api\('POST','\/invites\/redeem'/);
  assert.match(adapter,/if\(!result\?\.claimed\)throw new Error/);
  assert.match(adapter,/clearIncomingInvite\(\)/);
  assert.match(adapter,/sharika:\/\/invite\/';?\+invite/);
  assert.doesNotMatch(activity,/creditWallet|mintCoins|awardReferralCoins/);
});
