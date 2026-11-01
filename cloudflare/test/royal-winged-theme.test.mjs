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
