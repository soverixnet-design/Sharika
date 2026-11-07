import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const agency=readFileSync(new URL('android-staging/agency-center.js',root),'utf8');
const admin=readFileSync(new URL('admin/connection.js',root),'utf8');
const family=readFileSync(new URL('cloudflare/src/family.mjs',root),'utf8');
const backend=readFileSync(new URL('cloudflare/src/agency.mjs',root),'utf8');

test('Agency tile offers a full enrollment path without exposing the legacy Family tile',()=>{
  assert.match(agency,/data-ag-directory/);
  assert.match(agency,/async function renderDirectory\(token\)/);
  assert.match(agency,/type==='directory'/);
  assert.match(agency,/\/family\/discover\?sort=recommend/);
  assert.match(agency,/\/family\/creation\/requests/);
  assert.match(agency,/\/family\/creation\/request/);
  assert.match(agency,/\/family\/join/);
  assert.match(agency,/\/family\/invites\//);
  assert.match(agency,/data-ag-join/);
  assert.match(agency,/data-ag-create-agree/);
  assert.match(family,/path==='\/api\/v1\/family\/discover'/);
  assert.match(family,/path==='\/api\/v1\/family\/creation\/request'/);
});

test('an Agency Owner can approve members and explicitly activate or pause Hosts',()=>{
  assert.match(agency,/const ownAgency=Number\(me\?\.agency\?\.id\)===Number\(agency\.id\)/);
  assert.match(agency,/Manage Members & Join Requests/);
  assert.match(agency,/if\(ownAgency\)panel\.querySelector\('\[data-ag-add\]'\)/);
  assert.match(agency,/async function renderMembers\(token,id\)/);
  assert.match(agency,/agency\.role!=='leader'/);
  assert.match(agency,/\/family\/requests/);
  assert.match(agency,/data-ag-approve/);
  assert.match(agency,/data-ag-reject/);
  assert.match(agency,/data-ag-toggle-host/);
  assert.match(agency,/\/agency\/hosts\/assign/);
  assert.match(family,/path==='\/api\/v1\/family\/requests'/);
  assert.match(backend,/path==='\/api\/v1\/agency\/hosts\/assign'/);
});

test('Super Admin Agency navigation contains the pending creation approval queue',()=>{
  assert.match(admin,/P\.agency=async function\(\)/);
  assert.match(admin,/api\('GET','family\/creation\/requests'\)/);
  assert.match(admin,/Pending Agency Creation Applications/);
  assert.match(admin,/data-ag2-approve/);
  assert.match(admin,/data-ag2-reject/);
  assert.match(admin,/family\/creation\/requests\/'.*?'\/approve'/s);
  assert.match(admin,/family\/creation\/requests\/'.*?'\/reject'/s);
  assert.match(admin,/role==='super'\?api\('GET','family\/creation\/requests'\)/);
  assert.match(family,/creationDecision/);
});
