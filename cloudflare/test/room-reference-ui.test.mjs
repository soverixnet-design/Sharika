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
const premium=readFileSync(new URL('../../android-staging/royal-premium.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../../android-staging/app/build.gradle',import.meta.url),'utf8');

test('all six Royal room controls stay on one compact row so Games is visible',()=>{
  for (const id of ['chatToggle','mic','emoji','inbox','games'])
    assert.ok(room.includes('addTool('+id+','));
  assert.ok(room.includes('const menuButton = addTool('));
  assert.ok(css.includes('grid-template-columns:repeat(6,minmax(0,1fr))'));
  assert.ok(css.includes('width:clamp(44px,12vw,50px)'));
});

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

test('the room layout opens without a spinner or demo members',()=>{
  assert.match(ui,/originalOpenRoom\(room,true\)/);
  assert.match(host,/if\(W\.preview\)return/);
  assert.match(ui,/seats=Array\.from\(\{length:S\.n\},\(_,i\)=>\(\{empty:1,i\}\)\)/);
  assert.doesNotMatch(ui,/sh-room-joining-card|Loading verified seats/);
  assert.doesNotMatch(host,/sh-room-awaiting/);
  assert.doesNotMatch(premium,/sh-room-join-spinner/);
});

test('half-profile is itself the full-profile tap target with no redundant label',()=>{
  assert.match(ui,/hero\.onclick=viewFull/);
  assert.match(ui,/hero\.append\(pair,name,meta,micLocation,tags,levels\)/);
  assert.doesNotMatch(ui,/full\.textContent='View full profile/);
  assert.match(ui,/openVerifiedRoomMemberProfile\(target\.public_id,room\.id,seat\)/);
});

test('Android keyboard focuses the composer without compressing the mic-seat grid',()=>{
  assert.match(room,/app\.classList\.add\('sh-keyboard-open'\)/);
  assert.match(room,/app\.style\.setProperty\('--sh-seat-height', measured \+ 'px'\)/);
  assert.match(room,/document\.addEventListener\('focusin'/);
  assert.match(room,/document\.addEventListener\('pointerdown'/);
  assert.match(room,/window\.scrollTo\(0, 0\)/);
  assert.match(room,/parentViewport\?\.addEventListener\('resize', onViewportResize\)/);
  assert.match(room,/app\.style\.removeProperty\('height'\)/);
  assert.match(java,/clearFlags\(WindowManager\.LayoutParams\.FLAG_FULLSCREEN\)/);
  assert.match(java,/setSoftInputMode\(WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_NOTHING\)/);
  assert.match(java,/getInsets\(WindowInsets\.Type\.ime\(\)\)\.bottom/);
  assert.match(java,/lastRoomImeInsetPx = imeInsetPx/);
  assert.match(room,/nativeImeInset = nativeImeOpen/);
  assert.doesNotMatch(java,/getWindow\(\)\.setFlags\(WindowManager\.LayoutParams\.FLAG_FULLSCREEN/);
  assert.match(css,/\.app\.sh-royal-room\s*\{[\s\S]*?height:100%!important/);
  assert.match(css,/html:has\(\.sh-royal-room\),body:has\(\.sh-royal-room\)/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.stage/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.dock/);
  assert.match(css,/bottom:var\(--sh-ime-inset,0px\)/);
  assert.match(room,/window\.SharikaRoyalKeyboard = Object\.freeze/);
  assert.match(java,/WindowInsets\.Type\.ime\(\)/);
  assert.match(java,/SharikaRoyalKeyboard\?\.setNativeIme/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.chatw/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.sh-tools/);
});

test('last loaded Royal CSS honors new room card and IME layout on Android',()=>{
  const correction=premium.slice(premium.lastIndexOf('/* Final Android room override.'));
  assert.match(correction,/\.app\.sh-royal-room \.top\s*\{[\s\S]*?padding:36px 8px 5px/);
  assert.match(correction,/\.top \.room\s*\{[\s\S]*?left:-8px/);
  assert.match(correction,/\.top \.room\s*\{[\s\S]*?height:50px/);
  assert.match(correction,/\.sh-keyboard-open \.stage/);
  assert.match(correction,/\.sh-keyboard-open \.dock/);
  assert.match(correction,/\.sh-keyboard-open \.sh-tools/);
  assert.match(correction,/content:'QA13'/);
  assert.match(gradle,/versionCode [1-9][0-9]+/);
  assert.match(gradle,/versionName = productionApiOrigin \? '[1-9][0-9]*\.[0-9]+\.[0-9]+' : '[1-9][0-9]*\.[0-9]+\.[0-9]+-staging'/);
});

test('CI can reproduce real Gboard and measure stable seats in an isolated WebView',()=>{
  const qa=readFileSync(new URL('../../android-staging/room-qa/src/main/qa-assets/room-qa.js',
    import.meta.url),'utf8');
  const manifest=readFileSync(new URL('../../android-staging/room-qa/src/main/AndroidManifest.xml',
    import.meta.url),'utf8');
  const activity=readFileSync(new URL('../../android-staging/room-qa/src/main/java/com/soverixnet/sharika/roomqa/RoomQaActivity.java',
    import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../../.github/workflows/sharika-android-staging-apk.yml',
    import.meta.url),'utf8');
  assert.match(qa,/window\.openRoom\(\{id:'10000006'/);
  assert.match(qa,/firstSeat:get\('\.grid \.seat'\)/);
  assert.match(qa,/fingerprint:/);
  assert.doesNotMatch(manifest,/android\.permission\.INTERNET/);
  assert.match(activity,/SOFT_INPUT_ADJUST_NOTHING/);
  assert.match(activity,/WindowInsets\.Type\.ime\(\)/);
  assert.match(workflow,/adb shell input tap "\$\(jq -r '\.tapX'/);
  assert.match(workflow,/firstSeatDelta/);
  assert.match(workflow,/room-keyboard-after\.png/);
});

test('the pending room frame enables its controls only after verified membership',()=>{
  const activation=ui.slice(ui.indexOf('  function activateRoomFrame('),
    ui.indexOf('  window.openRoom=async function(room) {'));
  assert.match(activation,/if\(joinedRoom!==room \|\| window\.cur!==room/);
  assert.ok(activation.indexOf('attachFrame(room)')<
    activation.indexOf("classList.remove('sh-room-preview')"));
  assert.match(ui,/if\(window\.cur\?\.id===room\.id\)/,
    'repeated taps on a visible room do not issue another join');
});

test('verified gift catalog stays browsable when no guest is on a mic',()=>{
  assert.match(ui,/const hasMicRecipients=\(frame\.seats\|\|\[\]\)\.some\(/);
  assert.match(ui,/function showGiftCatalogWithoutMic\(\)\{/);
  assert.match(ui,/frame\.open\('<h3>🎁 Virtual gifts<\/h3>/);
  assert.match(ui,/if\(hasMicRecipients&&typeof originalGiftOpen==='function'\)/);
  assert.match(ui,/else showGiftCatalogWithoutMic\(\)/);
  assert.match(ui,/\(directGiftTarget\?'':' disabled'\)/,
    'an empty room can show virtual gifts but cannot fabricate recipients');
  assert.match(ui,/frame\.G=gifts\.map\(/,
    'all prices and artwork must come from the verified server catalog');
});

test('join establishes a private visit boundary before a nonblocking arrival animation',()=>{
  const join=worker.slice(worker.indexOf("action === 'join' && request.method === 'POST'"),
    worker.indexOf("action === 'leave' && request.method === 'POST'"));
  assert.match(join,/const entryDetails=Promise\.all\(\[/);
  assert.match(join,/await coordinator\.beginRoomVisit\(uid,Number\(latestGift\?\.id\)\|\|0\)/);
  assert.ok(join.indexOf('await coordinator.beginRoomVisit')<
    join.indexOf('await coordinator.roomEntryAnnounce'));
  assert.match(join,/ctx\.waitUntil\(announceEntry\.catch\(/,
    'verified joins should not wait for cosmetic entry effects');
});

test('top room card is shorter in width but thicker without changing microphone seat sizes',()=>{
  const latest=css.slice(css.lastIndexOf('/* Compact, thicker room card:'));
  assert.match(latest,/\.top \.room\{[\s\S]*?flex:0 1 clamp\(145px,47vw,188px\)/);
  assert.match(css,/padding-top:clamp\(14px,2\.4vh,22px\)/,
    'retain the newer Android safe-area offset');
  assert.match(latest,/min-height:50px;height:50px/);
  assert.match(latest,/border:2px solid #f3c777/);
  assert.match(latest,/\.top \.room>\.rav\{[\s\S]*?width:36px;height:36px/);
  // Option 1 intentionally gives the seat grid a four-column geometry. Verify the
  // keyboard-open rules preserve its actual dimensions and position.
  assert.match(css,/\.sh-royal-room \.grid\s*\{\s*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.seat \.av/);
  assert.match(css,/\.sh-royal-room\.sh-keyboard-open \.host \.av/);
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
  assert.match(ui,/const viewFull=\(\)=>\{/);
  assert.match(ui,/frame\.act\('prof',index\);return/);
  assert.match(ui,/frame\.__sharikaOpenQuickProfile=async member=>/);
  assert.match(ui,/renderMemberHalfProfile\(hero,selected,index\)/);
  assert.match(ui,/api\('GET','\/bonds\/profile\/'\+publicId\)/);
  assert.match(ui,/!\/\^\[0-9\]\{8\}\$\/\.test\(String\(partner\?\.id\|\|''\)\)/);
  assert.match(ui,/openVerifiedRoomMemberProfile\(String\(partner\.id\),room\.id\)/);
  assert.match(css,/\.sh-member-cp-pair/);
  assert.match(css,/\.sh-member-cp-heart/);
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
