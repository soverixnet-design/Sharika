import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Verify source odds, not casino-style marketing claims. No wallets are touched.
function source(name){return readFileSync(new URL('../src/'+name+'.mjs',import.meta.url),'utf8');}
function array(src,name){
  const re=new RegExp('const\\s+'+name+'\\s*=\\s*(?:Object\\.freeze\\()?\\s*(\\[[0-9, ]+\\])');
  const m=src.match(re);
  assert.ok(m,'Could not read '+name+' from game engine');
  return JSON.parse(m[1]);
}
function check(name,values,low=.85,high=1.01){
  for(const [i,value] of values.entries()){
    assert.ok(value>=low&&value<=high,
      name+': option '+i+' has expected virtual-coin return '+(value*100).toFixed(2)+'%, requires explicit review');
  }
  console.log(JSON.stringify({game:name,return_pct:values.map(x=>+(x*100).toFixed(2))}));
}
function wheel(src,bonus=false){
  const weights=array(src,bonus?'DEFAULT_WEIGHTS':'WEIGHTS');
  const mult=array(src,bonus?'DEFAULT_MULT':'MULT');
  const sum=weights.reduce((a,b)=>a+b,0);
  assert.ok(sum>0);
  assert.equal(weights.length,10);assert.ok(mult.length>=8);
  return mult.slice(0,8).map((x,i)=>{
    const bonusWeight=i<4?weights[9]:weights[8];
    const specialMult=bonus?mult[i<4?9:8]:x;
    return (weights[i]*x+bonusWeight*specialMult)/sum;
  });
}
test('Greedy Wheel, Classic and Gaddy publish stable expected returns',()=>{
  check('greedy-wheel',wheel(source('greedy-wheel')));
  check('greedy-classic',wheel(source('greedy-classic')));
  check('sovera-gaddy',wheel(source('sovera-gaddy'),true));
});
test('Food Deluxe outcome weights and multipliers imply fair per-food expectations',()=>{
  const src=source('food-wheel-deluxe');
  const mult=array(src,'MULT');
  assert.equal(mult.length,8);
  const weights=mult.map(m=>Math.round(36000/m));
  const sum=weights.reduce((a,b)=>a+b,0);
  const returns=mult.map((m,i)=>m*weights[i]/sum);
  check('food-deluxe',returns);
  assert.ok(Math.max(...returns)-Math.min(...returns)<.005);
});
test('Greedy Classic spinning phase stays visible while result remains readable',()=>{
  const src=source('greedy-classic');
  const m=src.match(/ROUND_MS=(\d+),BET_MS=(\d+),SPIN_MS=(\d+)/);
  assert.ok(m,'Missing phase timing configuration');
  const [round,bet,spin]=m.slice(1).map(Number);
  assert.ok(spin>=2500&&spin<=6000,'Spinning must be visible');
  assert.ok(round-bet-spin>=2500,'Results must remain visible');
});
test('Play-virtual build is isolated from authenticated staging betting APIs',()=>{
  const src=readFileSync(new URL('../../android-staging/app/src/main/java/com/soverixnet/sharika/SharikaActivity.java',import.meta.url),'utf8');
  const worker=source('index');
  assert.match(src,/isIsolatedPlayVirtualBuild/);
  assert.match(src,/royal-ace/);
  assert.match(worker,/playVirtualOnly\(env\)/);
  assert.match(worker,/gameAcceptsBets\(env\.DB,'royal-ace'\)/);
});
