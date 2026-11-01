import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const html=readFileSync(new URL('app/index.html',root),'utf8');
const android=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const gradle=readFileSync(new URL('android-staging/app/build.gradle',root),'utf8');

test('owner royal profile artwork is shipped as real Android assets',()=>{
  assert.match(html,/url\('main-profile-bg\.jpg'\)/);
  assert.match(html,/url\('main-profile-icons\.webp'\)/);
  for(const filename of ['main-profile-bg.jpg','main-profile-icons.webp']){
    assert.ok(statSync(new URL('app/'+filename,root)).size>10_000,filename);
    assert.ok(gradle.includes(`../app/${filename}`),filename);
  }
});

test('main profile has real identity/wallet anchors and four owner-designed tiles',()=>{
  for(const selector of ['id="pavb"','class="mid" id="pid"','id="pe"',
    'id="wr"','id="m-svip-label"','id="mp-copy-id"',
    'data-profile-level="wealth"','data-profile-level="charm"',
    'data-profile-stat="followers"','data-profile-stat="following"',
    'data-profile-stat="visitors"','data-m="store"','id="mbd"',
    'data-m="frame"','data-m="daily"'])assert.ok(html.includes(selector),selector);
  assert.match(html,/fmt\(coins\(\)\)/);
  assert.match(html,/RS\(\)\.dia/);
  assert.match(android,/renderVerifiedMainProfileStats\(\)/);
  assert.match(android,/api\('GET','\/bonds\/profile\/'\+id\)/);
});

test('Account & Features stays vertically stacked with six wired destinations',()=>{
  assert.match(html,/#v-me \.mp-features\{display:grid;gap:/);
  for(const [action,label] of [['home','My Room'],['entry','Entry Effects'],
    ['svip','SVIP Club'],['invite','Invite Friends'],
    ['cp','CP &amp; Friendship'],['set','Settings']]){
    assert.ok(html.includes(`feature('${action}'`),label);
  }
  assert.match(android,/styleSelectionSheet\('entry_style'\)/);
  assert.match(android,/showPremiumSheet\(\)\.catch/);
  assert.match(android,/openVerifiedRankProfile\(profile\.public_id\)/);
});
