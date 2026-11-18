import {webcrypto} from 'node:crypto';
import {simulateRoyalAce} from '../src/royal-ace.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
for(const free of [false,true]){
 let total=0,paid=0,nonzero=0,max=0,overCap=0;
 const n=7000,bet=1000;
 for(let i=0;i<n;i++){
   const r=simulateRoyalAce(bet,free,100000000);
   total+=r.win;if(r.win>0)nonzero++;
   if(r.win>max)max=r.win;
   if(r.win>bet*10)overCap++;
 }
 console.log(JSON.stringify({mode:free?'free':'paid',spins:n,bet,credit_ratio:Number((total/(n*bet)).toFixed(4)),hit_rate:Number((nonzero/n).toFixed(4)),max_win:max,overCap}));
 if(overCap)throw Error('Payout limit violated');
 if(!free&&total/(n*bet)>1.0)throw Error('Paid-spin simulated credit return exceeds wager; review game payout economics');
}

let allCredits=0,freeRounds=0,paidRounds=3000,bonusTriggered=0;
for(let i=0;i<paidRounds;i++){
  const regular=simulateRoyalAce(1000,false,100000000);
  allCredits+=regular.win;
  if(regular.bonusSpins)bonusTriggered++;
  let queue=regular.bonusSpins;
  while(queue>0&&freeRounds<30000){
    queue--;freeRounds++;
    const bonus=simulateRoyalAce(1000,true,100000000);
    allCredits+=bonus.win;queue+=bonus.bonusSpins;
  }
}
const combined=allCredits/(paidRounds*1000);
console.log(JSON.stringify({mode:'paid-with-triggered-free-spins',paidRounds,freeRounds,bonusTriggered,credit_ratio:Number(combined.toFixed(4))}));
if(freeRounds===30000)throw Error('Bonus-spin chain too large');
if(combined>0.95)throw Error('Paid plus free-spin expected return is too high; tune payout table before rollout');
