import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const html=readFileSync(new URL('app/index.html',root),'utf8');
const android=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const gradle=readFileSync(new URL('android-staging/app/build.gradle',root),'utf8');
const royalCss=readFileSync(new URL('app/royal-profile.css',root),'utf8');
const rankings=readFileSync(new URL('cloudflare/src/admin.mjs',root),'utf8');
const opening=readFileSync(new URL('cloudflare/src/opening.mjs',root),'utf8');

test('owner royal profile artwork is shipped as real Android assets',()=>{
  assert.match(royalCss,/url\('\.\/royal-profile-background\.jpg'\)/);
  assert.match(royalCss,/url\('\.\/profile-collection-atlas\.webp'\)/);
  for(const filename of ['royal-profile-background.jpg','profile-collection-atlas.webp',
    'profile-menu-atlas.webp','profile-crown.webp']){
    assert.ok(statSync(new URL('app/'+filename,root)).size>10_000,filename);
    assert.ok(gradle.includes(`../app/${filename}`),filename);
  }
});

test('main profile has real identity/wallet anchors and four owner-designed tiles',()=>{
  for(const selector of ['id="pavb"','class="mid" id="pid"','id="pe"',
    'id="wr"','class="profile-svip-badge" data-m="svip"',
    'data-profile-level="wealth"','data-profile-level="charm"',
    'data-profile-stat="followers"','data-profile-stat="following"',
    'data-profile-stat="visitors"','data-m="store"','id="mbd"',
    'data-m="frame"','data-m="daily"'])assert.ok(html.includes(selector),selector);
  assert.match(html,/coins\(\)\.toLocaleString/);
  assert.match(html,/RS\(\)\.dia/);
  assert.match(android,/renderVerifiedMainProfileStats\(\)/);
  assert.match(android,/api\('GET','\/bonds\/profile\/'\+id\)/);
  assert.match(html,/data-profile-follow="followers"/);
  assert.match(html,/data-profile-follow="following"/);
  assert.match(android,/api\('GET','\/follows'\)/);
  assert.match(android,/anchor\.textContent='ID '\+displayId/);
  assert.match(android,/plaque\.textContent='Neon Special ID'/);
  assert.match(royalCss,/#v-me\.profile-royal \.profile-id-row \{[\s\S]*?flex-wrap: nowrap/);
});

test('Account & Features stays vertically stacked with six wired destinations',()=>{
  assert.match(royalCss,/#v-me\.profile-royal \.ml2 \{[\s\S]*?flex-direction:column/);
  for(const [action,label] of [['home','My Room'],['entry','Entry Effects'],
    ['svip','SVIP Club'],['invite','Invite Friends'],
    ['cp','CP &amp; Friendship'],['set','Settings']]){
    assert.ok(html.includes(`class="mr" data-m="${action}"`),label);
  }
  assert.match(android,/styleSelectionSheet\('entry_style'\)/);
  assert.match(android,/showPremiumSheet\(\)\.catch/);
  assert.match(android,/openVerifiedRankProfile\(profile\.public_id\)/);
});

test('active Special ID is the copied and displayed identity outside Invite',()=>{
  assert.match(android,/copy\.id='sh-copy-own-id'/);
  assert.match(android,/navigator\.clipboard\.writeText\(displayId\)/);
  assert.match(android,/id\.textContent='ID: '\+\(data\.person\.display_id\|\|data\.person\.public_id\)/);
  assert.match(android,/leader\.display_id\|\|leader\.public_id/);
  assert.match(android,/input\.placeholder='Enter member or Special ID'/);
  assert.match(android,/const target=await api\('GET','\/users\/'\+entered\)/);
  assert.match(rankings,/display_id:row\.special_id\|\|id\(row\.public_no\)/);
  assert.match(opening,/display_id:winner\.special_id\|\|asId\(winner\.public_no\)/);
});
