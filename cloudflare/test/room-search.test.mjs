import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {searchVerifiedRooms} from '../src/room-search.mjs';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  for(let i=1;i<=105;i++){
    const id=String(10000000+i);
    const uid='member-'+i;
    db.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,status) '+
      'VALUES(?,?,?,?,0,?)').run(Number(id),uid,'Member '+i,'2000-01-01',i===104?'blocked':'active');
    db.prepare('INSERT INTO sharika_rooms(id,owner_id,name) VALUES(?,?,?)')
      .run(id,uid,i===105?'Royal Garden':i===104?'Private blocked':'Room '+i);
  }
  return {db,d1:{prepare(sql){return {bind(...args){return {async all(){
    return {results:db.prepare(sql).all(...args)};
  }};}};}}};
}

test('room search finds exact room outside first 100 with no wallet or user data',async()=>{
  const {db,d1}=fixture();
  try{
    const result=await searchVerifiedRooms(d1,'10000105');
    assert.equal(result.read_only,true);
    assert.equal(result.rooms[0].id,'10000105');
    assert.equal(result.rooms[0].name,'Royal Garden');
    assert.equal(Object.hasOwn(result.rooms[0],'coins'),false);
    assert.equal(Object.hasOwn(result.rooms[0],'owner_id'),false);
  }finally{db.close();}
});

test('room search supports names, excludes blocked owners and escapes wildcards',async()=>{
  const {db,d1}=fixture();
  try{
    assert.equal((await searchVerifiedRooms(d1,'Royal')).rooms.length,1);
    assert.equal((await searchVerifiedRooms(d1,'Private')).rooms.length,0);
    assert.equal(await searchVerifiedRooms(d1,'%'),null);
    assert.equal((await searchVerifiedRooms(d1,'Room_')).rooms.length,0);
    assert.equal(await searchVerifiedRooms(d1,'x'.repeat(61)),null);
  }finally{db.close();}
});

test('Android explicitly allowlists read-only search, retaining verified identity',()=>{
  const root=new URL('../../',import.meta.url);
  const java=readFileSync(new URL(
    'android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',root),'utf8');
  const worker=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');
  assert.match(java,/api\/v1\/rooms\/search/);
  const searchRule=java.indexOf('path.matches("^/api/v1/rooms/search');
  const denyRule=java.indexOf('if (path.contains("?")) return false;');
  assert.ok(searchRule>=0&&denyRule>=0&&searchRule<denyRule,
    'search exception must precede the general dynamic query deny rule');
  assert.match(java,/%\[0-9A-Fa-f\]\{2\}/);
  assert.match(worker,/await assertActive\(env\.DB,uid\);\s*const result=await searchVerifiedRooms/);
});

test('home search, CP Palace and Android Back keep their own dedicated pages',()=>{
  const root=new URL('../../',import.meta.url);
  const connection=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
  const css=readFileSync(new URL('app/golden-home.css',root),'utf8');
  const back=readFileSync(new URL('android-staging/back-navigation.js',root),'utf8');
  const rankCss=readFileSync(new URL('app/royal-ranking-v2.css',root),'utf8');
  assert.match(connection,/window\.sharikaOpenSearch=open/);
  assert.match(connection,/api\('GET','\/rooms\/search\?q='\+encodedQuery\)/);
  assert.match(connection,/api\('GET','\/users\/'\+query\)/);
  assert.match(connection,/cp\.id='sh-cp-home'/);
  assert.match(connection,/\['🏆 CP Ranking',\(\)=>showBondRanking\('cp','weekly'\)\]/);
  assert.doesNotMatch(connection,/id='sh-bond-rank-shortcuts'/);
  assert.match(connection,/originalTabs\.classList\.add\('sh-rank-categories'\)/);
  assert.match(rankCss,/#rt\.sh-rank-categories/);
  assert.match(css,/\.srch \{\s*display: none !important;/);
  assert.match(back,/get\('sh-global-search'\)/);
  assert.match(back,/get\('sh-cp-center'\)/);
});

test('Agency loading has a retry outcome instead of an indefinite spinner',()=>{
  const root=new URL('../../',import.meta.url);
  const agency=readFileSync(new URL('android-staging/agency-center.js',root),'utf8');
  assert.match(agency,/const LOAD_LIMIT_MS=15000/);
  assert.match(agency,/withDeadline\(api\('GET','\/agency\/me'\)\)/);
  assert.match(agency,/data-ag-retry/);
});
