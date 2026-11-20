(()=>{'use strict';
const $=id=>document.getElementById(id);
const content=$('content'),tabs=$('tabs'),status=$('status'),overview=$('overview');
let manifest=null,admin=null,current='';
const nice=n=>(Number(n)||0).toLocaleString('en-US');
function el(tag,klass,txt){const node=document.createElement(tag);
 if(klass)node.className=klass;if(txt!==undefined)node.textContent=String(txt);return node;}
function errMessage(e){return String(e?.message||e||'Unavailable').slice(0,150);}
async function request(path,options={}){
 const method=options.method||'GET';
 const headers=method==='GET'?{}:{'content-type':'application/json','x-sharika-center':'1'};
 const response=await fetch('/api/center/'+path,{
  method,headers,credentials:'same-origin',cache:'no-store',
  ...(options.body?{body:JSON.stringify(options.body)}:{})
 });
 const data=await response.json().catch(()=>({error:'invalid_server_response'}));
 if(!response.ok)throw new Error(data.error||'request_failed');
 return data;
}
async function endpoint(path){
 const response=await fetch('/api/center/'+path,{credentials:'same-origin',cache:'no-store'});
 const data=await response.json().catch(()=>({error:'invalid_response'}));
 if(!response.ok)throw new Error(data.error||'unavailable');
 return data;
}
function heading(title,sub=''){const h=el('div','section-title');
 h.append(el('h2','',title),el('small','',sub));content.append(h);}
function empty(text){content.append(el('div','empty',text));}
function published(kind){return (manifest?.[kind]||[]);}
function buildTabs(){
 const menu=[];
 if(published('games').length)menu.push(['games','🎮 Games']);
 if(published('rankings').length)menu.push(['rankings','🏆 Rankings']);
 if(published('events').length)menu.push(['events','✨ Events']);
 if(published('modules').some(x=>x.id==='wallet'))menu.push(['wallet','🪙 Wallet']);
 if(published('modules').some(x=>x.id==='gifts'))menu.push(['gifts','🎁 Gifts']);
 if(published('modules').some(x=>x.id==='assets'))menu.push(['assets','👑 Frames']);
 if(admin)menu.push(['admin','⚙️ Admin']);
 tabs.replaceChildren();
 for(const [id,label] of menu){const b=el('button','',label);b.type='button';b.dataset.tab=id;
  b.setAttribute('aria-selected',String(current===id));
  b.onclick=()=>{current=id;buildTabs();render();};tabs.append(b);}
 if(!menu.find(x=>x[0]===current))current=menu[0]?.[0]||'';
 for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.tab===current));
}
function showGames(){
 heading('Published Games',published('games').length+' available');
 const list=el('div','grid');
 for(const g of published('games')){
  const box=el('article','item');
  box.append(el('div','big-icon','♛'),el('h3','',g.title),
    el('p','','Verified Sharika game · Virtual coins only'));
  const a=el('a','launch','Open Games');
  a.href='/?surface=app';box.append(a);list.append(box);
 }
 content.append(list);
}
function avatar(p){
 const img=el('img','avatar');img.alt='';img.loading='lazy';img.decoding='async';
 const raw=String(p?.pic||'');
 try{const url=new URL(raw);if(url.protocol==='https:')img.src=url.href;}catch(_){}
 img.onerror=()=>{img.style.display='none'};
 return img;
}
async function showRankings(){
 heading('Royal Rankings','Verified results only');
 const select=el('select');select.setAttribute('aria-label','Ranking category');
 for(const x of published('rankings')){
  const opt=el('option','',x.title);opt.value=x.id;select.append(opt);
 }
 const period=el('select');period.setAttribute('aria-label','Ranking period');
 for(const [val,title] of [['daily','Today'],['weekly','This Week'],['monthly','This Month']]){
  const opt=el('option','',title);opt.value=val;period.append(opt);}
 const holder=el('div');const controls=el('div','form-row');controls.append(select,period);
 content.append(controls,holder);
 async function load(){
  holder.replaceChildren(el('div','muted','Loading verified leaderboard…'));
  try{
   const data=await endpoint('rankings?kind='+encodeURIComponent(select.value)+
    '&period='+encodeURIComponent(period.value));
   holder.replaceChildren();
   const leaders=Array.isArray(data.leaders)?data.leaders:[];
   const units=data.unit==='salary coins'?'salary coins':'coins';
   if(!leaders.length){holder.append(el('div','empty','No confirmed ranking results in this period.'));return;}
   const podium=el('div','podium');
   for(let i=0;i<Math.min(3,leaders.length);i++){
    const v=leaders[i],c=el('div','champ');
    c.append(el('div','medal',['♛','◆','✦'][i]));
    if(v.pic)c.append(avatar(v));
    c.append(el('strong','',v.name||'Member'),el('small','',nice(v.total)+' '+units));
    podium.append(c);
   }
   holder.append(podium);
   const list=el('div','leaderboard');
   for(let i=0;i<leaders.length;i++){
    const v=leaders[i],line=el('div','leader');
    line.append(el('span','num',i+1));
    if(v.pic)line.append(avatar(v));
    const main=el('div');main.append(el('strong','',v.name||'Member'),
      el('small','',String(v.display_id||v.room_id||'')));
    const amount=el('strong','',nice(v.total)+' '+units);amount.style.marginLeft='auto';
    line.append(main,amount);list.append(line);
   }
   holder.append(list);
  }catch(e){holder.replaceChildren(el('div','empty',errMessage(e)));}
 }
 select.onchange=load;period.onchange=load;load();
}
const EVENT_THEMES={
 royal_gold:{label:'Royal Gold',symbol:'♛',rank:'Gift Royalty'},
 diamond_luxury:{label:'Diamond Luxury',symbol:'◆',rank:'Diamond Champions'},
 game_tournament:{label:'Game Tournament',symbol:'⚔',rank:'Tournament Winners'},
 cp_love:{label:'CP Love Festival',symbol:'♥',rank:'Couple Ranking'},
 festival_special:{label:'Festival Special',symbol:'✦',rank:'Festival Ranking'}
};
const EVENT_SCORE_CAPTIONS={
 gift_points:'Points from selected, server-settled gifts',
 game_wins:'Verified game winnings credited by the server',
 cp_gifts:'Verified CP gifts scored as couples'
};
function eventTheme(event){return Object.hasOwn(EVENT_THEMES,event.template_id)?
 event.template_id:'royal_gold';}
