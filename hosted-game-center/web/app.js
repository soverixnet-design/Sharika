/* The hosted site receives no Firebase token. Only the Android app can attach
   the origin-scoped, main-frame-only SharikaGameBridge. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const bridge=window.SharikaGameBridge||null;
 const all=$('games'),landing=$('landing'),player=$('player'),frame=$('game-frame');
 const status=$('status'),banner=$('error'),browserNote=$('browser-note');
 // These are the original game-card illustrations already owned by Sharika,
 // copied unchanged at website build time from android-staging assets.
 const artworks={
  'royal-ace':'/cards/superace.svg','cleopatra':'/cards/cleopatra.jpg',
  'greedy-classic':'/cards/greedy.jpg','food-deluxe':'/cards/food-wheel.png',
  'sovera-gaddy':'/cards/food-wheel.png','sovera-food':'/cards/food-wheel.png',
  'night-food':'/cards/food-wheel.png','greedy-wheel':'/cards/greedy-wheel.webp',
  'fruit-royale':'/cards/fruit-machine.jpg','jackpot-fruit':'/cards/jackpot-fruit.png'
 };
 let games=[],active=null,number=0,gameVersion=0,practice=null;
 const pending=new Map();
 function notify(message){banner.textContent=message;banner.hidden=!message;}
 function call(method,path,body){
  if(!bridge)return practice
    ? practice.request(method,path,body)
    : Promise.reject(Error('Open a free demo first.'));
  return new Promise((resolve,reject)=>{
   const id=String(++number);
   const timer=setTimeout(()=>{pending.delete(id);reject(Error('Game server timed out. Check the wallet before trying again.'));},19000);
   pending.set(id,{resolve,reject,timer});
   bridge.postMessage(JSON.stringify({id,method,path,body:body||null}));
  });
 }
 if(bridge){
  bridge.onmessage=e=>{
   let reply;try{reply=JSON.parse(e.data)}catch{return;}
   if(!reply||typeof reply.id!=='string')return;
   const p=pending.get(reply.id);if(!p)return;
   clearTimeout(p.timer);pending.delete(reply.id);
   if(reply.ok)p.resolve(reply.data);else p.reject(Error(String(reply.error||'Server unavailable')));
  };
 }
 const displayCards=(catalog,enabled)=>{
  all.replaceChildren();
  for(const g of catalog){
   if(!/^[a-z-]+$/.test(g.id)||!/^\/games\/[a-z0-9/_?=.&-]+$/.test(g.asset))continue;
   const usable=!bridge||enabled.has(g.id);
   const button=document.createElement('button');button.type='button';
   button.className='tile';button.disabled=!usable;
   const symbol=document.createElement('span');symbol.className='art';
   const img=document.createElement('img');
   img.src=artworks[g.id]||'/cards/food-wheel.png';
   img.alt=g.name+' original game card';img.loading='eager';
   img.decoding='async';symbol.append(img);
   const meta=document.createElement('span');meta.className='meta';
   const title=document.createElement('b');title.textContent=g.name;
   const label=document.createElement('small');
   label.textContent=bridge
     ? (usable?g.category+' · Server Game':'Unavailable in this build')
     : g.category+' · Free Demo';
   meta.append(title,label);button.append(symbol,meta);
   button.addEventListener('click',()=>openGame(g));
   all.append(button);
  }
 };
 function closeGame(){
  gameVersion++;active=null;practice=null;frame.removeAttribute('src');
  player.hidden=true;landing.hidden=false;
  $('back').hidden=true;notify('');window.scrollTo(0,0);
 }
 function openGame(game){
  gameVersion++;active=game;
  // Browser demos never get native app credentials or the real Sharika wallet.
  practice=bridge?null:window.createSharikaPractice(game.id);
  landing.hidden=true;player.hidden=false;$('back').hidden=false;
  $('game-name').textContent=game.name;
  $('play-label').textContent=bridge
    ? 'Cloudflare server · Verified virtual coins'
    : 'Free browser practice · No wallet or real server settlement';
  $('demo-banner').hidden=!!bridge;
  notify('');
  // Game Center is its own full-screen Activity, even if entered from a voice
  // room. Never force the cramped #sharika-room mini-game layout here.
  // The original Cleopatra HTML already has a fully offline sample-spin
  // engine. Use that for public browser practice; the authenticated Android
  // session continues using the server-owned settlement protocol.
  const hostedSlot=game.id==='royal-ace'||game.id==='cleopatra';
  const serverMode=!!bridge||game.id==='royal-ace';
  frame.src=game.asset+(hostedSlot?
   (game.asset.includes('?')?'&':'?')+'mode=full&host='+(serverMode?'1':'0'):'');
 }
 $('exit').addEventListener('click',closeGame);
 $('back').addEventListener('click',closeGame);
 window.addEventListener('message',async e=>{
  const game=active;
  // The game frame has a deliberately opaque sandbox origin. Source identity,
  // not the untrusted message body, binds requests to the active frame.
  if(!game||e.origin!=='null'||e.source!==frame.contentWindow)return;
  const m=e.data,version=gameVersion;
  if(!m||typeof m!=='object')return;
  // A late API response must never be delivered to a newly reopened iframe.
  const send=data=>{if(active===game&&version===gameVersion)
    frame.contentWindow?.postMessage(data,'*')};
  if(m.type==='sharika:original-exit'||m.type==='close'&&game.id==='royal-ace'){closeGame();return;}
  if(m.type==='expand')return;
  const royal=game.id==='royal-ace',cleo=game.id==='cleopatra';
  if(royal||cleo){
   if(royal&&m.source!=='sharika-royal-ace')return;
   const prefix=royal?'/api/v1/royal-ace':'/api/v1/cleopatra';
   const source=royal?{source:'sharika-royal-ace-server'}:{};
   if(m.type==='ready'){
    try{const state=await call('GET',prefix+'/state');send({type:'init',...source,...state})}
    catch(error){send({type:'gameError',...source,error:error.message});notify('Game unavailable: '+error.message)}
   }else if(m.type==='spin'&&typeof m.id==='string'&&/^[a-zA-Z0-9_-]{12,100}$/.test(m.id)&&
    Number.isSafeInteger(m.bet)&&m.bet>0&&(!royal||typeof m.buy==='boolean')){
    try{const result=await call('POST',prefix+'/spin',{bet:m.bet,requestId:m.id,...(royal?{buy:m.buy}:{})});
     send({type:'spinResult',id:m.id,...source,...result});}
    catch(error){send({type:'spinResult',id:m.id,...source,error:error.message})}
   }
   return;
  }
  if(game.id==='greedy-wheel'){
   if(m.source==='greedy-game'&&m.type==='close'){closeGame();return}
   if(m.type!=='sharika:greedy-request'||!Number.isSafeInteger(m.id)||m.id<1||
      !['state','bet','records'].includes(m.action))return;
   const method=m.action==='bet'?'POST':'GET';
   try{const data=await call(method,'/api/v1/greedy-wheel/'+m.action,m.action==='bet'?m.body:null);
    send({type:'sharika:greedy-response',id:m.id,ok:true,value:data})}
   catch(error){send({type:'sharika:greedy-response',id:m.id,ok:false,error:error.message})}
   return;
  }
  if(m.type!=='sharika:original-request'||m.game!==game.id||
    !Number.isSafeInteger(m.id)||m.id<1||!['state','history','stats','rankings','bet'].includes(m.action))return;
  const method=m.action==='bet'?'POST':'GET';
  if(m.method!==method)return;
  let query='';
  if(m.action==='rankings'&&m.query&&['daily','weekly','monthly'].includes(m.query.period)&&
     ['totalWin','totalBet','profitLoss','winCount'].includes(m.query.metric))
    query='?period='+m.query.period+'&metric='+m.query.metric;
  try{const result=await call(method,'/api/v1/original-games/'+game.id+'/'+m.action+query,
     method==='POST'?m.body:null);
   send({type:'sharika:original-response',id:m.id,ok:true,value:result});}
  catch(error){send({type:'sharika:original-response',id:m.id,ok:false,error:error.message})}
 });
 async function start(){
  try{
   const response=await fetch('/api/catalog',{cache:'no-store'});if(!response.ok)throw Error('Catalog unavailable');
   const data=await response.json();games=data.games||[];
   if(!bridge){
    status.textContent='Tap any original game card to try a free browser demo. No login or Sharika coins required.';
    browserNote.hidden=false;displayCards(games,new Set(games.map(g=>g.id)));return;
   }
   const result=await call('GET','/api/v1/game-catalog');
   const enabled=new Set((result.games||[]).filter(x=>x.enabled===true).map(x=>x.id));
   displayCards(games,enabled);
   status.textContent=enabled.size?'Connected to Sharika staging · '+enabled.size+' server-enabled games':'No games are enabled for this account.';
  }catch(error){status.textContent='Could not verify game access: '+error.message;
   displayCards(games,new Set());}
 }
 start();
})();
