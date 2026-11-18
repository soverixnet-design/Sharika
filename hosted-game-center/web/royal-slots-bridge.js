/* Royal Slots opaque iframe adapter. All coins and outcomes remain server-owned. */
(()=>{'use strict';
 if(window.parent===window)return;
 const PARENT='https://sharika-games-web-staging.soverixnet.workers.dev';
 const pending=new Map(),receipts=new Map();let ready=false;
 const send=payload=>parent.postMessage({source:'sharika-royal-slots',...payload},PARENT);
 function serverSpin(roundId,bet,freeSpin){
  if(!ready)return Promise.reject(Error('Game server not connected'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(roundId);reject(Error('Game server timed out. Verify your wallet before retrying.'))},19000);
   pending.set(roundId,{resolve,reject,timer,bet,freeSpin});
   send({type:'spin',id:roundId,bet,freeSpin});
  });
 }
 const host={
  async placeBet({roundId,bet}){
   const receipt=await serverSpin(roundId,bet,false);
   receipts.set(roundId,receipt);
   return {accepted:true,transactionId:roundId};
  },
  async startRound({roundId,bet,freeSpin}){
   const receipt=freeSpin?await serverSpin(roundId,bet,true):receipts.get(roundId);
   receipts.delete(roundId);
   if(!receipt||receipt.bet!==bet||receipt.freeSpin!==!!freeSpin)
    throw Error('Invalid server receipt');
   return receipt;
  }
 };
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==PARENT)return;
  const m=event.data;
  if(!m||m.source!=='sharika-royal-slots-server')return;
  if(m.type==='init'){
   if(!Number.isSafeInteger(m.balance)||!Number.isSafeInteger(m.freeSpins)||
      !m.profile||typeof m.profile.name!=='string')return;
   ready=true;
   window.SharikaGame.init({mode:'production',host,profile:{
     id:String(m.profile.display_id||m.profile.public_id),name:m.profile.name,
     avatar:m.profile.pic||m.profile.avatar||''},
     balance:m.balance,freeSpins:m.freeSpins,
     jackpot:Number.isSafeInteger(m.jackpot)?m.jackpot:0});
  }else if(m.type==='spinResult'&&typeof m.id==='string'){
   const p=pending.get(m.id);if(!p)return;
   pending.delete(m.id);clearTimeout(p.timer);
   if(m.error){p.reject(Error(String(m.error).slice(0,200)));return;}
   const r=m.result;
   if(!r||r.requestId!==m.id||r.bet!==p.bet||r.freeSpin!==p.freeSpin||
     !r.settled||!Number.isSafeInteger(r.balance)||!Number.isSafeInteger(r.totalWin)||
     !Array.isArray(r.grid)||r.grid.length!==5||
     r.grid.some(col=>!Array.isArray(col)||col.length!==3||
       col.some(n=>!Number.isInteger(n)||n<0||n>11))){
    p.reject(Error('Invalid server response'));return;
   }
   if(Number.isSafeInteger(r.jackpot))window.SharikaGame.setJackpot(r.jackpot);
   p.resolve(r);
  }
 });
 window.SharikaGame?.on('gameClose',()=>send({type:'close'}));
 const announceReady=()=>send({type:'ready'});
 if(document.readyState==='complete')announceReady();
 else window.addEventListener('load',announceReady,{once:true});
})();