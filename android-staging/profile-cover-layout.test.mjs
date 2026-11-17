import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./staging-connection.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/sharika-cover-profile.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('./app/build.gradle',import.meta.url),'utf8');
test('profile cover is 100% width with responsive 265dp minimum and no blur',()=>{
  assert.match(css,/height:clamp\(265px,34dvh,350px\)/);
  assert.match(css,/background-size:cover!important/);
  assert.match(css,/filter:none!important/);
  assert.match(css,/sh-ranked-profile>\.cov/);
  assert.match(css,/sh-public-cover-add/);
  assert.doesNotMatch(css,/#v-me\.profile-royal\s*\{/);
});
test('native Android build packages the new CSS without replacing auth bridge',()=>{
  assert.match(gradle,/sharika-cover-profile-v1/);
  assert.match(gradle,/from\(rootProject\.file\('\.\.\/app\/sharika-cover-profile\.css'\)\)/);
  assert.match(gradle,/from\(rootProject\.file\('staging-connection\.js'\)\)/);
});
test('verified covers, real roles and verified cosmetic grants remain in use',()=>{
  assert.match(source,/verifiedUserCoverUrl\(person\.cover\)/);
  assert.match(source,/api\('PUT','\/me\/cover-image'/);
  assert.match(source,/paintVerifiedProfileFrame\(root\.querySelector/);
  assert.match(source,/paintProfileId\(publicLabel,person\)/);
  assert.match(source,/person\.bd_active/);
  assert.match(source,/person\.seller_active/);
  assert.match(source,/applyProfileLayout\('public',root\)/);
});
test('CP and empty CP states use server data and a real invitation flow',()=>{
  assert.match(source,/if\(data\.cp\?\.partner\)/);
  assert.match(source,/sh-public-cp-add/);
  assert.match(source,/showBondGiftSheet\(mine\?null:/);
  assert.match(source,/api\('GET','\/bonds\/profile\/'\+id\)/);
  assert.match(source,/CP couple belongs in the dedicated card/);
  const fn=source.slice(source.indexOf('async function mountBondDetails('),
      source.indexOf('let rankProfileRequest=0;'));
  assert.doesNotMatch(fn,/mountRoyalCpHero\(/);
});
