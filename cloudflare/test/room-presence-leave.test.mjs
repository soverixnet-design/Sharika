import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const worker=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const coordinator=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');

function presenceCoordinator(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE app_presence (uid TEXT PRIMARY KEY,room_id TEXT,last_seen INTEGER NOT NULL)');
  db.exec('CREATE TABLE app_presence_departures ('+
    'uid TEXT NOT NULL,room_id TEXT NOT NULL,left_at INTEGER NOT NULL,PRIMARY KEY(uid,room_id))');
  const start=coordinator.indexOf('  async presenceTouch(uid, roomId) {');
  const end=coordinator.indexOf('  async presenceRoomCounts()',start);
  assert.ok(start>0&&end>start);
  const Constructor=runInNewContext('(class PresenceStub {'+
    coordinator.slice(start,end)+'})',{});
  const stub=new Constructor();
  stub.ctx={storage:{sql:{exec(sql,...values){
    const statement=db.prepare(sql);
    if(/^\s*SELECT\b/i.test(sql))return {toArray:()=>statement.all(...values)};
    statement.run(...values);
    return {toArray:()=>[]};
  }}}};
  return {db,stub};
}

test('explicit leave hides owner and member immediately and ignores late heartbeat',async()=>{
  const {db,stub}=presenceCoordinator();
  await stub.presenceJoin('owner','10000001');
  await stub.presenceJoin('guest','10000001');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_presence WHERE room_id=?')
    .get('10000001').n,2);
  await stub.presenceLeave('owner','10000001');
  await stub.presenceLeave('guest','10000001');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_presence WHERE room_id=?')
    .get('10000001').n,0);
  assert.equal(await stub.presenceTouch('owner','10000001'),false);
  assert.equal(await stub.presenceTouch('guest','10000001'),false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_presence WHERE room_id=?')
    .get('10000001').n,0);
  // Only another explicit, verified join can make the owner visible again.
  await stub.presenceJoin('owner','10000001');
  assert.equal(db.prepare('SELECT room_id FROM app_presence WHERE uid=?')
    .get('owner').room_id,'10000001');
  db.close();
});

test('old room heartbeat cannot bring back someone who switched rooms',async()=>{
  const {db,stub}=presenceCoordinator();
  await stub.presenceJoin('guest','10000001');
  await stub.presenceLeave('guest','10000001');
  await stub.presenceJoin('guest','10000002');
  assert.equal(await stub.presenceTouch('guest','10000001'),false);
  assert.equal(db.prepare('SELECT room_id FROM app_presence WHERE uid=?')
    .get('guest').room_id,'10000002');
  // A delayed exit for the previous room also cannot remove the new room.
  await stub.presenceLeave('guest','10000001');
  assert.equal(db.prepare('SELECT room_id FROM app_presence WHERE uid=?')
    .get('guest').room_id,'10000002');
  db.close();
});

test('join and leave boundaries clear seats and enforce live-only roster',()=>{
  const join=worker.slice(worker.indexOf("action === 'join' && request.method === 'POST'"),
    worker.indexOf("action === 'leave' && request.method === 'POST'"));
  const leave=worker.slice(worker.indexOf("action === 'leave' && request.method === 'POST'"),
    worker.indexOf("action === 'contributors' && request.method === 'GET'"));
  const roster=worker.slice(worker.indexOf("action === 'members' && request.method === 'GET'"),
    worker.indexOf("action === 'voice-token' && request.method === 'POST'"));
  assert.match(join,/UPDATE sharika_room_members SET seat_no=NULL/);
  assert.match(join,/\.presenceJoin\(uid,roomId\)/);
  assert.match(leave,/\.presenceLeave\(uid,roomId\)/);
  assert.match(leave,/UPDATE sharika_room_members SET seat_no=NULL/);
  assert.match(leave,/DELETE FROM sharika_room_members/);
  assert.match(roster,/visibleMembers=visibleMembers\.filter\(m=>live\.has\(m\.user_id\)\)/);
  assert.doesNotMatch(roster,/m\.user_id===room\.owner_id\|\|/);
});

test('room owner throne remains empty until explicit seat action',()=>{
  const snapshot=adapter.slice(adapter.indexOf('  async function syncFrame(room,frame) {'),
    adapter.indexOf('    const renderSignature=',adapter.indexOf('  async function syncFrame(room,frame) {')));
  assert.match(snapshot,/slots\[0\]=\{empty:1,i:0,owner_throne:true\}/);
  assert.match(snapshot,/slots\[member\.seat_no\]=\{\.\.\.ownerSeat/);
  assert.match(snapshot,/audience\.push\(\{n:user\.name,e:'👑'/);
  assert.doesNotMatch(snapshot,/slots\[0\]=\{n:owner\.name/);
  assert.match(adapter,/await api\('PUT','\/rooms\/'\+room\.id\+'\/seat',\{seat_no:seat\}\)/);
});
