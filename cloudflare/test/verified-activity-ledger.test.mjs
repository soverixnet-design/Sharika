import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('verified activity migration mirrors only trusted source rows without changing balances',()=>{
  const script=fileURLToPath(new URL('./verified-activity-sql.test.py',import.meta.url));
  const result=spawnSync('python3',[script],{encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/Verified activity ledger/);
});
