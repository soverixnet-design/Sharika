import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const room=readFileSync(new URL('../../app/royal-room-ui.js',import.meta.url),'utf8');
const roomCss=readFileSync(new URL('../../app/reference-room.css',import.meta.url),'utf8');
const ranking=readFileSync(new URL('../../app/royal-ranking-v2.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../../android-staging/app/build.gradle',import.meta.url),'utf8');

test('room chat opens public composer and private DM retains independent control',()=>{
  assert.match(room,/addTool\(chatToggle,'chat','Room Chat'\)/);
  assert.match(room,/addTool\(inbox,'dm','Private DM'\)/);
  assert.match(room,/composer\.hidden=!opening/);
  assert.match(room,/const inbox = byId\('bMsg'\)/);
  assert.match(roomCss,/\.sh-icon-chat\s*\{[\s\S]*?room-chat-message\.svg/);
  assert.match(gradle,/from\(rootProject\.file\('\.\.\/app\/room-chat-message\.svg'\)\)/);
});

test('room profile is a left-aligned large card, without covering the mic grid',()=>{
  assert.match(room,/top\.insertBefore\(roomInfo, top\.children\[1\]\)/);
  assert.match(roomCss,/\.top \.room\s*\{[\s\S]*?flex:1 1 0!important/);
  assert.match(roomCss,/\.top \.room \.rav\s*\{[\s\S]*?width:61px/);
  assert.match(roomCss,/\.chatw\s*\{[\s\S]*?background:transparent!important/);
  assert.match(roomCss,/#grid\.grid\s*\{[\s\S]*?repeat\(4,minmax\(0,1fr\)\)/);
});

test('weekly winner slots stay centered regardless of missing third winner',()=>{
  assert.match(ranking,/\.sh-rw-podium\s*\{[\s\S]*?display:grid/);
  assert.match(ranking,/\.sh-rw-winner\.rank-1\s*\{grid-column:2/);
  assert.match(ranking,/\.sh-rw-winner\.rank-2\s*\{grid-column:1/);
  assert.match(ranking,/\.sh-rw-winner\s*\{grid-column:3/);
  assert.match(ranking,/\.sh-rw-winner small\s*\{[\s\S]*?text-overflow:ellipsis/);
});

test('full integrated staging runs real Android emulator keyboard and Back QA',()=>{
  const workflow=readFileSync(new URL(
    '../../.github/workflows/sharika-android-staging-apk.yml',import.meta.url),'utf8');
  const emulator=workflow.slice(workflow.indexOf('  royal-emulator-smoke:'),
    workflow.indexOf('  royal-family-api-staging:'));
  assert.match(emulator,/feature\/sharika-full-integrated-staging-20261107/);
  assert.match(emulator,/SHARIKA_REAL_ANDROID_IME_ROOM_HEADER_AND_SEATS_STABLE_OK/);
  assert.match(emulator,/SHARIKA_ANDROID_EMULATOR_LAUNCH_AND_BACK_NO_CRASH_OK/);
});

test('emulator harness opens public Room Chat before probing keyboard geometry',()=>{
  const generator=readFileSync(new URL(
    '../../android-staging/room-qa/scripts/generate-room-fixture.mjs',import.meta.url),'utf8');
  const harness=readFileSync(new URL(
    '../../android-staging/room-qa/src/main/qa-assets/room-qa.js',import.meta.url),'utf8');
  assert.match(generator,/reference-room\.css/);
  assert.match(harness,/getElementById\('sh-chat-toggle'\)/);
  assert.match(harness,/toggle\.click\(\)/);
  assert.match(harness,/room_chat_keyboard_not_ready/);
  assert.match(harness,/if \(\(rect\.width < 20 \|\| rect\.height < 8\)/);
});
