/**
 * Super Ace Deluxe v1 — Section 12 wins over earlier numeric values in the
 * owner-supplied server integration spec (2026-11-18).
 * This module is server-owned. A web client must never select its own win.
 */
export const SUPERACE_BETS=Object.freeze([100,200,500,1000,2000,5000,10000,50000]);
export const SUPERACE_MULT=Object.freeze([[1,2,3,5,10],[2,4,6,10,20]]);
export const SUPERACE_PAY=Object.freeze([
  [2.5,1.5,.5],[2,1.2,.4],[1.5,.9,.3],[1,.6,.2],
  [.5,.3,.1],[.5,.3,.1],[.25,.15,.05],[.25,.15,.05]
]);
export const SUPERACE_SPEC=Object.freeze({
  version:'superace-v1-section-12',
  scatterBps:115,goldenPercent:5,starPercent:20,
  buyBonusMultiplier:50,freeTriggerSpins:10,freeRetriggerSpins:5,
  hardCapMultiplier:10000,betDivisor:50,
  bigWin:20,megaWin:50,superWin:120
});
const WEIGHTS=[6,7,8,9,10,10,11,11],WEIGHT_TOTAL=WEIGHTS.reduce((a,b)=>a+b,0);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
/** Rejection-sampling from browser/Workers cryptographic entropy. */
export function superAceSecureInt(max){
  if(!safe(max)||max<1||max>4294967295)throw Error('invalid_random_range');
  const buf=new Uint32Array(1),range=4294967296,limit=range-range%max;
  do{crypto.getRandomValues(buf)}while(buf[0]>=limit);
  return buf[0]%max;
}
export const superAceCopy=grid=>grid.map(col=>col.map(cell=>({s:cell.s,g:!!cell.g})));
const draw=(reel,rng)=>{
  if(rng(10000)<SUPERACE_SPEC.scatterBps)return{s:8,g:false};
  let left=rng(WEIGHT_TOTAL),symbol=7;
  for(let i=0;i<WEIGHTS.length;i++){left-=WEIGHTS[i];if(left<0){symbol=i;break}}
  return{s:symbol,g:reel>=1&&reel<=3&&rng(100)<SUPERACE_SPEC.goldenPercent};
};
export const newSuperAceGrid=(rng=superAceSecureInt)=>
 Array.from({length:5},(_,reel)=>Array.from({length:4},()=>draw(reel,rng)));
