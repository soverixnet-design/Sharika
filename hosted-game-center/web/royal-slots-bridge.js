/* Royal Slots authenticated iframe relay. Coins, spins and outcomes are server-owned. */
(()=>{'use strict';
 if(window.parent===window||new URLSearchParams(location.search).get('mode')!=='production')return;
 const PARENT='https://sharika-games-web-staging.soverixnet.workers.dev';
 const pending=new Map(),receipts=new Map();let ready=false;
 const send=payload=>parent.postMessage({source:'sharika-royal-slots',...payload},PARENT);
 // Prevent unverified Spin clicks before the native Firebase + D1 bridge is ready.
 // Demo-mode pages return above and never display this cover or access wallets.
 const cover=document.createElement('div');
 cover.id='sharika-royal-slots-connecting';
 cover.setAttribute('role','status');cover.setAttribute('aria-live','polite');
 cover.style.cssText='position:fixed;inset:0;z-index:2147483646;display:flex;'+
  'flex-direction:column;align-items:center;justify-content:center;gap:16px;'+
  'padding:24px;text-align:center;background:rgba(17,8,40,.94);'+
  'color:#ffe6a1;font:700 18px system-ui,sans-serif';
 const status=document.createElement('div');
 status.textContent='Connecting to Sharika game server…';
 const retryButton=document.createElement('button');
 retryButton.type='button';retryButton.textContent='Retry connection';
 retryButton.style.cssText='border:2px solid #ffc55d;border-radius:20px;'+
  'background:#7b2fa0;color:#fff;padding:12px 24px;font:700 16px system-ui';
 retryButton.hidden=true;cover.append(status,retryButton);document.body.appendChild(cover);
 const showConnection=(message,canRetry=false)=>{
  ready=false;cover.style.display='flex';
  status.textContent=message;retryButton.hidden=!canRetry;
 };
 retryButton.addEventListener('click',()=>{
  showConnection('Checking your verified wallet and game connection…');
  send({type:'ready'});
 });
 const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
 const validReceipt=(r,p,id)=>!!r&&r.requestId===id&&r.bet===p.bet&&
  r.freeSpin===p.freeSpin&&r.settled===true&&r.virtual_coins_only===true&&
  validMoney(r.balance)&&validMoney(r.totalWin)&&validMoney(r.jackpot)&&
  validMoney(r.jackpotWin)&&validMoney(r.freeSpinsLeft)&&r.freeSpinsLeft<=1000&&
  Number.isSafeInteger(r.freeSpinsAwarded)&&r.freeSpinsAwarded>=0&&
  r.freeSpinsAwarded<=8&&Array.isArray(r.grid)&&r.grid.length===5&&
  r.grid.every(col=>Array.isArray(col)&&col.length===3&&
   col.every(n=>Number.isInteger(n)&&n>=0&&n<=11))&&
  Array.isArray(r.lines)&&r.lines.length<=9&&
  r.lines.every(line=>line&&Number.isInteger(line.line)&&line.line>=1&&
   line.line<=9&&Number.isInteger(line.symbol)&&line.symbol>=0&&
   line.symbol<=8&&Number.isInteger(line.count)&&line.count>=3&&
   line.count<=5&&validMoney(line.win));
 function serverSpin(roundId,bet,freeSpin){
  if(!ready)return Promise.reject(Error('Game server not connected. Retry connection.'));
  if(typeof roundId!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(roundId))
   return Promise.reject(Error('Invalid round reference'));
  if(pending.has(roundId))return Promise.reject(Error('This round is already being verified'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{
    pending.delete(roundId);
    showConnection('Spin result unconfirmed. Reconnect to verify your wallet before trying again.',true);
    reject(Error('Game server timed out. Reconnect and check your wallet.'));
   },46000);
   pending.set(roundId,{resolve,reject,timer,bet,freeSpin});
   send({type:'spin',id:roundId,bet,freeSpin});
  });
 }
 const host={
  async placeBet({roundId,bet}){
   const receipt=await serverSpin(roundId,bet,false);
   // The native API has already debited or credited exactly once at this point.
   receipts.set(roundId,receipt);
   if(receipts.size>16)receipts.delete(receipts.keys().next().value);
   return {accepted:true,transactionId:roundId};
  },
  async startRound({roundId,bet,freeSpin}){
   const receipt=freeSpin?await serverSpin(roundId,bet,true):receipts.get(roundId);
   receipts.delete(roundId);
   if(!receipt||receipt.bet!==bet||receipt.freeSpin!==!!freeSpin)
    throw Error('Invalid settled server receipt');
   return receipt;
  }
 };
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==PARENT)return;
  const m=event.data;
  if(!m||m.source!=='sharika-royal-slots-server')return;
  if(m.type==='init'){
   if(!validMoney(m.balance)||!validMoney(m.freeSpins)||
      !m.profile||typeof m.profile.name!=='string'||!m.profile.name.trim())return;
   if(!window.SharikaGame||typeof window.SharikaGame.init!=='function'){
    showConnection('Royal Slots could not load. Retry connection.',true);return;
   }
   try{
    window.SharikaGame.init({mode:'production',host,profile:{
     id:String(m.profile.display_id||m.profile.public_id),name:m.profile.name,
     avatar:m.profile.pic||m.profile.avatar||''},
     balance:m.balance,bet:m.lockedBet||1000,freeSpins:m.freeSpins,
     jackpot:validMoney(m.jackpot)?m.jackpot:0});
    ready=true;cover.style.display='none';retryButton.hidden=true;
   }catch(error){showConnection('Royal Slots could not initialize. Please retry.',true);}
  }else if(m.type==='initError'){
   showConnection('Game server unavailable: '+String(m.error||'Connection failed').slice(0,120),true);
  }else if(m.type==='spinResult'&&typeof m.id==='string'){
   const p=pending.get(m.id);if(!p)return;
   pending.delete(m.id);clearTimeout(p.timer);
   if(m.error){
    const reason=String(m.error).slice(0,200);
    if(/timed out|network_unavailable|firebase_token_unavailable|temporarily unavailable/i.test(reason))
     showConnection('Spin status uncertain. Reconnect to verify your wallet.',true);
    p.reject(Error(reason));return;
   }
   const r=m.result;
   if(!validReceipt(r,p,m.id)){
    showConnection('Invalid server result. Reconnect to verify your wallet.',true);
    p.reject(Error('Invalid server response'));return;
   }
   window.SharikaGame?.setJackpot?.(r.jackpot);
   p.resolve(r);
  }
 });
 window.SharikaGame?.on('gameClose',()=>send({type:'close'}));
 const announceReady=()=>send({type:'ready'});
 if(document.readyState==='complete')announceReady();
 else window.addEventListener('load',announceReady,{once:true});
})();