(() => {
'use strict';
const $=id=>document.getElementById(id), cfg=window.SHARIKA_CONFIG;
const fmt=n=>Number(n).toLocaleString('en-US'), short=n=>n>=1e6?(n/1e6)+'M':n>=1e3?(n/1e3)+'K':String(n);
let api,state,chip=1000,pending=null,busy=false,offset=0,spin=0,toastTimer,animationTimer,unsubscribe,lastFocus;
const seenResults=new Set();let animationGeneration=0;
function text(id,value){$(id).textContent=String(value);}
function notify(message){text('toast',message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function report(error){notify(error&&error.message?error.message:'Request failed.');}
function node(tag,cls,value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n;}
function bettingOpen(){return state&&state.round.status==='open'&&Date.now()+offset<state.round.closesAt;}
function updateControls(){
 if(!state)return;
 document.querySelectorAll('.fruit').forEach(b=>b.disabled=busy||!!pending||!bettingOpen()||state.balance<chip);
 document.querySelectorAll('[data-amount]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.amount)===chip);b.disabled=Number(b.dataset.amount)>state.balance;});
 $('retry').hidden=!pending;$('retry').disabled=busy;
}
function renderWheel(){
 const w=$('wheel');w.replaceChildren();
 state.fruits.forEach((f,i)=>{
  if(i===4){const core=node('div','wheelcore');core.append(node('b','','♛'),node('span','','FRUIT ROYALE'));w.append(core);}
  const b=node('button','fruit');b.dataset.fruit=f.id;b.setAttribute('aria-label',f.name+', multiplier '+f.multiplier+', bet '+chip);
  b.append(node('span','emoji',f.emoji),node('span','name',f.name),node('span','mult','×'+f.multiplier));
  const stake=state.bets.filter(x=>x.fruitId===f.id).reduce((a,x)=>a+x.amount,0);
  if(stake)b.append(node('span','stake',short(stake)));
  b.onclick=()=>bet(f.id);w.append(b);
 });updateControls();
}
function apply(s){
 if(!s||!s.round||!Array.isArray(s.fruits)||s.fruits.length!==8||!Array.isArray(s.bets)||!Number.isSafeInteger(s.balance))throw new Error('Invalid server state. Expected eight fruits and a safe integer balance.');
 if(!Number.isFinite(s.serverNow)||!Number.isFinite(s.round.closesAt))throw new Error('Invalid server clock.');
 const changed=state&&state.round.id!==s.round.id;
 state=s;offset=s.serverNow-Date.now();
 if(changed){animationGeneration++;clearInterval(animationTimer);document.querySelectorAll('[data-bonus]').forEach(n=>n.classList.remove('active'));text('resultline','Choose a chip, then tap a fruit.');}
 text('balance',fmt(s.balance));text('pool',fmt(s.jackpot));text('round','ROUND '+s.round.id);renderWheel();tick();
}
function tick(){if(!state)return;const remaining=Math.max(0,Math.ceil((state.round.closesAt-Date.now()-offset)/1000));text('clock',remaining);$('clock').classList.toggle('urgent',remaining>0&&remaining<=5);text('phase',bettingOpen()?'BETTING OPEN':state.round.status==='settled'?'ROUND COMPLETE':'WAITING FOR RESULT');text('totalbet',fmt(state.bets.reduce((a,b)=>a+b.amount,0)));updateControls();}
function selectChip(amount){if(!Number.isSafeInteger(amount)||amount<1)return notify('Enter a positive whole-number amount.');if(state&&(amount<state.limits.minBet||amount>state.limits.maxBet))return notify('Amount is outside this game’s bet limits.');chip=amount;updateControls();if(state)renderWheel();notify('Selected chip: '+fmt(chip));}
async function bet(fruitId){
 if(busy||pending||!bettingOpen())return;
 pending={requestId:crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''),roundId:state.round.id,fruitId,amount:chip};await submit();
}
async function submit(){
 if(!pending||busy)return;busy=true;updateControls();
 try{
  const requested={...pending};const receipt=await api.placeBet(requested);
  if(receipt.requestId!==requested.requestId||receipt.roundId!==requested.roundId||receipt.amount!==requested.amount||receipt.fruitId!==requested.fruitId||!Number.isSafeInteger(receipt.balance))throw new Error('Invalid receipt. Reconcile this request with your server.');
  pending=null;
  // Refresh authoritative state instead of decrementing local balance.
  apply(await api.connect());notify('Bet accepted: '+fmt(receipt.amount));
 }catch(e){
  // Only explicit final rejection clears an uncertain request. Retry reuses its ID.
  if(e.definitive===true||cfg.mode==='demo')pending=null;
  report(e);
 }finally{busy=false;updateControls();}
}
function onResult(r){
 if(!r||seenResults.has(r.roundId))return;
 if(!Array.isArray(r.fruitIds)||r.fruitIds.some(id=>!state.fruits.some(f=>f.id===id))||!Number.isSafeInteger(r.payout)||!Number.isSafeInteger(r.balance))return report(new Error('Invalid server result.'));
 seenResults.add(r.roundId);if(seenResults.size>500)seenResults.delete(seenResults.values().next().value);
 if(r.roundId!==state.round.id){loadHistory();notify('An earlier round settled. Refreshing wallet.');api.connect().then(apply).catch(report);return;}
 state.round.status='settled';state.balance=r.balance;text('balance',fmt(r.balance));if(Number.isSafeInteger(r.jackpot))text('pool',fmt(r.jackpot));updateControls();
 clearInterval(animationTimer);const generation=++animationGeneration;
 const tiles=[...document.querySelectorAll('.fruit')];let steps=0;const max=window.matchMedia('(prefers-reduced-motion: reduce)').matches?1:24;
 animationTimer=setInterval(()=>{
  tiles.forEach(n=>n.classList.remove('cursor','won'));tiles[spin++%tiles.length].classList.add('cursor');
  if(++steps>=max){clearInterval(animationTimer);if(generation!==animationGeneration)return;
   tiles.forEach(n=>{n.classList.remove('cursor');n.classList.toggle('won',r.fruitIds.includes(n.dataset.fruit));});
   document.querySelectorAll('[data-bonus]').forEach(n=>n.classList.toggle('active',n.dataset.bonus===r.bonus));
   const names=r.fruitIds.map(id=>state.fruits.find(f=>f.id===id).name).join(' + ');
   text('resultline',names+(r.bonus!=='none'?' · '+r.bonus.toUpperCase():'')+' · Payout '+fmt(r.payout));
   if(r.totalBet>0)showWinner(r);loadHistory();
  }
 },65);
}
function showWinner(r){lastFocus=document.activeElement;text('winTitle',r.payout>0?'ROYAL REWARD':'ROUND SETTLED');text('winAmount',fmt(r.payout));text('winDetail',(cfg.mode==='demo'?'Practice credits · ':'')+'Bet '+fmt(r.totalBet)+' · Net '+fmt(r.payout-r.totalBet)+(r.jackpotAward?' · Jackpot '+fmt(r.jackpotAward):''));$('confetti').replaceChildren();if(r.payout>0)for(let i=0;i<28;i++){const p=node('i');p.style.left=(i*37%100)+'%';p.style.animationDelay=(i%9)*.17+'s';p.style.background=i%2?'#c694ff':'#ffd978';$('confetti').append(p);}$('winner').hidden=false;$('closeWinner').focus();}
function closeWinner(){$('winner').hidden=true;if(lastFocus&&lastFocus.isConnected)lastFocus.focus();}
async function loadHistory(){try{const rows=await api.getHistory({limit:50});$('history').replaceChildren();if(!rows.length){$('history').append(node('div','empty','No settled bets yet. Your accepted rounds will appear here.'));return;}rows.forEach(r=>{const item=node('div','historyitem');const d=node('div','details',r.roundId);d.append(node('small','',new Date(r.settledAt).toLocaleString()+' · Bet '+fmt(r.totalBet)+' · '+r.bonus));const a=node('div','amount',fmt(r.payout));a.append(node('small','','Net '+fmt(r.profitLoss)));item.append(d,a);$('history').append(item);});}catch(e){report(e);}}
let rankingRequest=0;
async function loadRankings(){const req=++rankingRequest;try{const metric=$('metric').value;const rows=await api.getRankings({period:$('period').value,metric,limit:20});if(req!==rankingRequest)return;$('rankings').replaceChildren();if(!rows.length){$('rankings').append(node('div','empty',cfg.mode==='demo'?'No demo leaderboard. Connect your server to show real players only.':'No ranking entries for this period.'));return;}rows.slice(0,20).forEach((r,i)=>{const item=node('div','rankitem');item.append(node('span','ranknum',i+1));const avatar=node('span','avatar',(r.name||'?').slice(0,1));if(r.avatarUrl){try{const u=new URL(r.avatarUrl);if(u.protocol==='https:'){const img=node('img','avatar');img.src=u.href;img.alt='';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(avatar);item.append(img);}else item.append(avatar);}catch(_){item.append(avatar);}}else item.append(avatar);const d=node('div','details',r.name);d.append(node('small','','ID '+r.userId));item.append(d,node('span','amount',fmt(r[metric])));$('rankings').append(item);});}catch(e){report(e);}}
async function start(){
 text('mode',cfg.mode==='demo'?'DEMO · NO REAL COINS':'LIVE · SERVER CONTROLLED');text('balanceLabel',cfg.mode==='demo'?'PRACTICE BALANCE':'SHARIKA WALLET');text('footerMode',cfg.mode==='demo'?'· DEMO':'· LIVE');
 api=window.SharikaAPI;if(!api)throw new Error('Live adapter missing. Game is locked; no demo fallback.');
 unsubscribe=api.subscribe(e=>{try{if(e.type==='state')apply(e.state);else if(e.type==='result')onResult(e.result);else if(e.type==='connection')text('connection',e.message);}catch(error){report(error);}});
 apply(await api.connect());text('connection',cfg.mode==='demo'?'Local practice session':'Connected to your adapter');loadHistory();
}
$('chips').onclick=e=>{const b=e.target.closest('[data-amount]');if(b)selectChip(Number(b.dataset.amount));};$('setcustom').onclick=()=>selectChip(Number($('custom').value));$('retry').onclick=submit;
$('closeWinner').onclick=closeWinner;$('winner').onkeydown=e=>{if(e.key==='Escape')closeWinner();if(e.key==='Tab'){e.preventDefault();$('closeWinner').focus();}};
$('help').onclick=()=>$('info').showModal();$('compact').onclick=()=>{const compact=$('game').classList.toggle('compact');if(typeof cfg.onLayoutChange==='function')cfg.onLayoutChange({compact});};if(cfg.compact)$('game').classList.add('compact');
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n===b));$('historyPanel').hidden=b.dataset.tab!=='history';$('rankingPanel').hidden=b.dataset.tab!=='ranking';if(b.dataset.tab==='ranking')loadRankings();});
 $('refreshHistory').onclick=loadHistory;$('period').onchange=loadRankings;$('metric').onchange=loadRankings;
 const interval=setInterval(tick,200);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&api)api.connect().then(apply).catch(report);});
 window.addEventListener('pagehide',()=>{clearInterval(interval);clearInterval(animationTimer);if(unsubscribe)unsubscribe();if(api&&api.disconnect)api.disconnect();},{once:true});
 window.SharikaGame={refresh:()=>api.connect().then(apply),setCompact:value=>$('game').classList.toggle('compact',!!value)};
 start().catch(e=>{text('connection','Not connected · betting locked');report(e);});
})();
