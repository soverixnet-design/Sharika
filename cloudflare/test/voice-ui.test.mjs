import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Browser-only adapter is syntax-checked in npm check. These assertions
// protect the user-facing seat and microphone recovery wiring from regression.
const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

test('guest can tap an open seat without an invitation dialog',()=>{
  assert.match(ui,/\.seat\.empty\[data-i\]/);
  assert.match(ui,/room\.owner_id===session\?\.user\?\.id\)return/);
  assert.match(ui,/api\('PUT','\/rooms\/'\+room\.id\+'\/seat',\{seat_no:seat\}\)/);
});
test('both SFU peer connections have Cloudflare STUN discovery',()=>{
  assert.match(ui,/stun:stun\.cloudflare\.com:3478/);
  assert.equal((ui.match(/new RTCPeerConnection\(SHARIKA_ICE_CONFIG\)/g)||[]).length,2);
});
test('mic button retries a failed capture or an interrupted uplink',()=>{
  assert.match(ui,/async function restartMicrophone\(roomId\)/);
  assert.match(ui,/if\(failed\|\|!track\|\|track\.readyState!=='live'\)/);
  assert.match(ui,/return restartMicrophone\(window\.cur\?\.id\|\|wantedVoiceRoom\)/);
});
