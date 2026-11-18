import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGreedyClassicRequest} from '../src/greedy-classic.mjs';

const ROUND_MS=38000;
function fixture(){
 const now=1770000000000; // deterministic, no network or real coins
 const clock=Math.floor(now/ROUND_MS)*ROUND_MS+1000;
 const roundNo=Math.floor(clock/ROUND_MS);
 let balance=300000,round=null,seq=0;
 const bets=[];
 function statement(sql,args=[]){
  const q={bind(...newArgs){return statement(sql,newArgs);},
    async first(){
     if(sql.includes('FROM sharika_users'))return {coins:balance,minor:0,status:'active',name:'QA',pic:'',public_no:10000011};
     if(sql.includes('FROM sharika_greedy_classic_rounds WHERE id='))return round;
     if(sql.includes('FROM sharika_greedy_classic_rounds WHERE round_no='))return round;
     if(sql.includes('COUNT(*) AS n'))return {n:bets.filter(b=>b.request_id.startsWith(args[2]||'')).length};
     throw Error('unsupported first query '+sql);
    },async all(){
     if(sql.includes('SELECT request_id,item_id,amount FROM sharika_greedy_classic_bets')){
      return {results:bets.filter(b=>b.user_uid===args[0]&&b.request_id.startsWith(args[2]))
       .map(b=>({request_id:b.request_id,item_id:b.item_id,amount:b.amount}))};
     }
     if(sql.includes('SELECT item_id,user_uid,amount,payout,status FROM sharika_greedy_classic_bets')){
      return {results:bets.map(b=>({...b,payout:0,status:'accepted'}))};
     }
     throw Error('unsupported all query '+sql);
    },async run(){
     if(sql.includes('INSERT OR IGNORE INTO sharika_greedy_classic_rounds')){
      round={id:args[0],round_no:args[1]};return {success:true};
     }
     throw Error('unsupported run '+sql);
    }
   };return q;
 }
 const db={
  prepare(sql){return statement(sql);},
  async batch(commands){
   const list=commands.map(c=>c._values);
   const charge=list.reduce((n,x)=>n+x[4],0);
   if(balance<charge)throw Error('insufficient');
   if(list.some(x=>bets.some(y=>y.request_id===x[5])))throw Error('duplicate');
   for(const values of list){
    const [round_id,round_no,user_uid,item_id,amount,request_id]=values;
    bets.push({id:++seq,round_id,round_no,user_uid,item_id,amount,request_id});
   }
   balance-=charge;
   return commands.map(()=>({success:true}));
  }
 };
 const originalPrepare=db.prepare;
 db.prepare=function(sql){const bound=originalPrepare(sql);const originalBind=bound.bind;
  bound.bind=(...values)=>{const next=originalBind(...values);
    Object.defineProperty(next,'_values',{value:values});
    return next;};
  return bound;};
 const send=async(body)=>{
  const request=new Request('https://example.invalid/api/v1/original-games/greedy-classic/bet-batch',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return handleGreedyClassicRequest({request,db,uid:'qa_uid',game:'greedy-classic',action:'bet-batch',
   reply:(data,status)=>({data,status}),fail:(error,status)=>({error,status}),cors:{}});
 };
 return {send,bets,roundNo,clock,readBalance:()=>balance};
}
test('one hundred taps yield one hundred immutable D1-like bet rows and exact debit',async()=>{
 const f=fixture(),old=Date.now;
 Date.now=()=>f.clock;
 try{
  const body={round:f.roundNo,request_id:'greedy_batch_20261119_qa',entries:[{itemId:'chicken',amount:100,count:100}]};
  const result=await f.send(body);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.data.accepted_clicks,100);
  assert.equal(f.bets.length,100);
  assert.equal(f.readBalance(),290000);
  assert.equal(new Set(f.bets.map(b=>b.request_id)).size,100);
  const retry=await f.send(body);
  assert.equal(retry.status,200);
  assert.equal(retry.data.duplicate,true);
  assert.equal(f.bets.length,100);
  assert.equal(f.readBalance(),290000);
 }finally{Date.now=old;}
});
test('one hundred one taps are rejected with no debit',async()=>{
 const f=fixture(),old=Date.now;
 Date.now=()=>f.clock;
 try{
  const response=await f.send({round:f.roundNo,request_id:'greedy_batch_qa_over_limit',
   entries:[{itemId:'chicken',amount:100,count:101}]});
  assert.equal(response.status,400);
  assert.equal(f.bets.length,0);
  assert.equal(f.readBalance(),300000);
 }finally{Date.now=old;}
});
