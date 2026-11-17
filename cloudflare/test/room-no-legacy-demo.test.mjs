import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const android=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const packaged=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');

function sanitizedPackagedRoom(){
  const room=packaged.match(/var ROOM_HTML=("(?:\\.|[^"\\])*");/);
  assert.ok(room,'packaged room template must be present');
  const original=JSON.parse(room[1]);
  const begin=android.indexOf("  if(typeof window.ROOM_HTML === 'string') {");
  const end=android.indexOf('  // A FREE reward box',begin);
  assert.ok(begin>=0&&end>begin,'verified room preview sanitizer must exist');
  const context=createContext({window:{ROOM_HTML:original}});
  runInContext(android.slice(begin,end),context);
  return {original,cleaned:context.window.ROOM_HTML};
}

test('packaged verified room does not load legacy fake users, gift bot or fake chat timers',()=>{
  const {original,cleaned}=sanitizedPackagedRoom();
  // The static asset itself must now be clean, not just an Android
  // runtime replacement. Otherwise the next UI rebuild revives demo traffic.
  assert.doesNotMatch(original,/function botGift\(\)/);
  assert.doesNotMatch(original,/for\(var ui=0;ui<121;ui\+\+\)U\.push/);
  assert.doesNotMatch(original,/var UN=\[/);
  assert.doesNotMatch(original,/setInterval\(botGift,28000\)/);
  assert.doesNotMatch(original,/msg\("Rafi","🧑‍🎤","Greetings to everyone/);
  assert.doesNotMatch(cleaned,/function botGift\(\)/);
  assert.doesNotMatch(cleaned,/for\(var ui=0;ui<121;ui\+\+\)U\.push/);
  assert.doesNotMatch(cleaned,/var UN=\[/);
  assert.doesNotMatch(cleaned,/setInterval\(botGift,28000\)/);
  assert.doesNotMatch(cleaned,/setInterval\(function\(\)\{tick\(false\)\},1600\)/);
  assert.doesNotMatch(cleaned,/setInterval\(function\(\)\{var o=others\(\)/);
  assert.doesNotMatch(cleaned,/msg\("Rafi","🧑‍🎤","Greetings to everyone/);
  assert.doesNotMatch(cleaned,/coins:12450,xp:7200/);
  assert.match(cleaned,/coins:0,xp:0/);
  assert.match(cleaned,/var U=\[\],FOL=\{\};/);
});

test('verified preview preserves the original layout while hiding unverified actions',()=>{
  const {cleaned}=sanitizedPackagedRoom();
  assert.match(cleaned,/sh-room-preview/);
  assert.match(cleaned,/sh-room-no-snapshot/);
  assert.match(cleaned,/data-frame="grad" inert/);
  assert.match(cleaned,/if\(W\?\.preview\)/);
  assert.match(cleaned,/<\/html>/);
});
