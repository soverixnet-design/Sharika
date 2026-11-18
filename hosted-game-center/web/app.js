/* Sharika hosted Game Center. Site JS has NO Firebase token. Only the
 * main-frame, origin-scoped Android message bridge can invoke D1 APIs.
 * Game iframes have opaque origins and cannot access that bridge. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const bridge=window.SharikaGameBridge||null;
 const inRoom=new URLSearchParams(location.search).get('view')==='room';
 if(inRoom)document.documentElement.classList.add('room-mode');
 const all=$('games'),landing=$('landing'),player=$('player'),frame=$('game-frame');
 const status=$('status'),banner=$('error'),browserNote=$('browser-note');
 const API_ORIGIN='https://sharika-api-staging.soverixnet.workers.dev';
 const artworks={
  'royal-ace':'/cards/superace.svg','cleopatra':'/cards/cleopatra.jpg',
  'greedy-classic':'/cards/greedy.jpg','food-deluxe':'/cards/food-wheel.png',
  'sovera-gaddy':'/cards/food-wheel.png','sovera-food':'/cards/food-wheel.png',
  'night-food':'/cards/food-wheel.png','greedy-wheel':'/cards/greedy-wheel.webp',
  'fruit-royale':'/cards/fruit-machine.jpg','jackpot-fruit':'/cards/jackpot-fruit.png'
 };
 const shortNames={
  'royal-ace':'SuperAce Deluxe','cleopatra':'Cleopatra Gold',
  'greedy-classic':'Greedy Game','food-deluxe':'Food Wheel',
  'sovera-gaddy':'Sovera Gaddy','sovera-food':'Sovera Food',
  'night-food':'Night Food','greedy-wheel':'Greedy Wheel',
  'fruit-royale':'Fruit Royale','jackpot-fruit':'Fruit Jackpot'
 };
 const variants={
  'sovera-gaddy':{className:'theme-gaddy',label:'SOVERA GADDY'},
  'sovera-food':{className:'theme-sovera-food',label:'SOVERA FOOD'},
  'night-food':{className:'theme-night-food',label:'NIGHT FOOD'}
 };
 const badges={'royal-ace':'HOT','food-deluxe':'HOT','sovera-gaddy':'NEW',
  'greedy-classic':'NEW','jackpot-fruit':'NEW'};
 let games=[],active=null,number=0,gameVersion=0,practice=null,verifiedProfile=null;
 let winnerTimer=null;
 const seenWinners=new Set(),pending=new Map();

 function notify(message){banner.textContent=message;banner.hidden=!message;}
 function call(method,path,body){
  if(!bridge)return practice?practice.request(method,path,body):
    Promise.reject(Error('Open a free demo first.'));
  return new Promise((resolve,reject)=>{
   const id=String(++number);
   const timer=setTimeout(()=>{
    pending.delete(id);
    reject(Error('Game server timed out. Check the wallet before trying again.'));
   },19000);
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
 // Only public, expected profile image hosts; never allow file:, javascript:,
 // arbitrary tracking domains, query-based auth tokens or remote HTML.
 function safeAvatar(raw){
  if(typeof raw!=='string'||raw.length>2048)return '';
  try{
   const url=new URL(raw,API_ORIGIN);
   if(url.protocol!=='https:'||url.username||url.password)return '';
   const host=url.hostname.toLowerCase();
   if(host===new URL(API_ORIGIN).hostname){
    if(!/^\/api\/v1\/users\/[0-9]{6,12}\/avatar$/.test(url.pathname))return '';
   }else if(!['lh3.googleusercontent.com','firebasestorage.googleapis.com',
     'storage.googleapis.com'].includes(host))return '';
   return url.href;
  }catch{return ''}
 }
 function cleanProfile(data){
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const id=String(data.display_id||data.public_id||'');
  const name=typeof data.name==='string'?data.name.trim().slice(0,80):'';
  if(!name||!/^[0-9]{1,12}$/.test(id))return null;
  return {id,publicId:String(data.public_id||id),name,
    pic:safeAvatar(data.pic),coins:Number.isSafeInteger(data.coins)?data.coins:null};
 }
 function displayProfile(target,p){
  if(!target||!p)return;
  target.hidden=false;
  const name=target.querySelector('.profile-name'),id=target.querySelector('.profile-id');
  if(name)name.textContent=p.name;
  if(id)id.textContent='ID: '+p.id;
  const initial=target.querySelector('.avatar-initial'),image=target.querySelector('img');
  if(initial)initial.textContent=p.name.charAt(0).toUpperCase();
  if(image){
   image.hidden=!p.pic;
   image.removeAttribute('src');
   if(p.pic){
    image.onerror=()=>{image.hidden=true;};
    image.onload=()=>{image.hidden=false;};
    image.src=p.pic;
   }
  }
 }
 async function refreshProfile(){
  if(!bridge)return;
  const raw=await call('GET','/api/v1/me');
  const p=cleanProfile(raw);
  if(!p)throw Error('Sharika verified profile unavailable');
  verifiedProfile=p;
  displayProfile($('catalog-profile'),p);
  displayProfile($('game-profile'),p);
 }
 function verifiedUser(){
  if(!verifiedProfile)return null;
  return {id:verifiedProfile.publicId,public_id:verifiedProfile.publicId,
    display_id:verifiedProfile.id,name:verifiedProfile.name,
    avatar:verifiedProfile.pic,pic:verifiedProfile.pic};
 }
 function addUserToGameState(data){
  if(!bridge||!verifiedProfile||!data||typeof data!=='object'||Array.isArray(data))
    return data;
  const u=verifiedUser();
  return {...data,
    user:{...(data.user&&typeof data.user==='object'?data.user:{}),...u},
    profile:u};
 }
 const compact=(name,id)=>inRoom?(shortNames[id]||name):name;
 function displayCards(catalog,enabled){
  all.replaceChildren();
  for(const g of catalog){
   if(!/^[a-z-]+$/.test(g.id)||!/^\/games\/[a-z0-9/_?=.&-]+$/.test(g.asset))continue;
   const usable=!bridge||enabled.has(g.id);
   const button=document.createElement('button');
   button.type='button';button.className='tile';button.disabled=!usable;
   button.setAttribute('aria-label',g.name+(usable?' · Play':' · Unavailable'));
   button.title=g.name;
   const art=document.createElement('span');
   art.className='art'+(variants[g.id]?' '+variants[g.id].className:'');
   const image=document.createElement('img');
   image.src=artworks[g.id]||'/cards/food-wheel.png';
   image.alt=g.name+' original game artwork';image.loading='eager';
   image.decoding='async';art.append(image);
   if(variants[g.id]){
    const label=document.createElement('span');
    label.className='theme-title';label.textContent=variants[g.id].label;
    art.append(label);
   }
   if(badges[g.id]){
    const ribbon=document.createElement('span');
    ribbon.className='badge-ribbon'+(badges[g.id]==='HOT'?' hot':'');
    ribbon.textContent=badges[g.id];art.append(ribbon);
   }
   const meta=document.createElement('span');meta.className='meta';
   const title=document.createElement('b');title.textContent=compact(g.name,g.id);
   const subtitle=document.createElement('small');
   subtitle.textContent=bridge
    ?usable?g.category+' · Server Game':'Unavailable in this build'
    :g.category+' · Free Demo';
   meta.append(title,subtitle);button.append(art,meta);
   button.addEventListener('click',()=>openGame(g));
   all.append(button);
  }
 }
 function clearWinner(){
  if(winnerTimer!==null){clearTimeout(winnerTimer);winnerTimer=null}
  $('verified-winner').hidden=true;
 }
 function showWinner(winner,key){
  if(!bridge||!winner||typeof winner!=='object'||!key||seenWinners.has(key))return;
  const win=Number(winner.win??winner.total_win??winner.totalWin??0);
  const name=typeof winner.name==='string'?winner.name.trim().slice(0,80):'';
  const id=String(winner.public_id||winner.userId||winner.id||'');
  if(!name||!Number.isSafeInteger(win)||win<=0||!/^[0-9]{1,12}$/.test(id))return;
  seenWinners.add(key);
  if(seenWinners.size>150)seenWinners.clear();
  clearWinner();
  $('winner-name').textContent=name;
  $('winner-id').textContent='ID: '+id;
  $('winner-amount').textContent='+'+win.toLocaleString('en-US');
  const image=$('winner-avatar'),first=$('winner-initial');
  first.textContent=name[0].toUpperCase();
  image.removeAttribute('src');image.hidden=true;
  const src=safeAvatar(winner.pic||winner.avatar||'');
  if(src){
   image.onerror=()=>{image.hidden=true;first.hidden=false;};
   image.onload=()=>{image.hidden=false;first.hidden=true;};
   first.hidden=false;image.src=src;
  }else first.hidden=false;
  $('verified-winner').hidden=false;
  winnerTimer=setTimeout(()=>{$('verified-winner').hidden=true;winnerTimer=null;},5500);
 }
 function showServerWinners(game,data){
  if(!bridge||!game||!data||typeof data!=='object')return;
  const candidates=[data.previous_result,data.current_result,data.result,data];
  for(const candidate of candidates){
   if(!candidate||typeof candidate!=='object')continue;
   const list=Array.isArray(candidate.top_winners)?candidate.top_winners:
    Array.isArray(candidate.top)?candidate.top:
    Array.isArray(candidate.winners)?candidate.winners:null;
   if(!list||!list.length)continue;
   const round=String(candidate.round_no||candidate.round||data.round?.round_no||'');
   const winner=list[0];
   const id=String(winner?.public_id||winner?.userId||winner?.id||'');
   if(id&&round){
    showWinner(winner,game.id+':'+round+':'+id);
    return;
   }
  }
 }
 function showSoloSpinWinner(game,receipt,requestId){
  if(!bridge||!verifiedProfile||!receipt||!game||!requestId)return;
  // Only an accepted, authenticated, settled POST /spin response qualifies.
  if(receipt.requestId!==requestId||!Number.isSafeInteger(receipt.balance)||
    !Number.isSafeInteger(receipt.win)||receipt.win<=0)return;
  showWinner({name:verifiedProfile.name,pic:verifiedProfile.pic,
    public_id:verifiedProfile.id,win:receipt.win},
    game.id+':confirmed-spin:'+requestId);
 }
 function closeGame(){
  gameVersion++;active=null;practice=null;frame.removeAttribute('src');
  clearWinner();player.hidden=true;landing.hidden=false;
  $('back').hidden=true;notify('');window.scrollTo(0,0);
 }
 function openGame(game){
  gameVersion++;active=game;
  practice=bridge?null:window.createSharikaPractice(game.id);
  landing.hidden=true;player.hidden=false;$('back').hidden=false;
  $('game-name').textContent=game.name;
  $('play-label').textContent=bridge?'Cloudflare server · Verified virtual coins':
    'Free browser practice · No wallet or real server settlement';
  $('demo-banner').hidden=!!bridge;
  $('game-profile').hidden=!verifiedProfile;
  clearWinner();notify('');
  // In-room games use only the existing 58%-tall Android Dialog. The voice
  // room is still visible above it; NEVER start an expanded Android Activity.
  const hostedSlot=game.id==='royal-ace'||game.id==='cleopatra';
  const serverMode=!!bridge||game.id==='royal-ace';
  const params=hostedSlot?'mode='+(inRoom?'room':'full')+'&host='+(serverMode?'1':'0'):
    game.id==='greedy-wheel'&&inRoom?'sheet=1':'';
  const separator=params?(game.asset.includes('?')?'&':'?'):'';
  frame.src=game.asset+separator+params+((game.id==='sovera-gaddy'||game.id==='greedy-classic')&&inRoom?
    '#sharika-room':'');
 }
 $('exit').addEventListener('click',closeGame);
 $('back').addEventListener('click',closeGame);
 window.addEventListener('message',async e=>{
  const game=active;
  // Each child iframe has a sandboxed, opaque origin. Verify actual message
  // source window and never interpret untrusted child-supplied profile/win.
  if(!game||e.origin!=='null'||e.source!==frame.contentWindow)return;
  const m=e.data,version=gameVersion;
  if(!m||typeof m!=='object')return;
  const send=data=>{if(active===game&&version===gameVersion)
    frame.contentWindow?.postMessage(data,'*')};
  if(m.type==='sharika:original-exit'||m.type==='close'&&game.id==='royal-ace'){
   closeGame();return;
  }
  // Ignore iframe-driven full-screen requests. Half-screen mode is native.
  if(m.type==='expand')return;
  const royal=game.id==='royal-ace',cleo=game.id==='cleopatra';
  if(royal||cleo){
   if(royal&&m.source!=='sharika-royal-ace')return;
   const prefix=royal?'/api/v1/royal-ace':'/api/v1/cleopatra';
   const source=royal?{source:'sharika-royal-ace-server'}:{};
   if(m.type==='ready'){
    try{
     const state=await call('GET',prefix+'/state');
     send({type:'init',...source,...addUserToGameState(state)});
    }catch(error){
     send({type:'gameError',...source,error:error.message});
     notify('Game unavailable: '+error.message);
    }
   }else if(m.type==='spin'&&typeof m.id==='string'&&/^[a-zA-Z0-9_-]{12,100}$/.test(m.id)&&
    Number.isSafeInteger(m.bet)&&m.bet>0&&(!royal||typeof m.buy==='boolean')){
    try{
     const result=await call('POST',prefix+'/spin',
      {bet:m.bet,requestId:m.id,...(royal?{buy:m.buy}:{})});
     send({type:'spinResult',id:m.id,...source,...result});
     if(active===game&&version===gameVersion)showSoloSpinWinner(game,result,m.id);
    }catch(error){
     send({type:'spinResult',id:m.id,...source,error:error.message});
    }
   }
   return;
  }
  if(game.id==='greedy-wheel'){
   if(m.source==='greedy-game'&&m.type==='close'){closeGame();return;}
   if(m.type!=='sharika:greedy-request'||!Number.isSafeInteger(m.id)||m.id<1||
    !['state','bet','records'].includes(m.action))return;
   const method=m.action==='bet'?'POST':'GET';
   try{
    const data=await call(method,'/api/v1/greedy-wheel/'+m.action,
     m.action==='bet'?m.body:null);
    send({type:'sharika:greedy-response',id:m.id,ok:true,
     value:m.action==='state'?addUserToGameState(data):data});
    if(m.action==='state'&&active===game&&version===gameVersion)
     showServerWinners(game,data);
   }catch(error){
    send({type:'sharika:greedy-response',id:m.id,ok:false,error:error.message});
   }
   return;
  }
  if(m.type!=='sharika:original-request'||m.game!==game.id||
    !Number.isSafeInteger(m.id)||m.id<1||
    !['state','history','stats','rankings','bet'].includes(m.action))return;
  const method=m.action==='bet'?'POST':'GET';
  if(m.method!==method)return;
  let query='';
  if(m.action==='rankings'&&m.query&&['daily','weekly','monthly'].includes(m.query.period)&&
   ['totalWin','totalBet','profitLoss','winCount'].includes(m.query.metric))
   query='?period='+m.query.period+'&metric='+m.query.metric;
  try{
   const result=await call(method,'/api/v1/original-games/'+game.id+'/'+m.action+query,
    method==='POST'?m.body:null);
   const value=m.action==='state'?addUserToGameState(result):result;
   send({type:'sharika:original-response',id:m.id,ok:true,value});
   if(m.action==='state'&&active===game&&version===gameVersion)
    showServerWinners(game,result);
  }catch(error){
   send({type:'sharika:original-response',id:m.id,ok:false,error:error.message});
  }
 });
 async function start(){
  try{
   const response=await fetch('/api/catalog',{cache:'no-store'});
   if(!response.ok)throw Error('Catalog unavailable');
   const data=await response.json();games=data.games||[];
   if(!bridge){
    status.textContent='Tap a game for a free browser demo; no Sharika coins are used.';
    browserNote.hidden=false;
    displayCards(games,new Set(games.map(g=>g.id)));
    return;
   }
   // This is the same authenticated /me profile used by the main room, not a
   // game iframe name or query-string avatar. Fail closed if the profile fails.
   await refreshProfile();
   const result=await call('GET','/api/v1/game-catalog');
   const enabled=new Set((result.games||[]).filter(x=>x.enabled===true).map(x=>x.id));
   displayCards(games,enabled);
   status.textContent=enabled.size?'Connected to Sharika staging · '+enabled.size+' server-enabled games':
    'No games are enabled for this account.';
  }catch(error){
   status.textContent='Could not verify game access: '+error.message;
   displayCards(games,new Set());
  }
 }
 start();
})();
