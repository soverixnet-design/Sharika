import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const android=new URL('../../android-staging/',import.meta.url);
test('winged royal theme is bundled with original user artwork and 3D icon atlas',()=>{
  const sheet=readFileSync(new URL('royal-winged-theme.css',android),'utf8');
  const script=readFileSync(new URL('royal-premium.js',android),'utf8');
  const gradle=readFileSync(new URL('app/build.gradle',android),'utf8');
  const art=statSync(new URL('royal-winged-bg.jpg',android));
  const icons=statSync(new URL('royal-icon-atlas.png',android));
  assert.ok(art.size>100000 && icons.size>100000);
  assert.match(sheet,/\.app:not\(\.royal-profile\)/);
  assert.match(sheet,/\.app\.royal-default-room/);
  assert.match(sheet,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(sheet,/\.app\.royal-profile\s*\{/);
  assert.match(script,/royal-winged-theme\.css/);
  for(const name of ['royal-winged-theme.css','royal-winged-bg.jpg','royal-icon-atlas.png'])
    assert.ok(gradle.includes(name),name+' must be packaged into APK');
});

test('new royal styles are present before the app or room is shown',()=>{
  const script=readFileSync(new URL('royal-premium.js',android),'utf8');
  const activity=readFileSync(new URL('app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',android),'utf8');
  assert.match(script,/function preloadRoomStyles\(\)/);
  assert.match(script,/window\.ROOM_HTML=window\.ROOM_HTML\.replace\('<\/head>',head\+'<\/head>'\)/);
  assert.match(script,/Promise\.all\(installSheet\(document,'royal-root'\)\.map\(waitForSheet\)\)/);
  assert.match(script,/window\.SharikaNative\.call\('0','visualReady','\{\}'\)/);
  assert.match(activity,/browser\.setVisibility\(View\.INVISIBLE\)/);
  assert.match(activity,/case "visualReady":/);
  assert.match(activity,/view\.postDelayed\(\(\) -> \{/);
  assert.match(activity,/5500\)/);
});

test('golden theme unifies staging screens while keeping chosen artwork and room themes',()=>{
  const sheet=readFileSync(new URL('royal-winged-theme.css',android),'utf8');
  const required=[
    'html.royal-root .app.golden-home',
    'html.royal-root .app.royal-profile .nav .ni span',
    'html.royal-root #v-rank',
    'html.royal-root #v-msg',
    'html.royal-root #sh.sharika-daily-3d',
    'html.royal-root #sh-invite-page',
    'html.royal-root #sharika-seller-content .shw-hero',
    'html.royal-root .sh-bond-panel',
    'html.royal-root .sh-notify-panel',
    'html.royal-root #sh-room-game-sheet',
    'html.royal-root .auth',
    'html.royal-room .app .rb'
  ];
  for(const selector of required)
    assert.ok(sheet.includes(selector),selector+' missing golden treatment');
  assert.match(sheet,/\.app\.golden-home\{[\s\S]*?champagne-home-background\.webp/);
  assert.match(sheet,/\.app\.royal-profile \.nav \.ni\[data-v="me"\] span/);
  assert.match(sheet,/html\.royal-room\{[\s\S]*?--gold:#ffdb8d/);
  assert.doesNotMatch(sheet,/html\.royal-room \.app\.hasbg\s*\{[\s\S]{0,150}background-image/);
  assert.match(sheet,/prefers-reduced-motion:reduce/);
  assert.match(sheet,/focus-visible/);
});

test('gold follow-up includes SVIP, recharge, branded opening and game catalog',()=>{
  const sheet=readFileSync(new URL('royal-winged-theme.css',android),'utf8');
  for(const selector of [
    'html.royal-root #sh-svip-royal',
    'html.royal-root #sh-svip-royal .svip-card',
    'html.royal-root #sh-svip-royal .svip-main-btn',
    'html.royal-root #rcp .rch',
    'html.royal-root #rcp .pk button',
    'html.royal-root #sh-opening',
    'html.royal-root #sh-original-grid>button'
  ])assert.ok(sheet.includes(selector),selector);
  assert.match(sheet,/\.sh-invite-royal-banner\{[\s\S]*?main-profile-bg\.jpg/);
  assert.doesNotMatch(sheet,/html\.royal-room \.app\.hasbg\s*\{[\s\S]{0,150}background-image/);
});
