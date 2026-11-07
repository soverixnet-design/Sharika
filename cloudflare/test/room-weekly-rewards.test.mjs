import test from 'node:test';
import assert from 'node:assert/strict';
import {roomWeekStartUTC} from '../src/room-weekly-rewards.mjs';

test('UTC room week starts on Monday even when opened on Sunday',()=>{
  assert.equal(roomWeekStartUTC(Date.parse('2026-11-01T23:59:59Z')),'2026-10-26');
  assert.equal(roomWeekStartUTC(Date.parse('2026-11-02T00:00:00Z')),'2026-11-02');
  assert.equal(roomWeekStartUTC(Date.parse('2026-11-04T20:00:00Z')),'2026-11-02');
  assert.equal(roomWeekStartUTC(Date.parse('2027-01-01T08:00:00Z')),'2026-12-28');
});
test('room week calculation rejects invalid timestamps',()=>{
  assert.throws(()=>roomWeekStartUTC(Infinity),/invalid_reward_time/);
});
