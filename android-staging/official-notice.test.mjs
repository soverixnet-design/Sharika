import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script=readFileSync(new URL('./staging-connection.js',import.meta.url),'utf8');
const back=readFileSync(new URL('./back-navigation.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/official-notice.css',import.meta.url),'utf8');
const gradle=readFileSync(new URL('./app/build.gradle',import.meta.url),'utf8');
const start=script.indexOf('  // Official Notice is a read-only');
const end=script.indexOf('  // Real Notifications inbox.',start);
assert.ok(start>0&&end>start);
const notice=script.slice(start,end);
test('reference screen shows white notice header, time and chat bubbles',()=>{
  assert.match(css,/\.sh-official-page\.on\{display:flex\}/);
  assert.match(css,/background:#f6f6f6/);
  assert.match(css,/\.sh-official-top h2/);
  assert.match(css,/\.sh-official-date/);
  assert.match(css,/\.sh-official-row/);
  assert.match(css,/\.sh-official-avatar/);
  assert.match(css,/\.sh-official-bubble/);
  assert.match(notice,/Official Notice<\/h2>/);
  assert.match(notice,/aria-label="Official Notice options"/);
  assert.match(notice,/\.\/sharika_logo\.jpg/);
  assert.doesNotMatch(notice,/Hello, I am the official customer service/);
  assert.doesNotMatch(notice,/You have left the.*FAMILY/);
});
test('only verified official/system server notices appear and content is text-safe',()=>{
  assert.match(notice,/api\('GET',cursor\?'\/notifications\/history\/'\+cursor:'\/notifications'\)/);
  assert.match(notice,/\['official','system'\]\.includes\(item\.kind\)/);
  assert.match(notice,/message\.textContent=body/);
  assert.match(notice,/heading\.textContent=title/);
  assert.match(notice,/existing\.has\(String\(item\.id\)\)/);
  assert.doesNotMatch(notice,/\.innerHTML\s*\+=\s*item\.body/);
});
test('options are functional and read updates never affect unrelated inbox items',()=>{
  assert.match(notice,/data-notice-option="refresh"/);
  assert.match(notice,/data-notice-option="read"/);
  assert.match(notice,/data-notice-option="inbox"/);
  assert.match(notice,/api\('PATCH','\/notifications\/'\+item\.id\+'\/read'/);
  assert.doesNotMatch(notice,/api\('POST','\/notifications\/read-all'/);
});
test('both Messages and Notifications link to Official Notice',()=>{
  assert.match(script,/id="verified-official-notices"/);
  assert.match(script,/getElementById\('verified-official-notices'\)\.onclick=showOfficialNotice/);
  assert.match(script,/id="sh-notify-official"/);
  assert.match(script,/querySelector\('#sh-notify-official'\)\.onclick=showOfficialNotice/);
  assert.match(back,/\.sh-official-page\.on/);
  assert.match(back,/\.sh-official-back/);
});
test('Android packaging includes notice CSS without changing native auth',()=>{
  assert.match(gradle,/sharika-official-notice-style/);
  assert.match(gradle,/rootProject\.file\('\.\.\/app\/official-notice\.css'\)/);
  assert.match(gradle,/rootProject\.file\('staging-connection\.js'\)/);
  assert.match(gradle,/rootProject\.file\('back-navigation\.js'\)/);
});
test('timestamps originate from D1 and invalid values are blank',()=>{
  const a=script.indexOf('  function officialNoticeTimestamp(');
  const b=script.indexOf('  function ensureOfficialNoticePanel(',a);
  assert.ok(a>0&&b>a);
  const snippet=script.slice(a,b);
  const out=runInNewContext(snippet+
    ";[officialNoticeTimestamp('2026-11-08 04:55:00'),officialNoticeTimestamp('bad'),officialNoticeTimestamp(null)]",{});
  assert.match(out[0],/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(out[1],'');
  assert.equal(out[2],'');
});
