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

test('room palette and gallery photo are authoritative for every joined phone',()=>{
  assert.match(ui,/api\('GET','\/rooms\/'\+room\.id\+'\/members'\)/);
  assert.match(ui,/data\.theme_background_url/);
  assert.match(ui,/frame\.S\.bg=sharedImage/);
  assert.match(ui,/frame\.S\.theme=palette/);
  assert.match(ui,/pickRoomCover\(room,frame,true\)/);
  assert.match(ui,/api\('PATCH','\/rooms\/'\+room\.id,\{theme:nextTheme\}\)/);
  assert.match(ui,/api\('PATCH','\/rooms\/'\+room\.id,\{theme:'photo'\}\)/);
  assert.match(ui,/\.app\.hasbg\{background-position:center center!important;background-size:cover!important/);
});

test('seat emojis follow the authenticated speaker and remote events match the same public ID',()=>{
  assert.match(ui,/frame\.seatEmoji=function\(_ignoredIndex,emoji\)/);
  assert.match(ui,/frame\.seats\?\.find\(slot=>slot\?\.user_id===session\?\.user\?\.id\)/);
  assert.match(ui,/originalSeatEmoji\(mine\.i,emoji\)/);
  assert.match(ui,/frame\.seats\?\.find\(slot=>slot\?\.public_id===event\.public_id\)/);
  assert.match(ui,/originalSeatEmoji\(target\.i,emoji\)/);
  assert.match(ui,/Take an unlocked mic seat to show a seat emoji/);
});

test('clicked seat profile resolves server ID, not the old seat-zero self shortcut',()=>{
  assert.match(ui,/event\.source!==frame\|\|event\.data\?\.t!=='profile'/);
  assert.match(ui,/event\.stopImmediatePropagation\(\)/);
  assert.match(ui,/api\('GET','\/users\/'\+publicId\)/);
  assert.match(ui,/Seat occupant has changed/);
  assert.match(ui,/detail\.textContent='ID '\+id/);
  assert.match(ui,/frame\.act\(action,index\)/);
  assert.match(ui,/fakeStats\.style\.display='none'/);
  assert.match(ui,/paintVerifiedAvatar\(root\.querySelector\('\.pfh \.pav3'\),member\.pic,document\)/);
  assert.match(ui,/api\(following\?'DELETE':'PUT','\/users\/'\+publicId\+'\/follow'\)/);
});
