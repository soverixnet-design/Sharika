'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const script=fs.readFileSync(__dirname+'/royal-style03-test.js','utf8');
const style=fs.readFileSync(__dirname+'/royal-style03-test.css','utf8');
const frame=fs.readFileSync(__dirname+'/royal-style03-frame.svg','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const gradle=fs.readFileSync(__dirname+'/../android-staging/app/build.gradle','utf8');
test('only a single chosen user can open the fit preview',()=>{
  assert.match(script,/var TARGET='10000003'/);
  assert.match(script,/String\(raw\)===TARGET/);
  assert.match(script,/profile\.classList\.contains\('on'\)/);
  assert.match(script,/if\(!userIsTest\(\)\)return/);
});
test('no phantom media URLs or wallet changes',()=>{
  assert.match(script,/var MEDIA=Object\.freeze\(\{vip:'',entry:'',gift:'',medal:''\}\)/);
  assert.match(script,/return u\.origin===ORIGIN/);
  assert(!script.includes('update sharika_users'));
  assert(!script.includes('addCoins('));
});
test('center opening remains transparent and photo controls clickable',()=>{
  assert.match(style,/pointer-events:none!important/);
  assert.match(frame,/fill="none"/);
  assert.match(frame,/<circle/);
});
test('Android build packages css, svg and js',()=>{
  for(const x of ['royal-style03-test.js','royal-style03-test.css','royal-style03-frame.svg']){
    assert(html.includes(x)||x.endsWith('.svg'),x);
    assert(gradle.includes(x),x);
  }
});
