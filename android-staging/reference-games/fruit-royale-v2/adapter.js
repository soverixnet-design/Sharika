/* Replace window.SharikaAPI BEFORE game.js loads when mode === 'live'.
   Read API_CONTRACT.md. No secrets belong in browser code. */
(() => {
'use strict';
const fruits = [
 {id:'lemon',name:'Lemon',emoji:'🍋',multiplier:5},
 {id:'strawberry',name:'Strawberry',emoji:'🍓',multiplier:5},
 {id:'kiwi',name:'Kiwi',emoji:'🥝',multiplier:5},
 {id:'cherry',name:'Cherry',emoji:'🍒',multiplier:40},
 {id:'plum',name:'Plum',emoji:'🫐',multiplier:40},
 {id:'watermelon',name:'Melon',emoji:'🍉',multiplier:20},
 {id:'mango',name:'Mango',emoji:'🥭',multiplier:10},
 {id:'apple',name:'Apple',emoji:'🍎',multiplier:10}
];
if(window.SHARIKA_CONFIG.mode !== 'demo') return;
const randomInt = max => { const a=new Uint32Array(1); let n; const limit=Math.floor(4294967296/max)*max; do {crypto.getRandomValues(a);n=a[0];}while(n>=limit); return n%max; };
let balance=50000000, pool=21817399, seq=1, history=[], records=new Map(), listeners=new Set(), closed=false;
let round, timer;
const snapshot=()=>({serverNow:Date.now(),balance,jackpot:pool,round:{...round},bets:[...records.values()].filter(b=>b.roundId===round.id),fruits:fruits.map(f=>({...f})),user:{id:'local-practice',name:'You · practice'},limits:{minBet:1,maxBet:1000000000000}});
function emit(event){listeners.forEach(fn=>fn(event));}
function begin(){round={id:'DEMO-'+seq++,status:'open',closesAt:Date.now()+window.SHARIKA_CONFIG.demoRoundMs};emit({type:'state',state:snapshot()});timer=setTimeout(settle,window.SHARIKA_CONFIG.demoRoundMs);}
function settle(){
 round.status='settling';emit({type:'state',state:snapshot()});
 const roll=randomInt(100),bonus=roll<5?'fruit+1':roll<8?'fruit+2':roll<12?'x2':roll<14?'x3':roll<15?'jackpot':'none';
 const count=bonus==='fruit+1'?2:bonus==='fruit+2'?3:1;
 const fruitIds=Array.from({length:count},()=>fruits[randomInt(fruits.length)].id);
 const bets=[...records.values()].filter(b=>b.roundId===round.id);
 let payout=0;for(const id of fruitIds){for(const b of bets){if(b.fruitId===id)payout+=b.amount*fruits.find(f=>f.id===id).multiplier;}}
 const multiplier=bonus==='x2'?2:bonus==='x3'?3:1;payout*=multiplier;
 // Deliberately unrelated to any approved live jackpot schedule.
 const jackpotAward=bonus==='jackpot'&&bets.length?10000:0;payout+=jackpotAward;
 balance+=payout;
 const totalBet=bets.reduce((n,b)=>n+b.amount,0);
 const result={roundId:round.id,fruitIds,bonus,multiplier,jackpotAward,totalBet,payout,balance,jackpot:pool,settledAt:Date.now()};
 if(bets.length)history.unshift({...result,profitLoss:payout-totalBet});history=history.slice(0,100);
 emit({type:'result',result});round.status='settled';
 timer=setTimeout(begin,5000);
}
window.SharikaAPI={
 async connect(){if(!round)begin();return snapshot();},
 async placeBet({requestId,roundId,fruitId,amount}){
  if(records.has(requestId))return {...records.get(requestId),balance};
  if(!Number.isSafeInteger(amount)||amount<1||amount>1e12)throw new Error('Invalid bet amount.');
  if(round.id!==roundId||round.status!=='open'||Date.now()>=round.closesAt)throw new Error('Betting has closed.');
  if(!fruits.some(f=>f.id===fruitId))throw new Error('Unknown fruit.');
  if(amount>balance)throw new Error('Insufficient practice credits.');
  balance-=amount;
  const bet={id:requestId,requestId,roundId,fruitId,amount,acceptedAt:Date.now()};records.set(requestId,bet);
  return {...bet,balance};
 },
 async getHistory(){return history.map(x=>({...x}));},
 async getRankings(){return [];}, // Never invent opponents or winners.
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
 async disconnect(){closed=true;clearTimeout(timer);listeners.clear();}
};
})();
