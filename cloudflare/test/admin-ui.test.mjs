import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const source=readFileSync(new URL('../../admin/connection.js',import.meta.url),'utf8');

test('admin staging connector parses as JavaScript without changing original template',()=>{
  assert.doesNotThrow(()=>new Script(source,{filename:'admin/connection.js'}));
  assert.match(source,/const originalShell = window\.shell/);
  assert.match(source,/originalShell\(\)/);
});

test('ranking UI exposes verified recharge, room, rich and charm kinds',()=>{
  assert.match(source,/const kinds=\{[^\n]*rich:[^\n]*charm:[^\n]*room:[^\n]*recharge:'Top Recharge'/);
  assert.match(source,/api\('GET','rankings\?kind='\+kind\+'&period='\+period\)/);
  assert.match(source,/kind==='recharge'\?'Approved recharge coins':'Gift coins'/);
  assert.match(source,/No approved recharges recorded for this period/);
  assert.doesNotMatch(source,/window\.D\.users=\[\{.*demo/);
});
