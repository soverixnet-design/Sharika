import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
const staging=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const play=readFileSync(new URL('../../android-staging/play-virtual-ui.js',import.meta.url),'utf8');
const referenceProfile=readFileSync(new URL('../../app/reference-profile.css',import.meta.url),'utf8');

test('profile pencil opens a separate full-page editor and persists verified edits',()=>{
  assert.match(app,/id="mnameedit" aria-label="Edit your name and profile"/);
  assert.match(app,/\$\("mnameedit"\)\.onclick=editSheet/);
  assert.match(app,/id="pe" aria-label="Open Edit Profile page"/);
  assert.match(staging,/sharika-edit-page #sh\{/);
  // The reference theme normally hides the secondary Edit button; the new
  // same-specificity, later injected rule must explicitly reveal it.
  assert.match(referenceProfile,/#v-me\.profile-royal \.edp,\s*#v-me\.profile-royal \.wl \{display:none!important\}/);
  assert.match(staging,/#v-me\.profile-royal \.edp\{display:inline-flex!important/);
  assert.match(staging,/#v-me\.profile-royal \.profile-name-edit\{display:inline-flex!important/);
  assert.match(staging,/header\.className='sh-edit-header'/);
  assert.match(staging,/preview\.id='sharika-photo-preview'/);
  assert.match(staging,/native\('pickProfilePhoto'\)/);
  assert.match(staging,/api\('PATCH','\/me',\{name,bio\}\)/);
  assert.match(staging,/document\.getElementById\('shb'\)\?\.classList\.remove\('sharika-edit-page'\)/);
});

test('recharge reference layout preserves verified staging seller restrictions',()=>{
  assert.match(staging,/royalRechargeStyle\.id='sharika-royal-recharge-style'/);
  assert.match(staging,/#rcp\.sh-recharge-reference \.rcb>\.pk:not\(\[style\]\)/);
  assert.match(staging,/document\.getElementById\('rcp'\)\?\.classList\.add\('sh-recharge-reference'\)/);
  assert.match(app,/id="rcl2">Coin seller list/);
  assert.match(staging,/if\(playStoreMode!==false\)return;\s*const listButton/);
  assert.match(staging,/api\('GET','\/sellers\/me'\)/);
  assert.match(staging,/if\(!data\.seller\?\.active/);
  assert.match(staging,/button\.id='sharika-recharge-seller-wallet'/);
});

test('Play edition uses native Google billing and never exposes seller payment',()=>{
  assert.match(staging,/native\('playBillingProducts',\{\}\)/);
  assert.match(staging,/native\('playBillingPurchase',\{product_id:product\.id\}\)/);
  assert.match(staging,/api\('POST','\/play-billing\/claim'/);
  assert.match(staging,/id="sh-play-exchange"/);
  assert.match(play,/#rcl2,#sharika-recharge-seller-wallet/);
  assert.match(play,/window\.sharikaOpenPlayWallet=showPlayWallet/);
  assert.doesNotMatch(play,/bKash|Nagad|SIMPAISA|cashout/i);
});
