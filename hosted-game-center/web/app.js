/* Sharika hosted Game Center. Site JS has NO Firebase token. Only the
 * main-frame, origin-scoped Android message bridge can invoke D1 APIs.
 * Game iframes have opaque origins and cannot access that bridge. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const bridge=window.SharikaGameBridge||null;
 const params=new URLSearchParams(location.search);
 const inRoom=params.get('view')==='room';
 // surface=app affects presentation only. It never grants server or wallet
 // access: the authenticated origin-scoped Android bridge remains mandatory.
 const appSurface=params.get('surface')==='app';
 if(inRoom)document.documentElement.classList.add('room-mode');
 if(appSurface)document.documentElement.classList.add('app-surface');
 if(!inRoom&&!appSurface)document.documentElement.classList.add('premium-browser');
 if(appSurface&&bridge)document.documentElement.classList.add('native-verified');
 const all=$('games'),landing=$('landing'),player=$('player'),frame=$('game-frame');
 const status=$('status'),banner=$('error'),browserNote=$('browser-note');
 const hot=$('hot-section'),hotGames=$('hot-games'),search=$('game-search');
 const hero=$('royal-hero'),toolbarCount=$('toolbar-count');
 const API_ORIGIN='https://sharika-api-staging.soverixnet.workers.dev';
 const artworks={
  'royal-slots':'/cards/royal-slots.webp',
  'royal-ace':'/cards/superace.svg','cleopatra':'/cards/cleopatra.jpg',
  'greedy-classic':'/cards/greedy.jpg','food-deluxe':'/cards/fruit-machine.jpg',
  'sovera-gaddy':'/cards/gaddy-royal.svg','sovera-food':'/cards/sovera-food-royal.svg',
  'night-food':'/cards/night-food-royal.svg','greedy-wheel':'/cards/greedy-wheel-royal.svg',
  'fruit-royale':'/cards/fruit-machine.jpg','jackpot-fruit':'/cards/jackpot-fruit.png'
 };
 const shortNames={
  'royal-slots':'Royal Slots',
  'royal-ace':'SuperAce Deluxe','cleopatra':'Cleopatra Gold',
  'greedy-classic':'Greedy Game','food-deluxe':'Fruit Machine',
  'sovera-gaddy':'Sovera Gaddy','sovera-food':'Sovera Food',
  'night-food':'Night Food','greedy-wheel':'Greedy Wheel',
  'fruit-royale':'Fruit Royale','jackpot-fruit':'Fruit Jackpot'
 };
 const variants={
  'sovera-gaddy':{className:'theme-gaddy',label:'SOVERA GADDY'},
  'sovera-food':{className:'theme-sovera-food',label:'SOVERA FOOD'},
  'night-food':{className:'theme-night-food',label:'NIGHT FOOD'}
 };
 const badges={'royal-slots':'NEW','royal-ace':'HOT','food-deluxe':'HOT','sovera-gaddy':'NEW',
  'greedy-classic':'NEW','jackpot-fruit':'NEW'};
 let games=[],active=null,number=0,gameVersion=0,practice=null,verifiedProfile=null;
 let winnerTimer=null, winnerShowing=false;
 const winnerQueue=[];
 const seenWinners=new Set(),pending=new Map();
 let globalWinnerFeedInitialized=false,globalWinnerLastId=0,globalWinnerBusy=false;
 // A top-level ticker survives opening/closing games and is not clipped by
 // the game's own full-height iframe. It works in room and outside-room modes.
 document.body.append($('verified-winner'));

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
 const compact=(name,id)=>id==='food-deluxe'?'Fruit Machine':inRoom?(shortNames[id]||name):name;
 function renderFeatured(catalog,enabled){
  hotGames.replaceChildren();
  if(inRoom){hot.hidden=true;hero.hidden=true;return;}
  hero.hidden=false;
  const order=['royal-slots','royal-ace','cleopatra','greedy-classic','food-deluxe'];
  let count=0;
  for(const id of order){
   const g=catalog.find(item=>item.id===id);
   if(!g||!(enabled.has(id)||!bridge))continue;
   const button=document.createElement('button');
   button.type='button';button.className='featured-game';
   // Use a distinct accessible name to avoid duplicate game-card actions.
   button.setAttribute('aria-label','Play featured game '+(++count));
   const art=document.createElement('span');art.className='featured-art';
   const picture=document.createElement('img');
   picture.src=artworks[id]||'/cards/food-wheel.png';picture.alt='';
   picture.loading='eager';picture.decoding='async';
   art.append(picture);
   const name=document.createElement('b');name.textContent=shortNames[id]||g.name;
   button.append(art,name);
   button.addEventListener('click',()=>openGame(g));
   hotGames.append(button);
   if(count===3)break;
  }
  hot.hidden=count===0;
 }
 function filterCatalog(){
  const query=(search?.value||'').trim().toLocaleLowerCase('en');
  let visible=0;
  for(const tile of all.querySelectorAll('.tile')){
   const match=!query||tile.dataset.search?.includes(query);
   tile.hidden=!match;
   if(match)visible++;
  }
  $('no-games').hidden=visible>0;
  if(!inRoom){
   hot.hidden=!!query||hotGames.childElementCount===0;
   hero.hidden=!!query;
  }
 }
 function displayCards(catalog,enabled){
  all.replaceChildren();
  for(const g of catalog){
   if(!/^[a-z-]+$/.test(g.id)||!/^\/games\/[a-z0-9/_?=.&-]+$/.test(g.asset))continue;
   const usable=!bridge||enabled.has(g.id);
   const button=document.createElement('button');
   button.type='button';button.className='tile';button.disabled=!usable;
   button.dataset.search=[g.name,shortNames[g.id]||'',g.category||''].join(' ').toLocaleLowerCase('en');
   const visibleName=compact(g.name,g.id);
   button.setAttribute('aria-label',visibleName+(usable?' · Play':' · Unavailable'));
   button.title=visibleName;
   const art=document.createElement('span');
   art.className='art'+(variants[g.id]?' '+variants[g.id].className:'');
   const image=document.createElement('img');
   image.src=artworks[g.id]||'/cards/food-wheel.png';
   image.alt=visibleName+' game artwork';image.loading=inRoom?'eager':'lazy';
   image.decoding='async';art.append(image);
   // The same original artwork supplies a subtle square backdrop for the
   // few landscape cards. Foreground artwork stays uncropped.
   art.style.setProperty('--art-url','url("'+image.src+'")');
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
   const title=document.createElement('b');title.textContent=visibleName;
   const subtitle=document.createElement('small');
   subtitle.textContent=bridge
    ?usable?g.category+' · Server Game':'Unavailable in this build'
    :g.category+' · Free Demo';
   meta.append(title,subtitle);button.append(art,meta);
   button.addEventListener('click',()=>openGame(g));
   all.append(button);
  }
  renderFeatured(catalog,enabled);
  filterCatalog();
 }
 function clearWinner(){
  if(winnerTimer!==null)clearTimeout(winnerTimer);
  winnerTimer=null;winnerShowing=false;winnerQueue.length=0;
  $('verified-winner').hidden=true;
 }
 function showNextWinner(){
  if(winnerShowing||!winnerQueue.length)return;
  const {winner,name,id,win,gameId}=winnerQueue.shift();
  winnerShowing=true;
  $('winner-name').textContent=name;
  $('winner-id').textContent='ID: '+id;
  $('winner-amount').textContent='+'+win.toLocaleString('en-US')+' COINS';
  const logo=$('winner-game-icon'),asset=artworks[gameId]||'';
  logo.hidden=!asset;
  if(asset)logo.src=asset;else logo.removeAttribute('src');
  const image=$('winner-avatar'),first=$('winner-initial');
  first.textContent=name[0].toUpperCase();first.hidden=false;
  image.removeAttribute('src');image.hidden=true;
  const src=safeAvatar(winner.pic||winner.avatar||'');
  if(src){
   image.onerror=()=>{image.hidden=true;first.hidden=false;};
   image.onload=()=>{image.hidden=false;first.hidden=true;};
   image.src=src;
  }
  const ticker=$('verified-winner');
  ticker.hidden=false;
  ticker.style.animation='none';
  void ticker.offsetWidth;
  ticker.style.animation='';
  winnerTimer=setTimeout(()=>{
   winnerTimer=null;winnerShowing=false;ticker.hidden=true;
   showNextWinner();
  },10000);
 }
 function showWinner(winner,key,gameId=active?.id||'greedy-classic'){
  // Room mode uses the Activity's native ticker at the true top of screen.
  // Do not overlay a second winner banner inside the bottom-sheet WebView.
  if(inRoom||!bridge||!winner||typeof winner!=='object'||!key||seenWinners.has(key))return;
  const win=Number(winner.win??winner.total_win??winner.totalWin??0);
  const name=typeof winner.name==='string'?winner.name.trim().slice(0,80):'';
  const id=String(winner.public_id||winner.userId||winner.id||'');
  if(!name||!Number.isSafeInteger(win)||win<=0||!/^[0-9]{1,12}$/.test(id))return;
  seenWinners.add(key);
  if(seenWinners.size>500)seenWinners.clear();
  winnerQueue.push({winner,name,id,win,gameId});
  showNextWinner();
 }
 async function pollGlobalFoodWinners(){
  if(inRoom||!bridge||globalWinnerBusy||document.visibilityState==='hidden')return;
  globalWinnerBusy=true;
  try{
   const result=await call('GET','/api/v1/original-games/greedy-classic/winners');
   const list=Array.isArray(result?.winners)?result.winners:[];
   const fresh=list.filter(x=>Number.isSafeInteger(Number(x.id))&&Number(x.id)>globalWinnerLastId);
   for(const x of fresh)globalWinnerLastId=Math.max(globalWinnerLastId,Number(x.id));
   if(globalWinnerFeedInitialized){
    for(const x of fresh.sort((a,b)=>Number(a.id)-Number(b.id))){
     const publicId=String(x.userId||x.public_id||'');
     showWinner(x,'greedy-classic:'+String(x.round||'')+':'+publicId+':'+x.win,'greedy-classic');
    }
   }
   globalWinnerFeedInitialized=true;
  }catch{/* A network or authentication failure must not fabricate a winner. */}
  finally{globalWinnerBusy=false}
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
    showWinner(winner,game.id+':'+round+':'+id+':'+(winner.win||0),game.id);
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
    game.id+':confirmed-spin:'+requestId,game.id);
 }
 function closeGame(){
  gameVersion++;active=null;practice=null;frame.removeAttribute('src');
  player.hidden=true;landing.hidden=false;
  document.body.classList.remove('is-playing');
  $('back').hidden=true;notify('');window.scrollTo(0,0);
 }
 function openGame(game){
  gameVersion++;active=game;
  practice=bridge?null:window.createSharikaPractice(game.id);
  landing.hidden=true;player.hidden=false;$('back').hidden=false;
  document.body.classList.add('is-playing');
  $('game-name').textContent=game.name;
  $('play-label').textContent=bridge?'Cloudflare server · Verified virtual coins':
    'Free browser practice · No wallet or real server settlement';
  $('demo-banner').hidden=!!bridge;
  $('game-profile').hidden=!verifiedProfile;
  notify('');
  // In-room games use only the existing 65%-tall Android Dialog. The voice
  // room is still visible above it; NEVER start an expanded Android Activity.
  const hostedSlot=game.id==='royal-ace'||game.id==='cleopatra'||game.id==='royal-slots';
  const serverMode=!!bridge||game.id==='royal-ace';
  const params=game.id==='royal-slots'?'mode='+(bridge?'production':'demo'):
    hostedSlot?'mode='+(inRoom?'room':'full')+'&host='+(serverMode?'1':'0'):
    game.id==='greedy-wheel'&&inRoom?'sheet=1':'';
  const separator=params?(game.asset.includes('?')?'&':'?'):'';
  frame.src=game.asset+separator+params+((game.id==='sovera-gaddy'||game.id==='greedy-classic')&&inRoom?
    '#sharika-room':'');
 }
 // System Back first closes the game, then the native Activity.
 window.sharikaPremiumBack=()=>{if(!active)return false;closeGame();return true;};
 $('exit').addEventListener('click',closeGame);
 $('back').addEventListener('click',closeGame);
 search.addEventListener('input',filterCatalog);
 $('app-return').addEventListener('click',()=>{
  if(!bridge){window.history.back();return;}
  // Close only this native Activity. The secure WebViewClient checks the
  // exact app-only scheme and main frame before closing.
  location.href='sharika-app://close';
 });
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
  if(game.id==='royal-slots'){
   if(m.source!=='sharika-royal-slots')return;
   if(m.type==='close'){closeGame();return;}
   if(!bridge)return; // browser practice runs entirely inside the iframe
   if(m.type==='ready'){
    try{
     const state=await call('GET','/api/v1/royal-slots/state');
     send({source:'sharika-royal-slots-server',type:'init',
       ...addUserToGameState(state),profile:verifiedUser()});
    }catch(error){
     const reason=String(error?.message||error).slice(0,180);
     notify('Royal Slots unavailable: '+reason);
     send({source:'sharika-royal-slots-server',type:'initError',error:reason});
    }
   }else if(m.type==='spin'&&typeof m.id==='string'&&
     /^[A-Za-z0-9_-]{12,100}$/.test(m.id)&&
     [1000,10000,100000,1000000,10000000].includes(m.bet)&&
     typeof m.freeSpin==='boolean'){
    try{
     // Retry only unknown-commit network errors, with the ORIGINAL idempotent
     // requestId. Reusing this exact ID prevents double wallet deductions.
     const payload={bet:m.bet,requestId:m.id,freeSpin:m.freeSpin};
     const attempt=()=>call('POST','/api/v1/royal-slots/spin',payload);
     let result;
     try{result=await attempt()}
     catch(error){
      const reason=String(error?.message||error);
      const uncertain=/timed out|network_unavailable|firebase_token_unavailable|http_(502|503|504)|temporarily unavailable/i.test(reason);
      if(!uncertain||active!==game||version!==gameVersion)throw error;
      result=await attempt();
     }
     send({source:'sharika-royal-slots-server',type:'spinResult',id:m.id,result});
     if(active===game&&version===gameVersion)
       showSoloSpinWinner(game,{...result,win:result.totalWin},m.id);
    }catch(error){send({source:'sharika-royal-slots-server',
      type:'spinResult',id:m.id,error:String(error?.message||error).slice(0,180)});}
   }
   return;
  }
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
    !['state','history','stats','rankings','bet','winners'].includes(m.action))return;
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
 // Poll only authenticated, verified wins; no local RNG or fake banners.
 if(bridge){
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollGlobalFoodWinners();});
  setInterval(pollGlobalFoodWinners,6500);
  pollGlobalFoodWinners();
 }
 async function start(){
  try{
   // Safe, independent read operations run concurrently. Game actions
   // still require the verified main-frame native bridge.
   const [response]=await Promise.all([
    fetch('/api/catalog',{cache:'no-store'}),
    bridge?refreshProfile():Promise.resolve()
   ]);
   if(!response.ok)throw Error('Catalog unavailable');
   const data=await response.json();games=data.games||[];
   // The website controls which separate sections are visible. Never add
   // unavailable Ranking/Event/Wallet links to the user's navigation.
   const sectionResponse=await fetch('/api/center/manifest',{cache:'no-store',credentials:'same-origin'});
   if(!sectionResponse.ok)throw Error('Private Center session expired');
   const sections=await sectionResponse.json();
   const centerLink=$('private-center-link');
   if(centerLink)centerLink.hidden=!((sections.rankings||[]).length||
     (sections.events||[]).length||(sections.modules||[]).length);
   if(!bridge){
    status.textContent='Free browser demo · virtual coins only';
    browserNote.hidden=true;
    displayCards(games,new Set(games.map(g=>g.id)));
    $('game-count').textContent=games.length+' games';
    toolbarCount.textContent=games.length+' Games';
    return;
   }
   // This is the same authenticated /me profile used by the main room, not a
   // game iframe name or query-string avatar. Fail closed if the profile fails.
   // Both the private site catalogue AND the authenticated app manifest
   // must publish a game. Hidden entries are removed, not greyed out.
   const result=await call('GET','/api/v1/center/manifest');
   const visible=new Set((result.games||[]).map(x=>x.id));
   games=games.filter(x=>visible.has(x.id));
   displayCards(games,visible);
   $('game-count').textContent=games.length+' games';
   toolbarCount.textContent=games.length+' Games';
   status.textContent=games.length?'Published games ready':'No games are published for this account.';
   // Do not show diagnostic text over the gameplay UI.
   status.hidden=appSurface&&games.length>0;
  }catch(error){
   status.hidden=false;
   status.textContent='Could not verify game access: '+error.message;
   $('game-count').textContent='Unavailable';
   toolbarCount.textContent='Unavailable';
   displayCards(games,new Set());
  }
 }
 start();
})();
