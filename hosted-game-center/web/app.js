/* The hosted site receives no Firebase token. Only the Android app can attach
   the origin-scoped, main-frame-only SharikaGameBridge. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const bridge=window.SharikaGameBridge||null;
 const all=$('games'),landing=$('landing'),player=$('player'),frame=$('game-frame');
 const status=$('status'),banner=$('error'),browserNote=$('browser-note');
 const icons={'royal-ace':'♠','cleopatra':'♛','greedy-classic':'✦','food-deluxe':'◈','sovera-gaddy':'◆','sovera-food':'🍔','night-food':'☾','greedy-wheel':'◎','fruit-royale':'🍒','jackpot-fruit':'🍓'};
 let games=[],active=null,number=0;
 const pending=new Map();
 function notify(message){banner.textContent=message;banner.hidden=!message;}
 function call(method,path,body){
  if(!bridge)return Promise.reject(Error('Open Sharika staging app to play.'));
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
   const usable=enabled.has(g.id);
   const button=document.createElement('button');button.type='button';
   button.className='tile';button.disabled=!usable;
   const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=icons[g.id]||'✦';
   const meta=document.createElement('span');meta.className='meta';
   const title=document.createElement('b');title.textContent=g.name;
   const label=document.createElement('small');label.textContent=usable?g.category+' · Play':'Unavailable in this build';
   meta.append(title,label);button.append(symbol,meta);
   button.addEventListener('click',()=>openGame(g));
   all.append(button);
  }
 };
 function closeGame(){
  active=null;frame.removeAttribute('src');player.hidden=true;landing.hidden=false;
  $('back').hidden=true;notify('');window.scrollTo(0,0);
 }
 function openGame(game){
  if(!bridge)return;
  active=game;landing.hidden=true;player.hidden=false;$('back').hidden=false;
  $('game-name').textContent=game.name;notify('');
  frame.src=game.asset+(game.id==='royal-ace'||game.id==='cleopatra'?
   (game.asset.includes('?')?'&':'?')+'mode=full&host=1':
   (game.id==='sovera-gaddy'?'#sharika-room':''));
 }
 $('exit').addEventListener('click',closeGame);
 $('back').addEventListener('click',closeGame);
 window.addEventListener('message',async e=>{
  const game=active;
  if(!game||e.origin!==location.origin||e.source!==frame.contentWindow)return;
  const m=e.data;
  if(!m||typeof m!=='object')return;
  const send=data=>{if(active===game)frame.contentWindow?.postMessage(data,location.origin)};
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
    status.textContent='Preview catalog. Sign in through the Sharika staging app to play with virtual coins.';
    browserNote.hidden=false;displayCards(games,new Set());return;
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
