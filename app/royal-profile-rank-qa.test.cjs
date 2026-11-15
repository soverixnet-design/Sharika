'use strict';
// Static regression guard for Royal ID styling. These tests do not replace
// two-device screenshot review of signed APKs or server-side entitlement tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const here = __dirname;
const rank = fs.readFileSync(path.join(here,'royal-ranking-v2.css'),'utf8');
const profile = fs.readFileSync(path.join(here,'royal-profile.css'),'utf8');
const adapter = fs.readFileSync(path.join(here,'../android-staging/staging-connection.js'),'utf8');
const cssBalanced = text => {
  let depth=0;
  for(const c of text) {
    if(c==='{')depth++;
    else if(c==='}')depth--;
    if(depth<0)return false;
  }
  return depth===0;
};
test('Royal screen CSS remains structurally balanced',()=>{
  assert(cssBalanced(rank));
  assert(cssBalanced(profile));
});
test('verified ranking winner IDs have no dark backdrop',()=>{
  assert(rank.includes('SHARIKA_ROYAL_RANKING_CLEANUP_20261115'));
  assert.match(rank,/#v-rank #rb \.sh-royal-podium-card \.sh-royal-id\s*\{[^}]*background:transparent!important/s);
  assert.match(rank,/#sh-rank-reward-center \.sh-rw-winner strong,[\s\S]*\.sh-rw-winner b\s*\{[^}]*background:transparent!important/s);
  assert(rank.includes('#v-rank #rb .sh-royal-podium-card .sh-royal-avatar'));
  assert(adapter.includes("royalRankingV2.href='./royal-ranking-v2.css'"));
});
test('public profile cover respects uploaded background and default art exists',()=>{
  assert(profile.includes('SHARIKA_ROYAL_PUBLIC_PROFILE_CLEANUP_20261115'));
  assert.match(profile,/\.cov:not\(\[style\*="background-image"\]\):not\(\[style\*="background:"\]\)/);
  assert.match(profile,/\.cov\s*\{[\s\S]*?background-color:#2c164b!important/);
  assert(fs.statSync(path.join(here,'royal-profile-background.jpg')).size>0);
  assert(adapter.includes("const savedCover=verifiedUserCoverUrl(person.cover)"));
  assert(adapter.includes("cover.style.setProperty('background-image'"));
  assert(adapter.includes("'important');"));
});
test('server-authorized tags and medals preserve admin placement',()=>{
  assert(adapter.includes("['medal',medalArt(person.medal_style)]"));
  assert(adapter.includes("['tag',nameTagArt(person.name_tag_style)]"));
  assert(adapter.includes("applyProfileLayout('public',root)"));
  assert(adapter.includes("paintProfileId(publicLabel,person)"));
  assert.match(profile,/\.pfh>\.pavw>\.sh-layout-ornament\s*\{/);
  assert(profile.includes('[data-sh-position="id"]'));
});
test('no ranking data, wallet or relationship mutations in CSS-only patch',()=>{
  assert(fs.statSync(path.join(here,'royal-ranking-podium.webp')).size>0);
  assert(adapter.includes('function royalRankAction('));
  assert(adapter.includes('function openVerifiedRankProfile('));
  assert(adapter.includes("mountBondDetails(root,canonicalId,person)"));
});
