/* Original Greedy Game: authenticated Sharika bridge. No demo wallet, local RNG or fake ranks. */
(()=>{
'use strict';
const GAME='greedy-classic';
// Restrict compact layout to the half-screen, in-room Game Center. The game
// still uses the original DOM and authenticated settlement bridge.
if(location.hash==='#sharika-room'){
 document.documentElement.classList.add('sharika-greedy-mini');
 const style=document.createElement('style');
 style.id='sharika-compact-game-fit';
 style.textContent=[
  'html.sharika-greedy-mini,html.sharika-greedy-mini body{',
  'height:100dvh!important;min-height:0!important;overflow:hidden!important}',
  'html.sharika-greedy-mini #app{height:100dvh!important;',
  'min-height:0!important;max-height:100dvh!important;overflow:hidden!important}',
  'html.sharika-greedy-mini #top{height:clamp(38px,12dvh,48px)!important;',
  'min-height:0!important;flex:0 0 auto!important}',
  'html.sharika-greedy-mini #stage{',
  'width:min(90vw,57dvh,390px)!important;height:auto!important;',
  'max-height:none!important;flex:0 0 auto!important;',
  'margin:0 auto!important}',
  'html.sharika-greedy-mini #stage>img.w{',
  'width:100%!important;height:100%!important;object-fit:contain!important}',
  'html.sharika-greedy-mini #low{height:auto!important;',
  'min-height:112px!important;max-height:none!important;',
  'overflow:hidden!important;flex:1 1 auto!important;',
  'gap:7px!important;padding:8px 12px 10px!important;',
  'justify-content:space-between!important}',
  'html.sharika-greedy-mini #chips{',
  'height:34px!important;min-height:0!important;max-height:36px!important}',
  'html.sharika-greedy-mini #me{',
  'height:36px!important;min-height:0!important;max-height:38px!important}',
  'html.sharika-greedy-mini #auto{',
  'position:static!important;right:auto!important;bottom:auto!important;',
  'left:auto!important;top:auto!important;z-index:auto!important;',
  'min-width:47px!important;padding:3px 5px!important}',
  'html.sharika-greedy-mini .chip{max-height:36px!important}',
  '@media(max-height:390px){html.sharika-greedy-mini #stage{',
  'width:min(90vw,44dvh)!important;max-height:none!important}}',
 ].join('');
 document.head.append(style);
}
else {
 // In a full Game Center WebView the original fixed 1080:1617 canvas
 // produced large BLACK bands on tall screens. Expand the *container*,
 // never stretch the 1:1 food wheel or its aligned hit targets.
 document.documentElement.classList.add('sharika-greedy-full');
 const style=document.createElement('style');
 style.id='sharika-fullscreen-game-fit';
 style.textContent=[
  'html.sharika-greedy-full,html.sharika-greedy-full body{',
  'width:100%;height:100dvh!important;min-height:0!important;',
  'background:#0bbcb0!important;overflow:hidden!important}',
  'html.sharika-greedy-full body{display:flex!important;',
  'align-items:stretch!important;justify-content:center!important}',
  'html.sharika-greedy-full #app{width:min(100vw,520px)!important;',
  'max-width:none!important;height:100dvh!important;',
  'min-height:0!important;aspect-ratio:auto!important;margin:0 auto!important}',
  'html.sharika-greedy-full #top{flex:0 0 auto!important}',
  'html.sharika-greedy-full #stage{width:min(96%,56dvh,510px)!important;',
  'max-height:none!important;flex:0 0 auto!important}',
  // Keep result, chips and wallet in a compact lower control deck instead
  // of stretching the bright-red deck across the entire tall phone screen.
  'html.sharika-greedy-full #app{justify-content:space-between!important}',
  'html.sharika-greedy-full #low{',
  'flex:0 0 clamp(190px,30dvh,258px)!important;',
  'height:clamp(190px,30dvh,258px)!important;',
  'min-height:190px!important;max-height:258px!important;',
  'justify-content:space-between!important;gap:3px!important;',
  'padding:5px 10px 9px!important;overflow:hidden!important}',
  'html.sharika-greedy-full #res,html.sharika-greedy-full #chips,',
  'html.sharika-greedy-full #me{flex:0 0 auto!important}',
  '@media(max-height:570px){html.sharika-greedy-full #stage{',
  'width:min(87vw,46dvh)!important}}'
 ].join('');
 document.head.append(style);
}


const OUTCOMES=new Set(F.map(f=>f.id).concat(['salad','pizza']));
const pending=new Map();
let seq=0,ready=false,changing=false,refreshing=false,unconfirmed=null,clockOffset=0;
let lastOfflineNoticeAt=0;
let state=null,displayedResultRound=-1,animationRound=-1,autoRunning=false,placedDuringThisRound={};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
const toast=message=>show('<h3>Game Notice<u>×</u></h3>'+esc(message));
function request(action,method='GET',body){
 return new Promise((resolve,reject)=>{
  if(window.parent===window){reject(Error('Open this game from Sharika'));return;}
  const id=++seq;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Server timeout'))},34000);
  pending.set(id,{resolve,reject,timer});
  window.parent.postMessage({type:'sharika:original-request',game:GAME,action,method,id,body},'*');
 });
}
window.addEventListener('message',e=>{
 if(e.source!==window.parent)return;
 const d=e.data;
 if(!d||d.type!=='sharika:original-response'||!Number.isSafeInteger(d.id))return;
 const handler=pending.get(d.id);
 if(!handler)return;
 clearTimeout(handler.timer);pending.delete(d.id);
 if(d.ok)handler.resolve(d.value);else handler.reject(Error(String(d.error||'Server unavailable')));
});
function token(){
 if(crypto.randomUUID)return 'greedy_'+crypto.randomUUID().replace(/-/g,'');
 const arr=crypto.getRandomValues(new Uint8Array(16));
 return 'greedy_'+Array.from(arr,x=>x.toString(16).padStart(2,'0')).join('');
}
const isValidMoney=n=>Number.isSafeInteger(n)&&n>=0;
function betAmounts(a){
 return Object.fromEntries(F.map((f,i)=>[f.id,Number(a?.[i]||0)]));
}
async function submit(payload){
 const r=await request('bet','POST',payload);
 if(!r||!isValidMoney(r.balance)||!Array.isArray(r.myBets)||r.myBets.length!==8)
  throw Error('Invalid verified bet receipt');
 S.bal=r.balance;
 if(r.round===S.round)S.bets=betAmounts(r.myBets);
 S.hint=false;
 ready=true;
 draw();
 return true;
}
async function recoverUnknown(){
 if(!unconfirmed)return;
 try{
  const item=unconfirmed;
  await submit(item);
  unconfirmed=null;
 }catch(error){
  // A timeout cannot prove whether the database debited this request.
  // Keep the original ID and block new bets; never create a second debit.
  if(!String(error.message).includes('timeout')&&
     !String(error.message).includes('closed')){
   const value=String(error.message).toLowerCase();
   if(value.includes('idempotency_conflict'))return;
  }
 }
}
// Every touch is counted synchronously and coalesced into verified D1 bets.
// A batch contains <=100 individual chip taps, never optimistic coin payouts.
let queuedGreedy=[],greedyDraining=false,greedyTimer=null,greedyPendingBatch=null;
let greedyVerified=0,greedyDeclined=0,greedyRound=-1;
const greedyStatus=document.createElement('div');
greedyStatus.id='greedy-wager-status';
greedyStatus.setAttribute('role','status');
greedyStatus.style.cssText='position:fixed;right:8px;bottom:88px;z-index:12;'+
 'padding:3px 7px;border-radius:8px;background:#461523de;color:#fff3bd;'+
 'font:700 11px system-ui;pointer-events:none;max-width:90vw';
document.body.appendChild(greedyStatus);
function updateGreedyStatus(){
 greedyStatus.textContent=greedyPendingBatch
  ?'Verifying '+greedyPendingBatch.taps.length+' earlier taps · no extra charge'
  :'Queued '+queuedGreedy.length+' · Verified '+greedyVerified+' · Declined '+greedyDeclined;
}
function bet(id,amount=S.chip){
 if(!ready||S.phase!=='bet'||!F.some(f=>f.id===id)||!CH.includes(amount)){
  updateGreedyStatus();return Promise.resolve(false);
 }
 if(greedyPendingBatch){
  greedyStatus.textContent='Previous batch unconfirmed. No new charge.';
  return Promise.resolve(false);
 }
 if(greedyRound!==S.round){
  greedyRound=S.round;queuedGreedy=[];greedyVerified=0;greedyDeclined=0;
 }
 const reserved=queuedGreedy.reduce((n,t)=>n+t.amount,0);
 if(S.bal<reserved+amount){
  greedyStatus.textContent='Not enough confirmed coins for more taps';
  return Promise.resolve(false);
 }
 queuedGreedy.push({id,amount,round:S.round});
 updateGreedyStatus();
 if(!greedyTimer)greedyTimer=setTimeout(()=>{
  greedyTimer=null;void flushGreedyQueue();
 },90);
 return Promise.resolve(true);
}
async function flushGreedyQueue(){
 if(greedyDraining||(!greedyPendingBatch&&!queuedGreedy.length))return;
 greedyDraining=true;changing=true;
 try{
  while(greedyPendingBatch||queuedGreedy.length){
   let work=greedyPendingBatch;
   if(!work){
    if(!ready||S.phase!=='bet'||queuedGreedy[0].round!==S.round){
     greedyDeclined+=queuedGreedy.length;queuedGreedy=[];
     greedyStatus.textContent='Round closed · unsubmitted taps were not charged';
     return;
    }
    const taps=queuedGreedy.splice(0,100),groups=new Map();
    for(const tap of taps){
     const key=tap.id+'|'+tap.amount;
     const v=groups.get(key)||{itemId:tap.id,amount:tap.amount,count:0};
     v.count++;groups.set(key,v);
    }
    work={taps,payload:{round:S.round,request_id:token(),entries:[...groups.values()]}};
   }
   greedyPendingBatch=work;
   updateGreedyStatus();
   try{
    const result=await request('bet-batch','POST',work.payload);
    if(!result||!isValidMoney(result.balance)||
      !Array.isArray(result.myBets)||result.myBets.length!==8||
      result.batch_request_id!==work.payload.request_id||
      result.accepted_clicks!==work.taps.length)
      throw Error('Invalid verified batch receipt');
    S.bal=result.balance;
    if(result.round===S.round)S.bets=betAmounts(result.myBets);
    for(const tap of work.taps)
      placedDuringThisRound[tap.id]=(placedDuringThisRound[tap.id]||0)+tap.amount;
    greedyVerified+=work.taps.length;greedyPendingBatch=null;
    S.hint=false;draw();updateGreedyStatus();
   }catch(error){
    const code=String(error?.message||error);
    if(/timeout|network|unavailable|connection|failed/i.test(code)){
     greedyStatus.textContent='Unconfirmed batch. Check server before new taps.';
     // Keep the exact request ID: a delayed accepted batch must never be paid twice.
     return;
    }
    greedyPendingBatch=null;greedyDeclined+=work.taps.length;
    greedyStatus.textContent='Batch not accepted: '+code;
    if(code.includes('BETTING_CLOSED')){greedyDeclined+=queuedGreedy.length;queuedGreedy=[];return;}
   }
  }
 }finally{changing=false;greedyDraining=false;}
}
async function replayLast(){
 if(autoRunning||!S.auto||!ready||!Object.values(S.last).some(n=>n>0))return;
 autoRunning=true;
 try{
  for(const f of F){
   let amount=Number(S.last[f.id]||0);
   for(const chip of [...CH].reverse()){
    while(amount>=chip&&S.phase==='bet'&&ready&&!unconfirmed){
     const ok=await bet(f.id,chip);
     if(!ok)return;
     amount-=chip;
    }
   }
  }
 }finally{autoRunning=false;}
}
function startSpin(resultId,round){
 if(!OUTCOMES.has(resultId)||displayedResultRound===round||animationRound===round)return;
 animationRound=round;
 S.phase='spin';S.hint=false;draw();
 const wins=winners(resultId),ids=F.map(f=>f.id);
 let i=0,target=Math.max(0,ids.indexOf(wins[0])),n=16+target;
 const walk=()=>{
  if(round!==S.round){clearOn();return;}
  clearOn();$('#c_'+ids[i%ids.length]).classList.add('on');
  if(i++<n){setTimeout(walk,45+Math.floor(85*i/n));return;}
  clearOn();wins.forEach(w=>$('#c_'+w)?.classList.add('on'));
  if(resultId==='salad'||resultId==='pizza')$('#g_'+resultId).classList.add('on');
  displayedResultRound=round;
  const r=state?.result;
  if(!r||r.round!==round||r.resultId!==resultId){refresh();return;}
  finishVerified(r,round);
 };
 walk();
}
function finishVerified(r,round){
 if(round!==S.round)return;
 const earned=Number(r.you?.win||0),betTotal=Number(r.you?.bet||0);
 if(!isValidMoney(earned)||!isValidMoney(betTotal))return;
 S.phase='pop';S.t=Math.min(4,Math.max(0,Math.ceil((state?.state?.endsAt-(Date.now()+clockOffset))/1000)));
 const winnersHtml=(r.top||[]).slice(0,10).map((u,i)=>{
  // Rankings are received from the verified game-state API; never accept a
  // fabricated browser-posted winner. Escape both name and image attributes.
  const pic=String(u.avatar||u.pic||'');
  const safePic=/^https:\/\/(?:sharika-api-staging\.soverixnet\.workers\.dev|lh3\.googleusercontent\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(pic)?
   '<img src="'+esc(pic)+'" alt="" loading="lazy" style="width:23px;height:23px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:5px">':'';
  const id=String(u.userId||u.public_id||'');
  return '<div class="row"><b>'+(i+1)+'</b><span>'+safePic+esc(u.name||'Player')+
   (/^[0-9]{1,12}$/.test(id)?'<small style="display:block">ID: '+id+'</small>':'')+
   '</span><span>'+im('gem')+' '+format(u.win)+'</span></div>';
 }).join('');
 show('<span class="cnt">('+S.t+'s)</span>'+im(r.resultId,'big')+
  '<div style="padding-top:14px">Round '+round+' Result</div><div style="clear:both"></div>'+
  '<div class="row"><span>Coins Won</span><span>'+im('gem')+' '+format(earned)+'</span></div>'+
  '<div class="row"><span>Total Bet</span><span>'+im('gem')+' '+format(betTotal)+'</span></div>'+
  '<div style="text-align:center;color:#f0a800;font-size:24px;border-top:2px dashed #f0a800;padding-top:6px">Verified Round Ranking</div>'+
  (winnersHtml||'<div class="row">No verified winners</div>'),true);
 draw();
}
function updateTime(){
 if(!state||!state.state)return;
 S.t=Math.max(0,Math.ceil((state.state.endsAt-(Date.now()+clockOffset))/1000));
 if(S.phase==='pop'){
  const counter=$('#box .cnt');if(counter)counter.textContent='('+Math.min(S.t,4)+'s)';
 }
 draw();
}
async function refresh(){
 if(refreshing)return;
 refreshing=true;
 try{
  const r=await request('state');
  if(!r||!r.state||!isValidMoney(r.balance)||
   !Number.isSafeInteger(r.state.round)||!Array.isArray(r.myBets)||
   !Array.isArray(r.history))throw Error('Invalid game server response');
  const prevRound=S.round;
  if(prevRound&&r.state.round!==prevRound){
   const prior={...S.bets};
   if(Object.values(prior).some(x=>x>0))S.last=prior;
   placedDuringThisRound={};
   animationRound=-1;displayedResultRound=-1;
   hide();clearOn();
  }
  state=r;clockOffset=r.serverTime-Date.now();
  S.round=r.state.round;S.bal=r.balance;S.rev=Number(r.todayWin)||0;
  S.played=Number(r.todayPlayed)||0;
  S.bets=betAmounts(r.myBets);
  S.pool=Array.isArray(r.state.totals)&&r.state.totals.length===8?r.state.totals:Array(8).fill(0);
  S.hist=r.history.map(x=>x.itemId).filter(x=>OUTCOMES.has(x)).slice(0,7);
  if(r.user){
   $('#me .nm').textContent=String(r.user.name||'Player').slice(0,30);
   const avatar=String(r.user.avatar||'');
   if(/^https:\/\//.test(avatar))$('#av2').src=avatar;
  }
  ready=true;
  if(r.state.phase==='betting'){
   S.phase='bet';S.t=Math.max(0,Math.ceil((r.state.endsAt-(Date.now()+clockOffset))/1000));
   if(prevRound&&prevRound!==S.round&&S.auto&&!unconfirmed)replayLast();
  }else if(r.state.resultId&&r.result&&OUTCOMES.has(r.state.resultId)){
   if(displayedResultRound!==S.round&&animationRound!==S.round){
    startSpin(r.state.resultId,S.round);
   }else if(displayedResultRound===S.round){S.phase='pop';}
  }else S.phase='spin';
  draw();
  if(unconfirmed&&!changing)recoverUnknown();
 }catch(error){
  // Keep the last verified screen during low connectivity, but block all new wagers.
  ready=false;
  if(!state)S.phase='load';
  draw();
  if(Date.now()-lastOfflineNoticeAt>12000){
   lastOfflineNoticeAt=Date.now();
   toast('Network weak. Reconnecting to verified game state.');
  }
  // No fabricated result, local coin mutation or new request ID on refresh failure.
 }finally{refreshing=false;}
}
$('#rank').onclick=async()=>{
 try{
  const data=await request('rankings');
  const list=Array.isArray(data.rankings)?data.rankings:[];
  const rows=list.map(x=>'<div class="row"><b>'+Number(x.rank)+'</b><span>'+
    esc(x.name||'Player')+'</span><span>'+im('gem')+' '+format(x.total_played)+'</span></div>').join('');
  show('<h3>Daily Bet Ranking<u>×</u></h3><div class="row"><b>Rank</b><b>Name</b><b>Total Bet</b></div>'+
    (rows||'<p>No ranked players yet</p>'));
 }catch(error){toast(error.message);}
};
$('#hist').onclick=async()=>{
 try{
  const data=await request('history');
  const list=Array.isArray(data.list)?data.list:[];
  const rows=list.slice(0,50).map(m=>'<div class="row"><span>Round '+Number(m.round)+
    ' '+(OUTCOMES.has(m.itemId)?im(m.itemId):'')+'</span><span>Bet '+format(m.bet)+
    '</span><span>Win '+format(m.win)+'</span></div>').join('');
  show('<h3>My History<u>×</u></h3>'+(rows||'<p>No verified bets yet</p>'));
 }catch(error){toast(error.message);}
};
window.bet=bet; // The original artwork's food-click closures resolve this global.
$('#pl').onclick=()=>toast('Open your Sharika Wallet from the profile to recharge.');
$('#bk').onclick=()=>window.parent.postMessage({type:'sharika:original-exit'},'*');
S.phase='load';S.bal=0;S.round=0;S.rev=0;draw();refresh();
setInterval(updateTime,400);
let lastNetworkPoll=0;
setInterval(()=>{
  if(document.visibilityState==='hidden')return;
  const minGap=/2g|slow/i.test(navigator.connection?.effectiveType||'')?5000:2500;
  if(Date.now()-lastNetworkPoll<minGap)return;
  lastNetworkPoll=Date.now();refresh();
},1600);
})();