import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/rapid-bets.js',import.meta.url),'utf8');
const create=()=>{
 const window={};
 runInNewContext(source,{window,crypto:webcrypto,setTimeout:callback=>{queueMicrotask(callback);return 1;}});
 return window.createRoundTapQueue;
};

test('four uncertain retries reuse the same tap ID and unblock following round',async()=>{
 const maker=create();
 let activeRound=7,packets=0;
 const attempts=[];
 const enqueue=maker({
   openRound:r=>r===activeRound,
   send:async body=>{
     packets++;attempts.push(body);
     if(activeRound===7)throw Error('network_unavailable');
     return {coins:8000,round_no:body.round_no,
       receipts:body.taps.map((tap,i)=>({request_id:tap.request_id,bet_id:i+1}))};
   }
 });
 const first=await Promise.allSettled([
   enqueue(7,0,1000,10000),enqueue(7,1,1000,10000),
   enqueue(7,2,1000,10000)
 ]);
 assert.ok(first.every(x=>x.status==='rejected'));
 assert.ok(first.every(x=>/bet_status_unknown_check_wallet/.test(x.reason.message)));
 assert.equal(packets,4,'do not retry forever after a dead server');
 assert.deepEqual(attempts.map(x=>x.taps.map(t=>t.request_id).join(',')),
   Array(4).fill(attempts[0].taps.map(t=>t.request_id).join(',')),
   'all retries must preserve the same transaction IDs');
 activeRound=8;
 const newer=await enqueue(8,3,1000,10000);
 assert.equal(newer.round_no,8,'new round remains usable after old round uncertainty');
 assert.equal(newer.coins,8000);
 assert.equal(packets,5);
});

test('known server failures stop immediately without repeated wallet traffic',async()=>{
 let count=0;
 const enqueue=create()({openRound:()=>true,send:async()=>{
   count++;throw Error('insufficient_coins');
 }});
 await assert.rejects(enqueue(3,0,1000,10000),/insufficient_coins/);
 assert.equal(count,1);
});

test('one thousand rapid taps remain queueable without arbitrary per-player click cap',async()=>{
 let sent=0;const seen=new Set();
 const enqueue=create()({openRound:()=>true,send:async body=>{
   sent+=body.taps.length;
   return {coins:1000000,round_no:1,receipts:body.taps.map((tap,i)=>{
     if(seen.has(tap.request_id))throw Error('duplicate tap ID');
     seen.add(tap.request_id);
     return {request_id:tap.request_id,bet_id:sent-body.taps.length+i+1};
   })};
 }});
 const result=await Promise.all(Array.from({length:1000},(_,i)=>
   enqueue(1,i%8,100,1000000)));
 assert.equal(result.length,1000);
 assert.equal(sent,1000);
 assert.equal(seen.size,1000);
});
