import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const folder=new URL('../../android-staging/app/src/main/assets/sharika-premium/',import.meta.url);
const items=JSON.parse(readFileSync(new URL('manifest.json',folder),'utf8'));

test('all source ornaments are individual non-empty animated WebP files',()=>{
  assert.equal(items.length,97);
  assert.equal(new Set(items.map(item=>item.id)).size,97);
  const allowed=new Set(['frame_style','medal_style','name_tag_style']);
  for(const item of items){
    assert.ok(allowed.has(item.kind),item.id);
    assert.match(item.id,/^[a-z0-9-]+$/);
    assert.equal(item.art,item.id+'.webp');
    const path=new URL(item.art,folder);
    assert.ok(statSync(path).size>1000,item.id);
    const header=readFileSync(path).subarray(0,12);
    assert.equal(header.toString('ascii',0,4),'RIFF',item.id);
    assert.equal(header.toString('ascii',8,12),'WEBP',item.id);
  }
});

test('SVIP, Noble and role ornaments remain separate categories',()=>{
  const count=group=>items.filter(item=>item.group===group).length;
  assert.equal(count('vip'),1);
  assert.equal(count('svip'),33);
  assert.equal(count('noble'),1);
  assert.equal(count('role'),62);
  assert.equal(items.filter(item=>item.id.startsWith('svip-frame-')).length,8);
  assert.equal(items.filter(item=>item.id.startsWith('svip-medal-')).length,8);
  assert.equal(items.filter(item=>item.id.startsWith('svip-tag-')).length,17);
});
