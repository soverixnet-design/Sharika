import test from 'node:test';
import assert from 'node:assert/strict';
import {luckyBoxOutcome} from '../src/lucky-box.mjs';

const settings={coin_weight:40,frame_weight:25,entry_weight:15,empty_weight:20};
test('Lucky Box deterministic distribution boundaries',()=>{
  const expected=new Map([[0,'coins'],[39,'coins'],[40,'frame'],
    [64,'frame'],[65,'entry'],[79,'entry'],[80,'empty'],[99,'empty']]);
  for(const [draw,kind] of expected)
    assert.equal(luckyBoxOutcome(settings,()=>draw),kind);
});
test('Lucky Box outcomes cover exactly 100 server-side tickets',()=>{
  const counts={coins:0,frame:0,entry:0,empty:0};
  for(let ticket=0;ticket<100;ticket++)
    counts[luckyBoxOutcome(settings,()=>ticket)]++;
  assert.deepEqual(counts,{coins:40,frame:25,entry:15,empty:20});
});
test('Lucky Box rejects invalid weights and zero chance categories',()=>{
  assert.throws(()=>luckyBoxOutcome({...settings,empty_weight:21},()=>0),/weights/);
  assert.throws(()=>luckyBoxOutcome({...settings,frame_weight:-1,empty_weight:46},()=>0),/weights/);
  assert.equal(luckyBoxOutcome({coin_weight:100,frame_weight:0,entry_weight:0,empty_weight:0},()=>99),'coins');
});
