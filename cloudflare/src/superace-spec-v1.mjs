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
const draw=(reel,rng,config=SUPERACE_SPEC)=>{
  if(rng(10000)<config.scatterBps)return{s:8,g:false};
  const weights=config.symbolWeights||WEIGHTS;
  const total=config.weightsTotal||WEIGHT_TOTAL;
  let left=rng(total),symbol=7;
  for(let i=0;i<weights.length;i++){left-=weights[i];if(left<0){symbol=i;break}}
  return{s:symbol,g:reel>=1&&reel<=3&&rng(100)<config.goldenPercent};
};
export const newSuperAceGrid=(rng=superAceSecureInt,config=SUPERACE_SPEC)=>
 Array.from({length:5},(_,reel)=>Array.from({length:4},()=>draw(reel,rng,config)));
export function evaluateSuperAce(grid,bet,free=false,combo=0,config=SUPERACE_SPEC){
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
    baseWin+=SUPERACE_PAY[symbol][5-matches.length]*ways*(bet/config.betDivisor);
    matches.forEach((rows,reel)=>rows.forEach(row=>marked.add(reel*4+row)));
  }
  const multiplier=SUPERACE_MULT[free?1:0][Math.min(combo,4)];
  const stepWin=Math.round(baseWin*multiplier);
  return {baseWin,stepWin,multiplier,marks:[...marked].sort((a,b)=>a-b),
    markCoords:[...marked].sort((a,b)=>a-b).map(i=>[Math.floor(i/4),i%4])};
}
function advanceSuperAceGrid(grid,marks,combo,rng,config=SUPERACE_SPEC){
  const toJoker=[],removed=[],jokerCopies=[],starCards=[];
  const next=superAceCopy(grid);
  const anchors=Array.from({length:5},()=>new Set());
  for(const index of marks){
    const reel=Math.floor(index/4),row=index%4,cell=next[reel][row];
    if(cell.g){
      const symbol=rng(2)?10:9;
      next[reel][row]={s:symbol,g:false};
      anchors[reel].add(row);
      toJoker.push({reel,row,s:symbol});
    }else{
      next[reel][row]=null;removed.push([reel,row]);
    }
  }
  const nextGrid=[];
  for(let reel=0;reel<5;reel++){
    const col=new Array(4);
    // Golden->Joker cards are pinned. Apply gravity independently to each
    // contiguous segment between pinned rows so a Joker stays in place.
    const boundaries=[...anchors[reel]].sort((a,b)=>a-b).concat([4]);
    let first=0;
    for(const boundary of boundaries){
      const remaining=[];
      for(let row=first;row<boundary;row++)if(next[reel][row])
        remaining.push({row,cell:next[reel][row]});
      const count=boundary-first,holes=count-remaining.length;
      for(let j=0;j<holes;j++)
        col[first+j]={...draw(reel,rng,config),fall:0,flip:false};
      for(let j=0;j<remaining.length;j++){
        const item=remaining[j],target=first+holes+j;
        col[target]={...item.cell,fall:target-item.row,flip:false};
      }
      if(boundary<4)col[boundary]={...next[reel][boundary],fall:0,flip:true};
      first=boundary+1;
    }
    nextGrid.push(col);
  }
  for(const joker of toJoker.filter(x=>x.s===9)){
    const copies=1+rng(4);
    for(let i=0;i<copies;i++){
      const reel=1+rng(4),row=rng(4),cell=nextGrid[reel][row];
      if(cell.s<8){
        nextGrid[reel][row]={s:9,g:false,fall:cell.fall||0,flip:true};
        jokerCopies.push([reel,row]);
      }
    }
  }
  if(combo>=1&&(combo>=4||rng(100)<config.starPercent)){
    for(let tried=0;tried<12&&starCards.length<3;tried++){
      const reel=1+rng(3),row=rng(4),cell=nextGrid[reel][row];
      if(cell.s<8&&!cell.g){cell.g=true;cell.flip=true;starCards.push([reel,row]);}
    }
  }
  return {nextGrid,toJoker,removed,jokerCopies,starCards};
}

/**
 * Runtime-tunable staging parameters, stored in the D1 spec-config table.
 * Reject malformed admin values: every draw must use bounded probabilities.
 * Changing these values must be preceded by a new independent RTP audit.
 */
export function parseSuperAceConfig(row){
  if(!row)return SUPERACE_SPEC;
  let weights;
  try{weights=JSON.parse(row.weights_json)}catch{throw Error('invalid_superace_weights_json')}
  if(!Array.isArray(weights)||weights.length!==8||
     weights.some(x=>!Number.isSafeInteger(x)||x<1||x>100))
    throw Error('invalid_superace_weights');
  const parsed={
    scatterBps:Number(row.scatter_bps),
    goldenPercent:Number(row.golden_percent),
    starPercent:Number(row.star_percent),
    betDivisor:Number(row.bet_divisor)
  };
  if(!Number.isSafeInteger(parsed.scatterBps)||parsed.scatterBps<1||parsed.scatterBps>1000 ||
     !Number.isSafeInteger(parsed.goldenPercent)||parsed.goldenPercent<0||parsed.goldenPercent>50 ||
     !Number.isSafeInteger(parsed.starPercent)||parsed.starPercent<0||parsed.starPercent>100 ||
     !Number.isSafeInteger(parsed.betDivisor)||parsed.betDivisor<1||parsed.betDivisor>1000)
    throw Error('invalid_superace_probabilities');
  return {...SUPERACE_SPEC,...parsed,symbolWeights:weights,
    weightsTotal:weights.reduce((sum,x)=>sum+x,0)};
}

export function superAceTier(win,bet){
  if(win>=bet*SUPERACE_SPEC.superWin)return{tier:'SUPER',multiple:win/bet};
  if(win>=bet*SUPERACE_SPEC.megaWin)return{tier:'MEGA',multiple:win/bet};
  if(win>=bet*SUPERACE_SPEC.bigWin)return{tier:'BIG',multiple:win/bet};
  return null;
}
export function simulateRoyalAce(bet,free=false,maxWin=500000000,rng=superAceSecureInt,config=SUPERACE_SPEC){
  if(!safe(bet)||bet<1||!safe(maxWin)||maxWin<1||typeof rng!=='function')
    throw Error('invalid_royal_round');
  const cap=Math.min(bet*SUPERACE_SPEC.hardCapMultiplier,maxWin);
  let grid=newSuperAceGrid(rng,config),initialGrid=superAceCopy(grid);
  const steps=[];let total=0,combos=0;
  // Cap is a hard, server-enforced payout guard. Cascade continues until no
  // marks, the payout cap, or a conservative bounded-resource safeguard.
  for(let combo=0;combo<128;combo++){
    const result=evaluateSuperAce(grid,bet,free,combo,config);
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
    const advanced=advanceSuperAceGrid(grid,result.marks,combo,rng,config);
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
