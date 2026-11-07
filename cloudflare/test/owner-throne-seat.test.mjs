import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const root=new URL('../../',import.meta.url);
const worker=readFileSync(new URL('cloudflare/src/index.mjs',root),'utf8');
const coordinator=readFileSync(new URL('cloudflare/src/voice-room.mjs',root),'utf8');
const adapter=readFileSync(new URL('android-staging/staging-connection.js',root),'utf8');
const migration=readFileSync(new URL('cloudflare/migrations/0067_owner_throne_seat.sql',root),'utf8');

function seatFixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sharika_room_members (room_id TEXT,user_id TEXT,'+
    'seat_no INTEGER CHECK(seat_no BETWEEN 1 AND 20),PRIMARY KEY(room_id,user_id))');
  db.exec('CREATE UNIQUE INDEX sharika_one_user_per_seat '+
    'ON sharika_room_members(room_id,seat_no) WHERE seat_no IS NOT NULL');
  db.exec(migration);
  db.prepare('INSERT INTO sharika_room_members (room_id,user_id) VALUES (?,?)')
    .run('10000001','owner');
  db.prepare('INSERT INTO sharika_room_members (room_id,user_id) VALUES (?,?)')
    .run('10000001','guest');
  const start=coordinator.indexOf('  async changeMemberSeat(roomId,uid,seat) {');
  const end=coordinator.indexOf('  async changeSeatLock(roomId,seat,locked)',start);
  assert.ok(start>=0&&end>start);
  const Stub=runInNewContext('(class SeatStub {'+coordinator.slice(start,end)+'})');
  const stub=new Stub();
  stub.seatTasks=Promise.resolve();
  stub.withSeatGate=work=>work();
  stub.ctx={storage:{sql:{exec(sql,...params){
    if(/^\s*SELECT/i.test(sql))return {toArray:()=>db.prepare(sql).all(...params)};
    // Invitation cleanup is intentional even when none are pending.
    if(/^DELETE FROM room_seat_invites/i.test(sql))return {toArray:()=>[]};
    db.prepare(sql).run(...params);
    return {toArray:()=>[]};
  }}}};
  stub.sharikaDb={
    prepare(sql){
      return {
        bind(...params){
          return {
            first:async()=>db.prepare(sql).get(...params),
            run:async()=>({meta:{changes:db.prepare(sql).run(...params).changes}})
          };
        }
      };
    }
  };
  // Owner throne 0 is intentionally never a lockable numbered mic seat.
  db.exec('CREATE TABLE room_seat_locks (seat_no INTEGER PRIMARY KEY)');
  return {db,stub};
}

test('existing numbered-seat constraints survive an additive owner-throne migration',()=>{
  const {db}=seatFixture();
  assert.throws(()=>db.prepare('UPDATE sharika_room_members SET seat_no=0 WHERE user_id=?')
    .run('owner'),/CHECK constraint/i);
  db.close();
});

test('owner explicitly claims throne 0, moves to regular seat and releases both',async()=>{
  const {db,stub}=seatFixture();
  const taken=await stub.changeMemberSeat('10000001','owner',0);
  assert.equal(taken.member.seat_no,0);
  assert.deepEqual({...db.prepare('SELECT seat_no,owner_throne_active FROM sharika_room_members '+
    'WHERE user_id=?').get('owner')},{seat_no:null,owner_throne_active:1});
  const moved=await stub.changeMemberSeat('10000001','owner',2);
  assert.equal(moved.member.seat_no,2);
  assert.deepEqual({...db.prepare('SELECT seat_no,owner_throne_active FROM sharika_room_members '+
    'WHERE user_id=?').get('owner')},{seat_no:2,owner_throne_active:0});
  const released=await stub.changeMemberSeat('10000001','owner',null);
  assert.equal(released.member.seat_no,null);
  assert.equal(db.prepare('SELECT owner_throne_active FROM sharika_room_members '+
    'WHERE user_id=?').get('owner').owner_throne_active,0);
  db.close();
});

test('numbered guest seats still enforce an occupied seat',async()=>{
  const {db,stub}=seatFixture();
  await stub.changeMemberSeat('10000001','guest',1);
  assert.equal((await stub.changeMemberSeat('10000001','owner',1)).error,'seat_occupied');
  db.close();
});

test('throne action is owner-only and join/leave reset the claimed throne',()=>{
  assert.match(worker,/if\(seat===0&&room\.owner_id!==uid\)return fail\('room_owner_only',403,cors\)/);
  assert.match(worker,/UPDATE sharika_room_members SET seat_no=NULL,owner_throne_active=0 WHERE room_id=\? AND user_id=\?/);
  assert.match(worker,/seat_no:x\.user_id===room\.owner_id&&x\.owner_throne_active\?0:x\.seat_no/);
  assert.match(adapter,/\[\['take','Sit on throne','take'\]\]/);
  assert.match(adapter,/seat===0&&!owner/);
  assert.match(adapter,/frame\.toast\(seat===0\?'Owner throne selected'/);
  assert.doesNotMatch(adapter,/const options=index===0\?\[\]/);
});
