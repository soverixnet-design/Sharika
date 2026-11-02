import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/voice-room.mjs',import.meta.url),'utf8');
const start=source.indexOf('  async changeAllSeatLocks(roomId,seatCount,locked) {');
const end=source.indexOf('  async dropSeatLocksAbove(seatCount) {',start);
assert.ok(start>0&&end>start,'room-wide seat RPC is required');
const Runner=new Function('return class SeatLockRunner {'+
  source.slice(start,end)+'}')();

function fixture(occupiedSeatNumbers) {
  const locked=new Set(),invites=new Set([1,2,3,4,5]);
  const runner=new Runner();
  runner.withSeatGate=work=>work();
  runner.lockedSeats=async()=>[...locked].sort((a,b)=>a-b);
  runner.ctx={storage:{sql:{exec(sql,...args){
    if(sql.startsWith('DELETE FROM room_seat_locks'))locked.clear();
    if(sql.startsWith('INSERT OR IGNORE INTO room_seat_locks'))locked.add(args[0]);
    if(sql.startsWith('DELETE FROM room_seat_invites WHERE seat_no'))invites.delete(args[0]);
  }}}};
  runner.sharikaDb={prepare(sql){
    assert.match(sql,/SELECT seat_no FROM sharika_room_members/);
    return {bind(roomId){
      assert.equal(roomId,'10000001');
      return {all:async()=>({results:occupiedSeatNumbers.map(seat_no=>({seat_no}))})};
    }};
  }};
  return {runner,locked,invites};
}

test('lock all only locks free seats and retains occupants and their invitations',async()=>{
  const {runner,locked,invites}=fixture([2,5]);
  const result=await runner.changeAllSeatLocks('10000001',5,true);
  assert.deepEqual(result,{locked_seats:[1,3,4],skipped_occupied:[2,5]});
  assert.deepEqual([...locked].sort((a,b)=>a-b),[1,3,4]);
  assert.deepEqual([...invites].sort((a,b)=>a-b),[2,5]);
  assert.deepEqual(await runner.changeAllSeatLocks('10000001',5,true),result);
});

test('unlock all clears persistent locks; invalid capacity does not modify locks',async()=>{
  const {runner,locked}=fixture([]);
  await runner.changeAllSeatLocks('10000001',5,true);
  assert.equal(locked.size,5);
  assert.deepEqual(await runner.changeAllSeatLocks('10000001',21,true),
    {error:'invalid_seat_count'});
  assert.equal(locked.size,5);
  assert.deepEqual(await runner.changeAllSeatLocks('10000001',5,false),
    {locked_seats:[],skipped_occupied:[]});
  assert.equal(locked.size,0);
});
