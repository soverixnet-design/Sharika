// Authenticated Sharika parent-frame bridge for Fruit Royale V2.
// The parent alone holds Firebase tokens. This frame can request fixed game actions only.
(() => {
'use strict';
if(window.SHARIKA_CONFIG?.mode!=='live')return;
const GAME='fruit-royale',pending=new Map(),subscribers=new Set();
let seq=0,interval=null,disposed=false,inFlight=null,lastRound=null;
const announced=new Set();
const FINAL_ERRORS=new Set(['invalid_bet','betting_closed','game_disabled',
  'idempotency_conflict','insufficient_coins','profile_required',
  'game_adult_only','invalid_bet_body','invalid_json']);
const emit=value=>subscribers.forEach(fn=>{try{fn(value);}catch(_){}});
function onMessage(event){
  if(event.source!==window.parent)return;
  const data=event.data;
  if(!data||data.type!=='sharika:original-response'||!Number.isSafeInteger(data.id))return;
  const p=pending.get(data.id);
  if(!p)return;
  clearTimeout(p.timer);pending.delete(data.id);
  if(data.ok){p.resolve(data.value);return;}
  const message=String(data.error||'server_unavailable');
  const error=new Error(message);
  if([...FINAL_ERRORS].some(code=>message.includes(code)))error.definitive=true;
  p.reject(error);
}
window.addEventListener('message',onMessage);
function call(action,method='GET',body,query){
  if(disposed)return Promise.reject(new Error('Game was closed.'));
  if(window.parent===window)return Promise.reject(new Error('Open Fruit Royale inside Sharika.'));
  return new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(
      'Connection timed out. Check the status before retrying the same bet.'));},12000);
    pending.set(id,{resolve,reject,timer});
    window.parent.postMessage({type:'sharika:original-request',game:GAME,id,
      action,method,body,query},'*');
  });
}
async function connect(){
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    const state=await call('state');
    const previous=state?.previous_result;
    if(lastRound&&state.round.id!==lastRound&&
       previous?.roundId===lastRound&&!announced.has(previous.roundId)){
      announced.add(previous.roundId);
      emit({type:'result',result:previous});
      // Let the old-round visual reveal finish before the next round is painted.
      await new Promise(resolve=>setTimeout(resolve,1750));
    }
    lastRound=state.round.id;
    return state;
  })().finally(()=>{inFlight=null;});
  return inFlight;
}
window.SharikaAPI={
  connect,
  placeBet:bet=>call('bet','POST',bet),
  getHistory:async()=>{const rows=await call('history');return Array.isArray(rows)?rows:[];},
  getRankings:async({period='daily',metric='totalWin'}={})=>{
    const rows=await call('rankings','GET',null,{period,metric});
    return Array.isArray(rows)?rows:[];
  },
  subscribe(fn){
    subscribers.add(fn);
    if(!interval)interval=setInterval(async()=>{
      if(document.hidden||disposed)return;
      try{emit({type:'state',state:await connect()});}
      catch(error){emit({type:'connection',message:'Reconnecting…'});}
    },2200);
    return ()=>{subscribers.delete(fn);if(!subscribers.size){
      clearInterval(interval);interval=null;
    }};
  },
  async disconnect(){
    disposed=true;clearInterval(interval);interval=null;subscribers.clear();
    window.removeEventListener('message',onMessage);
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Game closed.'));}
    pending.clear();
  }
};
})();
