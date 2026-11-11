import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveGlobalPublicNo,planPlayPublicIds} from '../src/global-public-ids.mjs';

function registryDb({skipSpecial=false}={}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sharika_users(public_no INTEGER PRIMARY KEY,auth_uid TEXT UNIQUE NOT NULL);
    CREATE TABLE sharika_special_ids(special_id TEXT PRIMARY KEY);
  `);
  const insert=sqlite.prepare('INSERT INTO sharika_users(public_no,auth_uid) VALUES(?,?)');
  for(let n=1;n<=9;n++) insert.run(10000000+n,'old-uid-'+n);
  sqlite.exec(readFileSync(new URL('../migrations/0079_global_public_identity_registry.sql',import.meta.url),'utf8'));
  if(skipSpecial)sqlite.prepare('INSERT INTO sharika_special_ids(special_id) VALUES(?)').run('10000010');
  const binding={
    prepare(sql){
      const statement=sqlite.prepare(sql);
      let args=[];
      return {
        bind(...values){args=values;return this;},
        async first(){return statement.get(...args)||null;},
        async run(){return statement.run(...args);}
      };
    }
  };
  return {sqlite,binding};
}

test('staging IDs 10000001–10000009 remain attached to their original Firebase UIDs',()=>{
  const {sqlite}=registryDb();
  const rows=sqlite.prepare('SELECT public_no,auth_uid,origin FROM sharika_public_id_registry ORDER BY public_no').all();
  assert.equal(rows.length,9);
  assert.equal(rows[0].auth_uid,'old-uid-1');
  assert.equal(rows[8].public_no,10000009);
  assert.ok(rows.every(r=>r.origin==='staging'));
});

test('Play-only profiles receive the next permanent sequential public IDs',async()=>{
  const {sqlite,binding}=registryDb();
  assert.equal(await reserveGlobalPublicNo(binding,'new-play-a','play_virtual'),10000010);
  assert.equal(await reserveGlobalPublicNo(binding,'new-play-b','play_virtual'),10000011);
  assert.equal(await reserveGlobalPublicNo(binding,'new-play-a','play_virtual'),10000010,
    'retries must not allocate a new ID');
  assert.equal(await reserveGlobalPublicNo(binding,'old-uid-3','play_virtual'),10000003,
    'returning users preserve the same number across both environments');
  assert.equal(await reserveGlobalPublicNo(binding,'new-staging-c','staging'),10000012);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sharika_public_id_registry').get().n,12);
  sqlite.close();
});

test('a reserved special ID is skipped rather than assigned as a new public number',async()=>{
  const {binding}=registryDb({skipSpecial:true});
  assert.equal(await reserveGlobalPublicNo(binding,'new-play-a','play_virtual'),10000011);
});

test('new custom Special IDs cannot shadow a globally assigned Play identity',async()=>{
  const {sqlite,binding}=registryDb();
  assert.equal(await reserveGlobalPublicNo(binding,'new-play-a','play_virtual'),10000010);
  assert.throws(()=>sqlite.prepare('INSERT INTO sharika_special_ids(special_id) VALUES(?)')
    .run('10000010'),/global_public_id_reserved/);
  sqlite.prepare('INSERT INTO sharika_special_ids(special_id) VALUES(?)').run('1234');
  assert.throws(()=>sqlite.prepare('UPDATE sharika_special_ids SET special_id=?')
    .run('10000010'),/global_public_id_reserved/);
});

test('parallel signup attempts never reuse a public number for another UID',async()=>{
  const {binding,sqlite}=registryDb();
  const numbers=await Promise.all(Array.from({length:15},(_,i)=>
    reserveGlobalPublicNo(binding,'concurrent-uid-'+i,i%2?'staging':'play_virtual')));
  assert.equal(new Set(numbers).size,15);
  assert.deepEqual([...numbers].sort((a,b)=>a-b),
    Array.from({length:15},(_,i)=>10000010+i));
  sqlite.close();
});

test('unknown identity DB fails closed instead of allocating duplicate local IDs',async()=>{
  await assert.rejects(reserveGlobalPublicNo(null,'user','play_virtual'),/unavailable/);
  const {binding}=registryDb();
  await assert.rejects(reserveGlobalPublicNo(binding,'','play_virtual'),/invalid_global_identity/);
  await assert.rejects(reserveGlobalPublicNo(binding,'user','random'),/invalid_global_id_origin/);
});

test('existing Play accounts are matched by Firebase UID, never their overlapping numeric ID',()=>{
  const staging=Array.from({length:9},(_,i)=>({auth_uid:'old-uid-'+(i+1),public_no:10000001+i}));
  const play=[
    {auth_uid:'new-play-a',public_no:10000001,created_at:'2026-11-09 01:00:00'},
    {auth_uid:'old-uid-3',public_no:10000002,created_at:'2026-11-09 02:00:00'},
    {auth_uid:'old-uid-8',public_no:10000003,created_at:'2026-11-09 03:00:00'},
    {auth_uid:'new-play-b',public_no:10000004,created_at:'2026-11-09 04:00:00'},
  ];
  const rows=planPlayPublicIds(staging,play);
  assert.deepEqual(rows.map(x=>[x.old_play_id,x.canonical_id]),[
    [10000001,10000010],[10000002,10000003],
    [10000003,10000008],[10000004,10000011]
  ]);
  assert.deepEqual(rows.map(x=>x.shared_staging_identity),[false,true,true,false]);
});

test('global ID binding is configured for BOTH Workers; local MAX ID allocation removed',()=>{
  const staging=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  const play=readFileSync(new URL('../wrangler.play.virtual.jsonc',import.meta.url),'utf8');
  for (const config of [staging,play]) {
    assert.match(config,/"binding": "SHARIKA_ID_DB"/);
    assert.match(config,/"database_id": "b2c62252-12a5-4740-90c7-01a536d9a39a"/);
  }
  const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
  assert.match(worker,/reserveGlobalPublicNo\(env\.SHARIKA_ID_DB/);
  assert.doesNotMatch(worker,/COALESCE\(MAX\(public_no\),10000000\)\+1 FROM sharika_users/);
});
