import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../../app/royal-room-ui.css',import.meta.url),'utf8');
const room=readFileSync(new URL('../../app/royal-room-ui.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const java=readFileSync(new URL(
  '../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',
  import.meta.url),'utf8');

test('Android keyboard focuses the composer without compressing the mic-seat grid',()=>{
  assert.match(room,/app\.classList\.add\('sh-keyboard-open'\)/);
  assert.match(room,/if \(seats\) seats\.scrollTop = 0/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.stage/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.dock/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.chatw/);
});

test('seat invitation requires authenticated response with verified inviter presentation',()=>{
  assert.match(ui,/sh-invite-owner-photo/);
  assert.match(ui,/sh-invite-message/);
  assert.match(ui,/Cancel<\/button>/);
  assert.match(ui,/Confirm<\/button>/);
  assert.match(ui,/await api\('POST','\/rooms\/'\+room\.id\+'\/invitations\/respond'/);
  assert.match(ui,/actualOwner\?\.pic/);
});

test('seat half-profile opens fully verified profile and mute badge sits above frames',()=>{
  assert.match(ui,/sh-member-half/);
  assert.match(ui,/const viewFull=\(\)=>frame\.act\('prof',index\)/);
  assert.match(ui,/openVerifiedRoomMemberProfile\(target\.public_id,room\.id,seat\)/);
  assert.match(css,/\.sh-royal-room \.seat \.av > \.badge/);
  assert.match(css,/z-index:32!important/);
});

test('standalone Room Settings reads real admins, blocks and kick history',()=>{
  assert.match(ui,/frame\.settings=openRoomSettingsPage/);
  assert.match(ui,/row\(modGroup,'Admins'/);
  assert.match(ui,/row\(modGroup,'Blocked List'/);
  assert.match(ui,/row\(modGroup,'Kick History'/);
  assert.match(worker,/action==='kick-history'/);
  assert.match(java,/kick-history\$/);
  assert.match(css,/#sh-room-settings-page/);
  assert.match(ui,/policyModePage\('Who Can Send Room Chat','chat_mode'\)/);
  assert.match(ui,/policyModePage\('Who Can Take The Mic','mic_mode'\)/);
  assert.match(ui,/passwordPolicyPage/);
  assert.match(ui,/super_mic:currentPolicy\.super_mic===false/);
  assert.match(worker,/action==='policy'/);
  assert.match(java,/\/policy\$/);
});
