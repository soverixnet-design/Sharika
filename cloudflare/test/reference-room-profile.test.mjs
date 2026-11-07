import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const html=read('app/index.html');
const roomJs=read('app/royal-room-ui.js');
const roomCss=read('app/reference-room.css');
const profileCss=read('app/reference-profile.css');
const bridge=read('android-staging/staging-connection.js');
const assets=read('android-staging/app/build.gradle');

test('reference room shows a 5-column microphone grid, not an owner throne',()=>{
  assert.match(roomCss,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(roomCss,/#host,\s*\n\.app\.sh-royal-room \.host \{display:none!important\}/);
  assert.doesNotMatch(roomJs,/Owner throne/);
  assert.match(roomJs,/byId\('host'\)\?\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(bridge,/seat_count:20/);
  assert.match(bridge,/moveSelfToSeat\(seat\)\.catch/);
  assert.match(bridge,/frame\.document\.addEventListener\('contextmenu'/);
});

test('reference room keeps all original verified controls and seat-count updates',()=>{
  for(const id of ['bMsg','bGift','mic','emo','bGame'])
    assert.ok(roomJs.includes(`byId('${id}')`),`original #${id} control`);
  assert.match(roomJs,/dock\.replaceChildren\(byId\('tray'\), composer, toolRow, gifts, box, menuPanel\)/);
  assert.match(bridge,/seat_count:requested/);
  assert.match(bridge,/Choose between 4 and 20 mic seats/);
  assert.match(assets,/reference-room\.css/);
});

test('reference profile matches the menu without losing verified account features',()=>{
  for(const label of ['My Profile','Wallet','Mall','Aristocracy','Level','Medal',
    'Backpack','Language','Feedback','Invite Reward','Settings'])
    assert.ok(html.includes(label),label);
  assert.match(profileCss,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(profileCss,/#001b12/);
  assert.match(bridge,/renderVerifiedMainProfileStats\(\)/);
  assert.match(bridge,/openRoyalMarket\('backpack'\)/);
  assert.match(assets,/reference-profile\.css/);
});
