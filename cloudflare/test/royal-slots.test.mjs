import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGrid,evaluateGrid} from '../src/royal-slots.mjs';
const BET=1000;
const grid=n=>Array.from({length:5},()=>Array(3).fill(n));
test('Royal Slots generates 5x3 safe symbols, never user-supplied outcomes',()=>{
 for(let k=0;k<400;k++){
  const g=generateGrid();assert.equal(g.length,5);
  assert.ok(g.every(c=>c.length===3&&c.every(n=>Number.isInteger(n)&&n>=0&&n<=11)));
  const x=evaluateGrid(g,BET,false,20000000,1000000000);
  assert.ok(Number.isSafeInteger(x.totalWin)&&x.totalWin>=0&&x.totalWin<=BET*200);
 }
});
test('Royal Slots calculates server-side line wins and caps payout',()=>{
 const x=evaluateGrid(grid(0),BET,false,0,1000000000);
 assert.equal(x.lines.length,9);
 assert.ok(x.totalWin>0&&x.totalWin<=BET*200);
 assert.deepEqual(x.grid,grid(0));
});
test('Royal Slots bonus yields free spins but no arbitrary client wallet credit',()=>{
 const g=grid(8);g[0][0]=10;g[1][0]=10;g[2][0]=10;
 const x=evaluateGrid(g,BET,false,50000000,1000000000);
 assert.equal(x.freeSpinsAwarded,8);assert.equal(x.totalWin,0);
});
test('Royal Slots jackpot respects server pool and max wager cap',()=>{
 const g=grid(8);g[0][0]=11;g[1][0]=11;g[2][0]=11;
 const a=evaluateGrid(g,BET,false,42000,1000000000);
 assert.equal(a.jackpotWin,42000);assert.equal(a.totalWin,42000);
 const b=evaluateGrid(g,BET,false,30000000,20000);
 assert.equal(b.totalWin,20000);
});
test('Royal Slots rejects invalid grids and bets',()=>{
 assert.throws(()=>evaluateGrid([[5]],BET,false,1000,1000),/invalid_grid/);
 assert.throws(()=>evaluateGrid(grid(0),0.5,false,1000,1000),/invalid_grid/);
});