function eventScore(event){return Object.hasOwn(EVENT_SCORE_CAPTIONS,event.scoring_mode)?
 event.scoring_mode:'gift_points';}
function changeEventLink(event){
 const url=new URL(location.href);
 url.searchParams.set('tab','events');
 if(event)url.searchParams.set('event',String(event.id));
 else url.searchParams.delete('event');
 history.replaceState(null,'',url.pathname+url.search);
}
function eventCountdown(iso,prefix='Ends in'){
 const ms=Date.parse(iso)-Date.now();
 if(!Number.isFinite(ms)||ms<=0)return 'Finished';
 const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);
 const m=Math.floor(ms%3600000/60000);
 return prefix+' '+(d?d+'d ':'')+h+'h '+m+'m';
}
function eventPhase(e){
 if(Date.parse(e.starts_at)>Date.now())return 'UPCOMING';
 if(Date.parse(e.ends_at)<=Date.now())return 'ENDED';
 return 'LIVE NOW';
}
function eventTimeLabel(e){
 return eventPhase(e)==='UPCOMING'?
   eventCountdown(e.starts_at,'Starts in'):eventCountdown(e.ends_at);
}
function eventAudienceLabel(event){
 const value=String(event.country_code||'GLOBAL').toUpperCase();
 return value==='GLOBAL'?'Global event':value==='BD'?'Bangladesh event':'Country event · '+value;
}
function eventPoster(event,compact=false){
 // Only the server-authorized, first-party event endpoint may supply artwork.
 const root=el('div','event-poster event-theme--'+eventTheme(event)+(compact?' compact':''));
 const safeImage='/api/center/events/'+Number(event.id)+'/banner';
 if(event.banner_url&&event.banner_url.startsWith(safeImage+'?v=')){
  const photo=el('img','event-artwork');
  photo.loading='lazy';photo.alt='';photo.decoding='async';
  photo.referrerPolicy='no-referrer';photo.src=event.banner_url;
  photo.onerror=()=>photo.remove();
  root.append(photo);
 }
 const glow=el('div','event-poster-overlay');
 const crown=el('span','event-crown',EVENT_THEMES[eventTheme(event)].symbol);
 const title=el('strong','event-poster-title',event.title);
 const band=el('span','event-poster-band',event.kind.replaceAll('_',' ').toUpperCase()+' · '+eventAudienceLabel(event));
 glow.append(crown,title,band);root.append(glow);
 return root;
}
function eventRewardText(event,rank){
 const coins=rank<=3?Number(event.prizes?.[rank-1]||0):0;
 const item=String(event.reward_labels?.[rank-1]||'').trim();
 const description=/^(preview only|showcase only)/i.test(item)?'':item;
 const parts=[];
 if(Number.isFinite(coins)&&coins>0)parts.push(nice(coins)+' coins');
 if(description)parts.push(description.slice(0,80));
 return parts.join(' + ')||'Reward not configured';
}
function eventPrizeDetails(e){
 const panel=el('section','event-prizes event-theme--'+eventTheme(e));
 panel.append(el('h3','','Royal Event Rewards'));
 const explainer=el('p','muted','The Admin sets all event rewards. Coin prizes are paid only after verified results and Super Admin approval. Frame and medal descriptions do not automatically grant items.');
 panel.append(explainer);
 const grid=el('div','prize-grid');
 for(let rank=1;rank<=7;rank++){
  const item=el('div','prize-position'+(rank===1?' top-prize':'')+(rank>3?' supporting-prize':''));
  item.append(el('div','prize-medal',['♛','✦','◆','✧','✧','✧','✧'][rank-1]),
   el('strong','','TOP '+rank),
   el('span','event-prize-value',eventRewardText(e,rank)));
  grid.append(item);
 }
 panel.append(grid);return panel;
}
function showEvents(){
 changeEventLink(null);
 heading('Royal Events','Only approved active or upcoming events');
 const items=published('events');
 if(!items.length){empty('No events are currently published.');return;}
 const board=el('div','event-cards');
 for(const e of items){
  const card=el('article','event-feature event-theme--'+eventTheme(e));
  card.append(eventPoster(e,true));
  const details=el('div','event-feature-info');
  const heading=el('div','row');
  heading.append(el('span','pill',eventPhase(e)),
   el('span','event-timer',eventTimeLabel(e)));
  details.append(heading,el('h3','',e.title));
  const summary=el('p','muted',e.description||'Official Sharika limited-time event');
  details.append(summary,el('small','muted',eventAudienceLabel(e)));
  const configured=Array.from({length:7},(_,i)=>eventRewardText(e,i+1))
    .filter(value=>value!=='Reward not configured');
  details.append(el('span','event-feature-prizes',
    configured.length?'Top 1: '+eventRewardText(e,1)+' · '+configured.length+' reward tiers':'Rewards pending Admin configuration'));
  const button=el('button','action','View Event & Ranking');
  button.type='button';
  button.onclick=()=>showEventDetail(e);
  details.append(button);card.append(details);board.append(card);
 }
 content.append(board);
}
function showEventDetail(event){
 // A focused single-event screen: never insert unpublished cross-promotions.
 content.replaceChildren();status.textContent='';
 changeEventLink(event);
 const top=el('div','event-detail-top event-theme--'+eventTheme(event));
 const back=el('button','secondary','← All Events');back.type='button';
 back.onclick=showEvents;
 top.append(back,el('span','pill',eventPhase(event)));content.append(top);
 content.append(eventPoster(event));
 const section=el('section','event-detail-body event-theme--'+eventTheme(event));
 const heading=el('h2','',event.title);section.append(heading);
 section.append(el('p','event-date',eventAudienceLabel(event)+' · Starts: '+new Date(event.starts_at).toLocaleString()+
   ' · Ends: '+new Date(event.ends_at).toLocaleString()));
 const time=el('div','event-live-time',eventTimeLabel(event));
 section.append(time,el('p','event-description',event.description||
    'Only verified activity qualifies for this official Sharika event.'));
 section.append(eventPrizeDetails(event));
 const ranking=el('section','event-leaderboard');
 ranking.append(el('h3','',EVENT_THEMES[eventTheme(event)].rank));
 ranking.append(el('p','muted',EVENT_SCORE_CAPTIONS[eventScore(event)]));
 const loading=el('div','muted','Loading verified event ranking…');
 ranking.append(loading);section.append(ranking);content.append(section);
 const viewToken=Symbol('event');content._eventViewToken=viewToken;
 const path='events/'+Number(event.id)+'/ranking';
 async function loadRanking(){
  loading.textContent='Loading verified event ranking…';loading.remove();
  const spinner=el('div','muted','Loading verified event ranking…');ranking.append(spinner);
  try{
   const data=await endpoint(path);
   if(content._eventViewToken!==viewToken)return;
   spinner.remove();
   if(!Array.isArray(data.ranking))throw Error('Invalid ranking payload');
   const ranked=data.ranking.filter(member=>Number.isSafeInteger(Number(member.rank))&&
     Number(member.rank)>0&&Number.isFinite(Number(member.points)));
   if(!ranked.length){
    ranking.append(el('div','empty','No verified event points yet. Rankings will appear after eligible activity is recorded.'));
    return;
   }
   ranking.append(el('div','event-ranking-count',nice(ranked.length)+' verified participant'+
     (ranked.length===1?'':'s')+' · Live server rankings'));
   const podium=el('div','event-ranking-podium');
   for(const rank of [2,1,3]){
    const member=ranked.find(m=>Number(m.rank)===rank);
    const tile=el('div','event-champion rank-'+rank+(member?'':' no-entry'));
    tile.append(el('div','event-champion-medal',['','♛','✦','◆'][rank]),
      el('span','event-champion-position','TOP '+rank));
    if(member){
     if(member.pic)tile.append(avatar(member));
     tile.append(el('strong','event-champion-name',member.name||'Member'),
       el('small','event-champion-id',member.public_id||''),
       el('b','event-champion-score',nice(member.points)+' '+(eventScore(event)==='gift_points'?'points':'coins')));
    }else{
     tile.append(el('strong','event-champion-name','Not ranked'),
       el('small','event-champion-id','Awaiting verified activity'));
    }
    tile.append(el('span','event-champion-reward',eventRewardText(event,rank)));
    podium.append(tile);
   }
   ranking.append(podium);
   const rest=ranked.filter(m=>Number(m.rank)>3);
   if(rest.length){
    ranking.append(el('h4','event-ranking-subtitle','More event rankings'));
    const list=el('div','leaderboard');
    for(const member of rest){
     const line=el('div','leader event-ranking-row');
     line.append(el('span','num',Number(member.rank)));
     if(member.pic)line.append(avatar(member));
     const info=el('div','event-ranking-identity');
     info.append(el('strong','',member.name||'Member'),el('small','',member.public_id||''));
     const value=el('div','event-ranking-metrics');
     value.append(el('strong','',nice(member.points)+' '+(eventScore(event)==='gift_points'?'pts':'coins')));
     if(Number(member.rank)<=7)value.append(el('small','',eventRewardText(event,Number(member.rank))));
     line.append(info,value);list.append(line);
    }
    ranking.append(list);
   }
   ranking.append(el('p','muted',EVENT_SCORE_CAPTIONS[eventScore(event)]));
  }catch(error){
   if(content._eventViewToken!==viewToken)return;
   spinner.remove();
   const problem=el('div','empty','Ranking temporarily unavailable: '+errMessage(error));
   const retry=el('button','secondary','Retry ranking');retry.type='button';
   retry.onclick=()=>{problem.remove();retry.remove();loadRanking();};
   ranking.append(problem,retry);
  }
 }
 loadRanking();
}
async function showWallet(){
 heading('My Virtual Wallet','Read-only · No cash withdrawal');
 const box=el('div','panel');box.append(el('p','muted','Loading your verified coin balance…'));content.append(box);
 try{
  const data=await endpoint('wallet');box.replaceChildren(el('p','muted','Main Wallet'),
   el('div','balance',nice(data.coins)),el('p','muted','Virtual Sharika Coins'));
  const ledger=el('div','leaderboard');
  for(const row of data.ledger||[]){
   const item=el('div','leader');
   item.append(el('div','',row.reason||'Transaction'),el('strong','',
    (row.delta>0?'+':'')+nice(row.delta)));
   ledger.append(item);
  }
  if(ledger.childElementCount){box.append(el('h3','','Recent verified transactions'),ledger);}
 }catch(e){box.replaceChildren(el('div','empty',errMessage(e)));}
}
async function showGifts(){
 heading('Royal Gifts','CP and Friendship · Approved by server');
 try{const data=await endpoint('gifts'),grid=el('div','grid');
  for(const gift of data.gifts||[]){
   const box=el('article','item');
   box.append(el('span','big-icon',gift.emoji||'🎁'),
    el('h3','',gift.name),el('p','',gift.type.toUpperCase()+' · '+nice(gift.price_coins)+' coins'));
   grid.append(box);
  }
  if(!grid.childElementCount)empty('No published gifts.');else content.append(grid);
 }catch(e){empty(errMessage(e));}
}
function showAssets(){heading('Royal Frames');empty('Asset catalogue is restricted until Admin publishes verified media.');}
function toggleRow(item){
 const row=el('div','row');
 const title=el('div');title.append(el('strong','',item.title),
  el('div','muted',item.kind+' · '+item.id));
 const button=el('button','toggle'+(item.published?' on':''));
 button.type='button';button.setAttribute('aria-label',(item.published?'Hide ':'Publish ')+item.title);
 button.setAttribute('aria-pressed',String(!!item.published));
 button.onclick=async()=>{
  button.disabled=true;status.textContent='Saving publication on Sharika server…';
  try{
   await request('admin/visibility',{method:'PATCH',body:{
    id:item.id,kind:item.kind,published:!item.published}});
   item.published=!item.published;button.className='toggle'+(item.published?' on':'');
   button.setAttribute('aria-pressed',String(item.published));
   status.textContent='Publication saved. Reload to verify updated app view.';
   const latest=await endpoint('manifest');manifest=latest;
  }catch(e){status.textContent='Change rejected: '+errMessage(e);}
  finally{button.disabled=false;}
 };
 row.append(title,button);return row;
}
function showAdmin(){
 heading('Private Admin Control','Server-authorized Super Admin only');
 const notice=el('div','note','Hidden content is never shown to app users. Game odds settings below are drafts and do not alter existing game outcomes.');
 content.append(notice);
 const items=[...(admin.items||[])];
 const events=(admin.events||[]).map(e=>({
  id:'event:'+e.id,kind:'event',title:e.title+' ('+e.status+')',
  published:items.find(x=>x.id==='event:'+e.id)?.published||false}));
 for(const [kind,label] of [['game','Games'],['ranking','Rankings'],['module','Modules'],['event','Events']]){
  const box=el('div','panel');box.append(el('h3','',label+' · Publish / Hide'));
  const source=kind==='event'?events:items.filter(x=>x.kind===kind);
  for(const item of source)box.append(toggleRow(item));
  if(!source.length)box.append(el('p','muted','No items yet'));
  content.append(box);
 }
 const form=el('form','panel');form.append(el('h3','','Win Rate & RTP — Draft Only'));
 const game=el('select');game.required=true;
 for(const x of items.filter(x=>x.kind==='game')){
  const op=el('option','',x.title);op.value=x.id;game.append(op);}
 const win=el('input');win.type='number';win.min='0';win.max='100';win.step='0.1';win.value='35';
 const rtp=el('input');rtp.type='number';rtp.min='0';rtp.max='100';rtp.step='0.1';rtp.value='90';
 const winLab=el('label','','Win Probability (%)');winLab.append(win);
 const rtpLab=el('label','','Target RTP (%)');rtpLab.append(rtp);
 const fields=el('div','form-row');fields.append(winLab,rtpLab);
 const save=el('button','action','Save Proposed Rules');save.type='submit';
 form.append(game,fields,el('p','muted','Saving does not change live results. Engine-specific fairness, payout disclosure and round-version checks must pass before activation.'),save);
 form.onsubmit=async e=>{
  e.preventDefault();save.disabled=true;
  try{
   const values={game_id:game.value,win_rate_basis_points:Math.round(Number(win.value)*100),
     target_rtp_basis_points:Math.round(Number(rtp.value)*100),notes:'Pending fair game-engine integration'};
   const result=await request('admin/odds-draft',{method:'PATCH',body:values});
   status.textContent=result.notice||'Draft saved';
  }catch(error){status.textContent=errMessage(error);}finally{save.disabled=false;}
 };
 content.append(form);
}
function render(){content._eventViewToken=null;content.replaceChildren();status.textContent='';
 if(!current){empty('No games, rankings or events have been published for your account.');return;}
 if(current==='games')showGames();
 else if(current==='rankings')showRankings();
 else if(current==='events')showEvents();
 else if(current==='wallet')showWallet();
 else if(current==='gifts')showGifts();
 else if(current==='assets')showAssets();
 else if(current==='admin'&&admin)showAdmin();
}
async function refresh(){
 status.textContent='Checking published permissions…';
 try{
  manifest=await endpoint('manifest');
  // No admin login or controls on a member-facing website.
  admin=null;
  overview.textContent='Only content approved for Sharika members is visible here.';
  const params=new URLSearchParams(location.search);
  if(params.get('tab')==='events'&&(manifest.events||[]).length)current='events';
  buildTabs();render();
  const requestedId=params.get('event');
  if(requestedId&&/^[1-9][0-9]{0,10}$/.test(requestedId)&&
      (manifest.events||[]).length){
    const selected=(manifest.events||[]).find(e=>String(e.id)===requestedId);
    if(selected)showEventDetail(selected);
  }
 }catch(e){
  tabs.replaceChildren();content.replaceChildren();empty('Private Center unavailable. Open from your signed-in Sharika app.');
  status.textContent=errMessage(e);overview.textContent='Authenticated Sharika access required.';
 }
}
$('refresh').onclick=refresh;refresh();
})();