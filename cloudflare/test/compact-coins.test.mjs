import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const original=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
const between=(source,from,to)=>{
  const a=source.indexOf(from),b=source.indexOf(to,a+from.length);
  assert.ok(a>=0&&b>a,'missing compact coin formatter');
  return source.slice(a,b);
};
const androidFn=new Function(
  between(adapter,'// BEGIN VERIFIED COMPACT COIN DISPLAY','// END VERIFIED COMPACT COIN DISPLAY')+
  '\nreturn formatCompactCoins;'
)();
const mainFn=new Function(
  "const bn=n=>String(n);"+
  between(original,'var fmt=function(n)','/* ===== Config')+
  'return fmt;'
)();
const roomStart=original.indexOf('var cfmt=function(n)');
assert.ok(roomStart>=0,'room coin formatter missing');
const roomEnd=original.indexOf('};\\n',roomStart);
assert.ok(roomEnd>roomStart);
const roomFn=new Function('const bn=n=>String(n);'+
  original.slice(roomStart,roomEnd+2)+';return cfmt;')();

test('profile, room and verified wallet display the same k/m coin amounts',()=>{
  const cases=[
    [0,'0'],[999,'999'],[1000,'1k'],[10000,'10k'],[100000,'100k'],
    [1000000,'1m'],[10000000,'10m'],[100000000,'100m'],
    [1500000,'1.5m'],[999999,'999.99k'],[1000000000,'1b'],
    [1000000000000,'1t']
  ];
  for(const [amount,expected] of cases){
    for(const fn of [androidFn,mainFn,roomFn])
      assert.equal(fn(amount),expected,'amount '+amount);
  }
});
test('compact values are presentation-only; transfer forms and receipts retain exact amounts',()=>{
  assert.match(adapter,/const coinsText=value=>formatCompactCoins\(value\)/);
  assert.match(adapter,/const exactCoins=value=>Number\(value\|\|0\)\.toLocaleString/);
  assert.match(adapter,/target_public_id:recipient,coins:amount/);
  assert.match(adapter,/exactCoins\(amount\)/);
  assert.match(original,/cfmt\(S\.coins\)/);
  assert.match(original,/fmt\(coins\(\)\)/);
});
