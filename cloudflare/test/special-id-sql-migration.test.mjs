import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Special ID 1–10 SQLite migration retains aliases and blocks canonical collisions',()=>{
  const script=fileURLToPath(new URL('./special-id-migration-check.py',import.meta.url));
  const result=execFileSync('python3',[script],{encoding:'utf8',timeout:15000});
  assert.match(result,/Special ID 1–10 migration, legacy aliases/);
});
