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
const host=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
const goldenHome=readFileSync(new URL('../../app/golden-home.css',import.meta.url),'utf8');
const winged=readFileSync(new URL('../../android-staging/royal-winged-theme.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../../android-staging/app/build.gradle',import.meta.url),'utf8');

test('obsolete room demo timers and users are removed from the Android template',()=>{
  assert.match(ui,/for\\\(var ui=0;ui<121;ui\\\+\\\+\\\)U\\\.push/);
  assert.match(ui,/setInterval\(function\(\)\{tick\(false\)\},1600\)/);
  assert.match(ui,/setInterval\(botGift,28000\)/);
  assert.match(ui,/var o=others/);
  const marker='var ROOM_HTML=';
  const start=host.indexOf(marker);
  assert.ok(start>0);
  let end=start+marker.length+1;
  for(;end<host.length;end++){
    if(host[end]==='\\'){end++;continue;}
    if(host[end]==='"')break;
  }
  let template=JSON.parse(host.slice(start+marker.length,end+1));
  assert.match(template,/for\(var ui=0;ui<121;ui\+\+\)U\.push/);
  template=template.replace(/for\(var ui=0;ui<121;ui\+\+\)U\.push\([^\n]*\);/,'')
    .replace('setInterval(function(){tick(false)},1600);','');
  assert.doesNotMatch(template,/for\(var ui=0;ui<121;ui\+\+\)U\.push/);
  assert.doesNotMatch(template,/setInterval\(function\(\)\{tick\(false\)\},1600\)/);
});

test('retired golden JPG is neither layered under the new WebP nor packaged',()=>{
  assert.match(goldenHome,/champagne-home-background\.webp/);
  assert.match(winged,/champagne-home-background\.webp/);
  assert.doesNotMatch(goldenHome,/golden-home-background\.jpg/);
  assert.doesNotMatch(winged,/golden-home-background\.jpg/);
  assert.doesNotMatch(gradle,/from\(rootProject\.file\('\.\.\/app\/golden-home-background\.jpg'\)\)/);
});

test('room opens directly into the hydrated 3D screen without demo-seat flashes',()=>{
  assert.match(ui,/roomWrap\?\.classList\.add\('sh-room-awaiting'\)/);
  assert.match(host,/\.roomwrap\.sh-room-awaiting iframe\{opacity:0/);
  assert.match(ui,/function revealVerifiedRoom\(room,frame\)/);
  assert.match(ui,/if\(window\.cur\?\.id!==room\.id \|\| iframe\?\.contentWindow!==frame/);
  assert.match(ui,/frame\.__sharikaRoomRenderSignature=renderSignature/);
  assert.match(ui,/revealVerifiedRoom\(room,frame\)/);
  assert.match(ui,/document\.getElementById\('rw'\)\?\.classList\?\.remove\('sh-room-awaiting'\)/);
});

test('half-profile is itself the full-profile tap target with no redundant label',()=>{
  assert.match(ui,/hero\.onclick=viewFull/);
  assert.match(ui,/hero\.append\(portrait,name,meta,tags,levels\)/);
  assert.doesNotMatch(ui,/full\.textContent='View full profile/);
  assert.match(ui,/openVerifiedRoomMemberProfile\(target\.public_id,room\.id,seat\)/);
});

test('Android keyboard focuses the composer without compressing the mic-seat grid',()=>{
  assert.match(room,/app\.classList\.add\('sh-keyboard-open'\)/);
  assert.match(room,/if \(seats\) seats\.scrollTop = 0/);
  assert.match(room,/document\.addEventListener\('focusin'/);
  assert.match(room,/window\.scrollTo\(0, 0\)/);
  assert.match(java,/clearFlags\(WindowManager\.LayoutParams\.FLAG_FULLSCREEN\)/);
  assert.match(java,/setSoftInputMode\(WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_RESIZE\)/);
  assert.doesNotMatch(java,/getWindow\(\)\.setFlags\(WindowManager\.LayoutParams\.FLAG_FULLSCREEN/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.stage/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.dock/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.chatw/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.sh-tools/);
});

test('top room card is shorter in width but thicker without changing microphone seat sizes',()=>{
  const latest=css.slice(css.lastIndexOf('/* Compact, thicker room card:'));
  assert.match(latest,/\.top \.room\{[\s\S]*?flex:0 1 clamp\(145px,47vw,188px\)/);
  assert.match(latest,/min-height:44px;height:44px/);
  assert.match(latest,/border:2px solid #f3c777/);
  assert.match(latest,/\.top \.room>\.rav\{[\s\S]*?width:32px;height:32px/);
  assert.doesNotMatch(latest,/\.stage\s*\{|\.grid\s*\{|\.seat\s*\{/);
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
