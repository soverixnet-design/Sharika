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
