'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const script=fs.readFileSync(__dirname+'/royal-style03-test.js','utf8');
const style=fs.readFileSync(__dirname+'/royal-style03-test.css','utf8');
const frame=fs.readFileSync(__dirname+'/royal-style03-frame.svg','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const gradle=fs.readFileSync(__dirname+'/../android-staging/app/build.gradle','utf8');
test('Style03 script loads only after the main app script and stays out of nested room template',()=>{
  const needle='<script src="./royal-style03-test.js"></script>';
  assert.strictEqual(html.split(needle).length,2,'Script must be inserted exactly once');
  assert.match(html,/<script src="\.\/royal-style03-test\.js"><\/script>\s*<\/body>/);
  const lastClose=html.lastIndexOf('</body>');
  assert(lastClose>html.length-150,'Must load at document end');
  assert(html.indexOf(needle)>html.indexOf("var ROOM_HTML="),'Must not inject inside ROOM_HTML');
  assert(!html.includes(".replace('<script src=\"./royal-style03-test.js"),'Do not rewrite embedded room script strings');
});
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
