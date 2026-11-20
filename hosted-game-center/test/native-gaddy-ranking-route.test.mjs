import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const java=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaGameCenterActivity.java',import.meta.url),'utf8');
const privateSite=readFileSync(new URL('../src/private-index.mjs',import.meta.url),'utf8');

test('Gaddy ranked GET queries are allowed through both secure Android game bridges',()=>{
  assert.ok(java.includes('(sovera-food|sovera-gaddy|night-food|jackpot-fruit|food-deluxe|greedy-classic|fruit-royale)/rankings'));
  assert.ok(java.includes('rankings\\\\?period=(daily|weekly|monthly)'));
});

test('signed-in private game iframe stays embed-safe without public demo wallet',()=>{
  assert.ok(privateSite.includes('frame-src \'self\''));
  assert.ok(privateSite.includes('policy=policy.replace('));
  assert.ok(privateSite.includes('.replace(\'<script src="/practice.js" defer></script>\',\'\')'));
  assert.ok(privateSite.includes('LIVE GAME · SHARIKA APP REQUIRED'));
  assert.ok(privateSite.includes('eventAudienceAllows'));
});
