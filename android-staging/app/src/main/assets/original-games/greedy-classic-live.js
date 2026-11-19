/* Original Greedy Game: authenticated Sharika bridge. No demo wallet, local RNG or fake ranks. */
(()=>{
'use strict';
const GAME='greedy-classic';
// Match the user's original 1080:1617 video artwork in both Android views.
// Never stretch the game to screen height: that created the giant red empty zone.
const inVoiceRoom=location.hash==='#sharika-room';
document.documentElement.classList.add(inVoiceRoom?'sharika-greedy-mini':'sharika-greedy-full');
const originalFit=document.createElement('style');
originalFit.id='sharika-original-video-fit';
originalFit.textContent=[
 'html,html body{width:100%;height:100dvh!important;min-height:0!important;',
 'overflow:hidden!important;background:#050708!important}',
 'html body{display:flex!important;align-items:center!important;',
 'justify-content:center!important}',
 '#app{width:min(100vw,480px,calc(100dvh * .668))!important;',
 'height:auto!important;max-height:100dvh!important;',
 'aspect-ratio:1080 / 1617!important;flex:none!important;',
 'margin:auto!important;overflow:hidden!important}',
 '#top{flex:0 0 auto!important;min-height:0!important}',
 '#stage{width:96%!important;height:auto!important;max-height:none!important;',
 'flex:0 0 auto!important;margin:0 auto!important}',
 '#stage>img.w{width:100%!important;height:auto!important;object-fit:contain!important}',
 '#low{flex:1 1 auto!important;min-height:0!important;max-height:none!important;',
 'overflow:hidden!important;justify-content:space-between!important;',
 'gap:4px!important;padding:5px 10px 7px!important}',
 '#res{flex:0 0 34px!important;min-height:0!important}',
 '#chips,#me{flex:0 0 auto!important}',
 '.chip{border:3px solid #f8da86!important;',
 'box-shadow:0 3px 0 #90502b,inset 0 1px 0 #fff5c8;',
 'background:linear-gradient(#e94343 0 40%,#fff5c7 43%,#fff7de 100%);',
 'opacity:.91!important}',
 '.chip.sel{border-color:#ffd33f!important;opacity:1!important;',
 'box-shadow:0 0 12px #ffe45a,0 4px 0 #9e5c23,inset 0 1px 0 #fff!important}',
 'html.sharika-greedy-mini #app{width:min(100vw,480px,calc(100dvh * .668))!important}',
 'html.sharika-greedy-mini #auto{min-width:45px!important;padding:2px 5px!important}',
 '@media(max-height:430px){#top{padding:2px 8px!important}',
 '#res{height:26px!important;flex-basis:26px!important}',
 '.chip{font-size:11px!important}#me{font-size:10px!important}}'
].join('');
document.head.append(originalFit);

const OUTCOMES=new Set(F.map(f=>f.id).concat(['salad','pizza']));
const pending=new Map();
let seq=0,ready=false,changing=false,refreshing=false,unconfirmed=null,clockOffset=0;
let lastOfflineNoticeAt=0;
let state=null,displayedResultRound=-1,animationRound=-1,autoRunning=false,placedDuringThisRound={};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=n=>Math.max(0,Number(n)||0).toLocaleString('en-US');
 // Presentation only: never abbreviate integer wallet requests or server values.
 const compactCoins=n=>{
  const v=Number(n)||0;
  if(v<1000)return format(v);
  for(const [unit,label] of [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']]){
   if(v>=unit){
    const x=v/unit;
    return (x>=100||Number.isInteger(x)?x.toFixed(0):x.toFixed(1).replace(/\\.0$/,''))+label;
   }
  }
  return format(v);
 };
 // Preserve the original asset and hit targets; only format stake labels.
 const originalGreedyDraw=draw;
 draw=function(...args){
  originalGreedyDraw(...args);
  for(const food of F){
   const value=Number(S.bets?.[food.id]||0);
   const cell=$('#a_'+food.id);
   if(cell)cell.textContent=value>0?compactCoins(value):'';
  }
 };

const toast=message=>show('<h3>Game Notice<u>×</u></h3>'+esc(message));

// User-requested original-video daily leader (not this player's current stake).
// Rankings always originate from the authenticated Greedy Classic API.
// Browser-only demo deliberately displays no invented ranking.
const rankHotspot=$('#rank'),ownStakeOnCard=$('#tb');
ownStakeOnCard.style.display='none';
const leaderStyle=document.createElement('style');
leaderStyle.id='sharika-greedy-daily-leader-and-winners';
leaderStyle.textContent=String.raw`
#tb{display:none!important}
#rank{z-index:5}
#rank .greedy-top-avatar{position:absolute;left:2%;top:15%;width:26%;height:67%;
  object-fit:cover;border-radius:8px;border:1px solid #f3ce83;pointer-events:none}
#rank .greedy-leader-lines{position:absolute;left:31%;right:3%;top:13%;bottom:12%;
  display:flex;flex-direction:column;justify-content:center;gap:3px;
  color:#563018;pointer-events:none;text-shadow:0 1px 0 #fff8d6;
  font:700 clamp(9px,2.5vw,13px)/1.08 system-ui,Arial,sans-serif;overflow:hidden}
#rank .greedy-leader-lines .top-title,#rank .greedy-leader-lines .top-id{display:none!important}
#rank .greedy-leader-lines .top-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  max-width:100%;font-weight:800}
#rank .greedy-leader-lines .top-coins{color:#9b5600;white-space:nowrap;font-size:1.06em}
`;
document.head.append(leaderStyle);
const leaderAvatar=document.createElement('img');
leaderAvatar.className='greedy-top-avatar';leaderAvatar.alt='Daily Top 1';leaderAvatar.hidden=true;
const leaderLines=document.createElement('span');leaderLines.className='greedy-leader-lines';
const leaderName=document.createElement('span'),leaderCoins=document.createElement('span');
leaderName.className='top-name';leaderCoins.className='top-coins';
leaderName.textContent='No players yet';leaderCoins.textContent='0 coins';
leaderLines.append(leaderName,leaderCoins);
rankHotspot.append(leaderAvatar,leaderLines);
function safeUserPic(v) {
 if(typeof v!=='string'||v.length>2048)return '';
 try {
  const u=new URL(v);
  const hosts=['sharika-api-staging.soverixnet.workers.dev','lh3.googleusercontent.com',
   'firebasestorage.googleapis.com','storage.googleapis.com'];
  return u.protocol==='https:'&&hosts.includes(u.hostname)&&!u.username&&!u.password?u.href:'';
 }catch{return ''}
}
function applyDailyLeader(rows){
 const top=Array.isArray(rows)?rows[0]:null;
 const id=String(top?.public_id||'');
 const coins=Number(top?.total_played);
 if(!top||!/^\d{6,12}$/.test(id)||!Number.isSafeInteger(coins)||coins<0){
  leaderName.textContent='No players yet';
  leaderCoins.textContent='0 coins';leaderAvatar.hidden=true;leaderAvatar.removeAttribute('src');return;
 }
 leaderName.textContent=String(top.name||'Player').slice(0,24);
 leaderCoins.textContent=compactCoins(coins)+' coins';
 const url=safeUserPic(top.avatar);
 leaderAvatar.hidden=!url;
 if(url)leaderAvatar.src=url;else leaderAvatar.removeAttribute('src');
}
// The authenticated Game Center owns the single top winner marquee.
 // Keep the large verified round-result ranking inside this game; never
 // draw a second winner banner over it.

// Low-latency original-style wheel sounds. Purely presentational; server still
// owns rounds, coins, wager receipts and the result. Respect room voice volume.
const FoodSound=(()=>{
 const AudioClass=window.AudioContext||window.webkitAudioContext;
 let context=null;
 const quiet=inVoiceRoom?0.34:1;
 function unlock(){
  if(!AudioClass)return null;
  try {
   if(!context)context=new AudioClass();
   if(context.state==='suspended')void context.resume().catch(()=>{});
   return context;
  }catch{return null}
 }
 function tone(frequency,duration,volume,kind='sine',delay=0){
  if(S.mute||document.visibilityState==='hidden'||!context||context.state!=='running')return;
  try {
   const t=context.currentTime+delay,o=context.createOscillator(),g=context.createGain();
   o.type=kind;o.frequency.setValueAtTime(frequency,t);
   g.gain.setValueAtTime(Math.max(.0002,volume*quiet),t);
   g.gain.exponentialRampToValueAtTime(.0001,t+duration);
   o.connect(g);g.connect(context.destination);
   o.start(t);o.stop(t+duration+.015);
  }catch{}
 }
 function play(event,step=0){
  if(event==='bet'){tone(710,.095,.028);tone(1100,.13,.022,'sine',.075);}
  if(event==='start'){tone(310,.20,.035,'triangle');tone(510,.13,.022,'triangle',.09);}
  if(event==='tick'){tone(480+((step||0)%8)*53,.055,.017,'triangle');}
  if(event==='result'){tone(590,.16,.025,'sine');tone(440,.19,.019,'sine',.17);}
  if(event==='win'){
   tone(523,.23,.033,'triangle');tone(659,.24,.033,'triangle',.13);
   tone(784,.29,.031,'sine',.26);tone(1046,.47,.026,'sine',.39);
  }
  if(event==='toggle'){tone(780,.13,.021);}
 }
 // Gesture required on some WebViews, without touching audio focus/room mic.
 document.addEventListener('pointerdown',unlock,{passive:true});
 document.addEventListener('keydown',unlock);
 return {unlock,play};
})();
$('#mu')?.addEventListener('click',()=>{FoodSound.unlock();FoodSound.play('toggle');});


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
 FoodSound.play('bet');
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
// Player taps are queued in order instead of silently dropped while a
// previous authenticated receipt is pending. Each server request gets a
// unique idempotency key; old-round taps are never carried into a new round.
const pendingFoodTaps=[];
async function bet(id,amount=S.chip){
 if(!ready||unconfirmed||S.phase!=='bet'){
  if(unconfirmed)toast('Checking the previous bet. New bets are paused.');
  return false;
 }
 if(!F.some(f=>f.id===id)||!CH.includes(amount))return false;
 if(changing){
  const round=S.round;
  return new Promise(resolve=>pendingFoodTaps.push({id,amount,round,resolve}));
 }
 if(S.bal<amount){toast('Not enough coins. Open your wallet to recharge.');return false;}
 changing=true;
 const payload={round:S.round,itemId:id,amount,request_id:token()};
 try{
  await submit(payload);
  placedDuringThisRound[id]=(placedDuringThisRound[id]||0)+amount;
  return true;
 }catch(error){
  const msg=String(error.message);
  if(msg.includes('timeout')){
   unconfirmed=payload;toast('Bet confirmation pending. Reconnecting.');
  }else if(msg==='BETTING_CLOSED'||msg==='betting_closed'){
   // The server clock is authoritative; do not display an intrusive modal.
  }else toast(msg);
  return false;
 }finally{
  changing=false;
  const next=pendingFoodTaps.shift();
  if(next){
   // A timeout or changed round cancels stale taps without extra debits.
   if(unconfirmed||!ready||S.phase!=='bet'||next.round!==S.round){
    next.resolve(false);
   }else{
    Promise.resolve().then(()=>bet(next.id,next.amount)).then(next.resolve,()=>next.resolve(false));
   }
  }
 }
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
 FoodSound.play('start');
 S.phase='spin';S.hint=false;draw();
 const wins=winners(resultId),ids=F.map(f=>f.id);
 let i=0,target=Math.max(0,ids.indexOf(wins[0])),n=16+target;
 const walk=()=>{
  if(round!==S.round){clearOn();return;}
  clearOn();$('#c_'+ids[i%ids.length]).classList.add('on');
  FoodSound.play('tick',i);
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
 FoodSound.play(earned>0?'win':'result');
 S.phase='pop';S.t=Math.min(4,Math.max(0,Math.ceil((state?.state?.endsAt-(Date.now()+clockOffset))/1000)));
 const winnersHtml=(r.top||[]).slice(0,3).map((u,i)=>{
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
  '<div style="text-align:center;color:#f0a800;font-size:24px;border-top:2px dashed #f0a800;padding-top:6px">Verified Round Top 3</div>'+
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
  applyDailyLeader(list);
  const rows=list.map(x=>'<div class="row"><b>'+Number(x.rank)+'</b><span>'+
    esc(x.name||'Player')+'<small style="display:block">ID: '+esc(x.public_id||'—')+'</small></span><span>'+im('gem')+' '+format(x.total_played)+'</span></div>').join('');
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
refreshDailyLeader();
setInterval(refreshDailyLeader,12000);
setInterval(updateTime,400);
let lastNetworkPoll=0;
setInterval(()=>{
  if(document.visibilityState==='hidden')return;
  const minGap=/2g|slow/i.test(navigator.connection?.effectiveType||'')?5000:2500;
  if(Date.now()-lastNetworkPoll<minGap)return;
  lastNetworkPoll=Date.now();refresh();
},1600);
})();