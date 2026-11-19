// Keep tap identity and selected chip through retries. A packet size is not a player limit.
window.createRoundTapQueue=function({send,openRound,onStatus}){
  const waiting=[];
  let active=false,reserved=0,count=0;
  let indicator;
  function status(){
    onStatus?.(count,reserved);
    if(typeof document==='undefined')return;
    if(!indicator){
      indicator=document.createElement('output');
      indicator.style.cssText='position:fixed;top:4px;right:4px;z-index:10000;background:#271c27;color:white;padding:3px 7px;border-radius:8px;font:12px sans-serif;pointer-events:none';
      document.body.append(indicator);
    }
    indicator.hidden=!count;
    indicator.textContent=count+' pending · '+reserved.toLocaleString('en-US');
  }
  async function flush(){
    if(active)return;
    active=true;
    try{
      while(waiting.length){
        const round=waiting[0].round;
        const packet=[];
        while(waiting.length&&waiting[0].round===round&&packet.length<24)packet.push(waiting.shift());
        let result;
        try{
          if(!openRound(round))throw Error('betting_closed');
          const body={round_no:round,taps:packet.map(job=>job.tap)};
          for(let attempt=0;;attempt++){
            try{
              result=await send(body);
              if(!Number.isSafeInteger(result?.coins)||result.round_no!==round||
                 result.receipts?.length!==packet.length||result.receipts.some((r,i)=>
                   r.request_id!==packet[i].tap.request_id||(!r.error&&!Number.isSafeInteger(r.bet_id))))
                throw Error('invalid_receipt');
              break;
            }catch(error){
              if(/invalid_bet|games?_adult_only|game_not_eligible|profile_(required|unavailable)|game_disabled|invalid_json|method_not_allowed/i.test(error.message))throw error;
              onStatus?.(count,reserved,'Checking pending bets');
              await new Promise(resolve=>setTimeout(resolve,Math.min(4000,250*(attempt+1))));
            }
          }
          packet.forEach((job,i)=>{
            const receipt=result.receipts[i];
            if(receipt.error)job.reject(Error(receipt.error));
            else job.resolve({...receipt,coins:result.coins,round_no:round});
          });
        }catch(error){packet.forEach(job=>job.reject(error));}
        reserved-=packet.reduce((sum,job)=>sum+job.tap.amount,0);
        count-=packet.length;status();
        await Promise.resolve();
      }
    }finally{active=false;}
  }
  return function enqueue(round,pick,amount,balance){
    if(!openRound(round))return Promise.reject(Error('betting_closed'));
    if(amount>balance-reserved)return Promise.reject(Error('insufficient_coins'));
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    const request_id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return new Promise((resolve,reject)=>{
      waiting.push({round,tap:{pick,amount,request_id},resolve,reject});
      reserved+=amount;count++;status();
      if(!active&&waiting.length===1)setTimeout(flush,0);
    });
  };
};
