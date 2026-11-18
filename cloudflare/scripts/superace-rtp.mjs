/**
 * Deterministic, payout-only Monte Carlo for Super Ace Section 12.
 * No Firebase, no D1 or real coins. Live spins use crypto.getRandomValues;
 * this reproducible QA run uses an xorshift PRNG solely for benchmarking.
 *
 * node cloudflare/scripts/superace-rtp.mjs 10000000 100 123456
 */
import {simulateRoyalAce,superAceTestRng,superAceSecureInt,SUPERACE_SPEC} from '../src/superace-spec-v1.mjs';
const count=Number(process.argv[2]||100000);
const bet=Number(process.argv[3]||100),seed=Number(process.argv[4]||123456);
if(!Number.isSafeInteger(count)||count<1||count>10000000||
   ![100,200,500,1000,2000,5000,10000,50000].includes(bet)||
   !Number.isSafeInteger(seed))throw Error('invalid_simulation_arguments');
const useCrypto=process.argv[5]==='crypto';
const rng=useCrypto?superAceSecureInt:superAceTestRng(seed);
let paidHit=0,freeTriggered=0,freeGames=0,freeHits=0;
let returnPaid=0,returnFree=0,maximumRound=0,steps=0,scatter3=0;
const t=Date.now();
for(let i=0;i<count;i++){
 const paid=simulateRoyalAce(bet,false,500000000,rng);
 returnPaid+=paid.win;
 if(paid.win>0)paidHit++;
 if(paid.bonusSpins>0){freeTriggered++;scatter3++}
 maximumRound=Math.max(maximumRound,paid.win);
 steps+=paid.steps.length;
 let remaining=paid.bonusSpins;
 while(remaining>0){
  if(remaining>1000)throw Error('bonus_chain_unbounded');
  freeGames++;remaining--;
  const free=simulateRoyalAce(bet,true,500000000,rng);
  returnFree+=free.win;
  if(free.win>0)freeHits++;
  maximumRound=Math.max(maximumRound,free.win);
  steps+=free.steps.length;
  remaining+=free.bonusSpins;
 }
 if((i+1)%1000000===0)console.log('PROGRESS '+(i+1)+'/'+count+' elapsed_ms='+(Date.now()-t));
}
const totalCost=count*bet;
const output={
 source:'Super Ace Deluxe Server Integration Spec v1 — Section 12',
 simulation:useCrypto?'cryptographic cross-check':'deterministic QA PRNG, production uses cryptographic RNG',
 bet,seed,paidSpins:count,freeSpins:freeGames,
 totalBet:totalCost,paidWin:returnPaid,freeWin:returnFree,
 totalWin:returnPaid+returnFree,rtpPercent:+(100*(returnPaid+returnFree)/totalCost).toFixed(4),
 paidHitRatePercent:+(paidHit*100/count).toFixed(4),
 freeTriggerRatePercent:+(freeTriggered*100/count).toFixed(4),
 freeSpinContributionPercent:+(returnFree*100/(returnPaid+returnFree||1)).toFixed(4),
 observedMaxRound:maximumRound,averageCascadeSteps:+(steps/(count+freeGames)).toFixed(4),
 elapsedMs:Date.now()-t,config:SUPERACE_SPEC
};
console.log('SUPERACE_RTP_REPORT '+JSON.stringify(output));
if(!Number.isFinite(output.rtpPercent)||maximumRound>bet*SUPERACE_SPEC.hardCapMultiplier)
 throw Error('RTP invalid or hard payout cap broken');