export function evaluateSuperAce(grid,bet,free=false,combo=0){
  if(!Array.isArray(grid)||grid.length!==5||grid.some(col=>!Array.isArray(col)||col.length!==4))
    throw Error('invalid_grid');
  if(!safe(bet)||bet<1)throw Error('invalid_bet');
  const marked=new Set();let baseWin=0;
  for(let symbol=0;symbol<8;symbol++){
    const matches=[];
    for(let reel=0;reel<5;reel++){
      const selected=[];
      for(let row=0;row<4;row++)
        if(grid[reel][row].s===symbol||grid[reel][row].s>=9)selected.push(row);
      if(!selected.length)break;
      matches.push(selected);
    }
    if(matches.length<3)continue;
    const ways=matches.reduce((n,rows)=>n*rows.length,1);
    baseWin+=SUPERACE_PAY[symbol][5-matches.length]*ways*(bet/SUPERACE_SPEC.betDivisor);
    matches.forEach((rows,reel)=>rows.forEach(row=>marked.add(reel*4+row)));
  }
  const multiplier=SUPERACE_MULT[free?1:0][Math.min(combo,4)];
  const stepWin=Math.round(baseWin*multiplier);
  return {baseWin,stepWin,multiplier,marks:[...marked].sort((a,b)=>a-b),
    markCoords:[...marked].sort((a,b)=>a-b).map(i=>[Math.floor(i/4),i%4])};
}
function advanceSuperAceGrid(grid,marks,combo,rng){
  const toJoker=[],removed=[],jokerCopies=[],starCards=[];
  const original=superAceCopy(grid),newGrid=superAceCopy(grid);
  for(const i of marks){
    const reel=Math.floor(i/4),row=i%4,cell=newGrid[reel][row];
    if(cell.g){
      const symbol=rng(2)?10:9;
      newGrid[reel][row]={s:symbol,g:false};
      toJoker.push({reel,row,s:symbol});
    }else{newGrid[reel][row]=null;removed.push([reel,row]);}
  }
  const nextGrid=[];
  for(let reel=0;reel<5;reel++){
    const remaining=[];
    for(let row=0;row<4;row++)if(newGrid[reel][row])
      remaining.push({...newGrid[reel][row],fall:0,flip:original[reel][row].g});
    const needed=4-remaining.length;
    const next=Array.from({length:needed},()=>({...draw(reel,rng),fall:0,flip:false}));
    remaining.forEach((cell,index)=>{
      cell.fall=needed+index-grid[reel].findIndex((_,i)=>i>=0);
      if(cell.fall<0)cell.fall=0;
    });
    nextGrid.push(next.concat(remaining));
  }
  for(const joker of toJoker.filter(x=>x.s===9)){
    const copies=1+rng(4);
    for(let i=0;i<copies;i++){
      const reel=1+rng(4),row=rng(4);
      const cell=nextGrid[reel][row];
      if(cell.s<8){
        nextGrid[reel][row]={s:9,g:false,fall:cell.fall||0,flip:true};
        jokerCopies.push([reel,row]);
      }
    }
  }
  if(combo>=1&&(combo>=4||rng(100)<SUPERACE_SPEC.starPercent)){
    for(let tried=0;tried<12&&starCards.length<3;tried++){
      const reel=1+rng(3),row=rng(4),cell=nextGrid[reel][row];
      if(cell.s<8&&!cell.g){cell.g=true;cell.flip=true;starCards.push([reel,row]);}
    }
  }
  return {nextGrid,toJoker,removed,jokerCopies,starCards};
}
export function superAceTier(win,bet){
  if(win>=bet*SUPERACE_SPEC.superWin)return{tier:'SUPER',multiple:win/bet};
  if(win>=bet*SUPERACE_SPEC.megaWin)return{tier:'MEGA',multiple:win/bet};
  if(win>=bet*SUPERACE_SPEC.bigWin)return{tier:'BIG',multiple:win/bet};
  return null;
}
export function simulateRoyalAce(bet,free=false,maxWin=500000000,rng=superAceSecureInt){
  if(!safe(bet)||bet<1||!safe(maxWin)||maxWin<1||typeof rng!=='function')
    throw Error('invalid_royal_round');
  const cap=Math.min(bet*SUPERACE_SPEC.hardCapMultiplier,maxWin);
  let grid=newSuperAceGrid(rng),initialGrid=superAceCopy(grid);
  const steps=[];let total=0,combos=0;
  // Cap is a hard, server-enforced payout guard. Cascade continues until no
  // marks, the payout cap, or a conservative bounded-resource safeguard.
  for(let combo=0;combo<128;combo++){
    const result=evaluateSuperAce(grid,bet,free,combo);
    const remaining=cap-total;
    const stepWin=Math.min(remaining,result.stepWin);
    const step={grid:superAceCopy(grid),marks:result.marks,
      markCoords:result.markCoords,baseWin:result.baseWin,
      multiplier:result.multiplier,stepWin,comboIndex:combo,
      combo:Math.min(combo,4),payout:stepWin,
      toJoker:[],removed:[],nextGrid:[],jokerCopies:[],starCards:[]};
    total+=stepWin;
    if(!result.marks.length||total>=cap){
      step.nextGrid=grid.map(col=>col.map(cell=>({...cell,fall:0,flip:false})));
      steps.push(step);break;
    }
    const advanced=advanceSuperAceGrid(grid,result.marks,combo,rng);
    Object.assign(step,advanced);
    steps.push(step);
    grid=superAceCopy(advanced.nextGrid);
    combos++;
  }
  const scatterCount=grid.reduce((count,col)=>count+col.filter(x=>x.s===8).length,0);
  const bonusSpins=scatterCount>=3
    ?free?SUPERACE_SPEC.freeRetriggerSpins:SUPERACE_SPEC.freeTriggerSpins:0;
  return {initialGrid,steps,finalGrid:superAceCopy(grid),scatterCount,
    win:total,totalWin:total,bonusSpins,bigWin:superAceTier(total,bet),combos,
    specVersion:SUPERACE_SPEC.version};
}
/** Deterministic simulator for QA only. Production always uses crypto RNG. */
export function superAceTestRng(seed=0x12345678){
  let state=seed>>>0||1;
  return max=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)%max;
  };
}
