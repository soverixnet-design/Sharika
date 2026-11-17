/* Original Greedy Game: authenticated Sharika bridge. No demo wallet, local RNG or fake ranks. */
(()=>{
'use strict';
const GAME='greedy-classic';
const OUTCOMES=new Set(F.map(f=>f.id).concat(['salad','pizza']));
const pending=new Map();
let seq=0,ready=false,changing=false,refreshing=false,unconfirmed=null,clockOffset=0;
let state=null,displayedResultRound=-1,animationRound=-1,autoRunning=false,placedDuringThisRound={};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
const toast=message=>show('<h3>Game Notice<u>×</u></h3>'+esc(message));
function request(action,method='GET',body){
 return new Promise((resolve,reject)=>{
  if(window.parent===window){reject(Error('Open this game from Sharika'));return;}
  const id=++seq;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Server timeout'))},9000);
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
async function bet(id,amount=S.chip){
 if(!ready||changing||unconfirmed||S.phase!=='bet'){
  if(unconfirmed)toast('Checking the previous bet. New bets are paused.');
  return false;
 }
 if(!F.some(f=>f.id===id)||!CH.includes(amount))return false;
 if(S.bal<amount){toast('Not enough coins. Open your wallet to recharge.');return false;}
 changing=true;
 const payload={round:S.round,itemId:id,amount,request_id:token()};
 try{
  await submit(payload);
  placedDuringThisRound[id]=(placedDuringThisRound[id]||0)+amount;
  return true;
 }catch(error){
  const msg=String(error.message);
  if(msg.includes('timeout')){unconfirmed=payload;toast('Bet confirmation pending. Reconnecting.');}
  else toast(msg);
  return false;
 }finally{changing=false;}
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
 const winnersHtml=(r.top||[]).slice(0,10).map((u,i)=>
  '<div class="row"><b>'+(i+1)+'</b><span>'+esc(u.name||'Player')+
  '</span><span>'+im('gem')+' '+format(u.win)+'</span></div>').join('');
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
  ready=false;S.phase='load';draw();
  // The game stays fail-closed whenever the native authenticated bridge is unavailable.
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
setInterval(refresh,1600);
})();