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
   if(!leaders.length){holder.append(el('div','empty','No confirmed ranking results in this period.'));return;}
   const podium=el('div','podium');
   for(let i=0;i<Math.min(3,leaders.length);i++){
    const v=leaders[i],c=el('div','champ');
    c.append(el('div','medal',['♛','◆','✦'][i]));
    if(v.pic)c.append(avatar(v));
    c.append(el('strong','',v.name||'Member'),el('small','',nice(v.total)+' coins'));
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
    const amount=el('strong','',nice(v.total));amount.style.marginLeft='auto';
    line.append(main,amount);list.append(line);
   }
   holder.append(list);
  }catch(e){holder.replaceChildren(el('div','empty',errMessage(e)));}
 }
 select.onchange=load;period.onchange=load;load();
}
function eventCountdown(iso){
 const ms=Date.parse(iso)-Date.now();
 if(!Number.isFinite(ms)||ms<0)return 'Ended';
 const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000);
 return days+'d '+hours+'h remaining';
}
function showEvents(){
 heading('Royal Events','Official published events only');
 const items=published('events');if(!items.length){empty('No events published.');return;}
 for(const e of items){
  const box=el('article','panel');
  const top=el('div','row');top.append(el('span','pill','♛ '+e.kind.replace(/_/g,' ')),
   el('span','timer',eventCountdown(e.ends_at)));box.append(top);
  const h=el('h3','',e.title);h.style.fontSize='21px';h.style.margin='12px 0 4px';
  box.append(h,el('p','muted',e.description||'Official Sharika event'));
  box.append(el('p','muted','Start: '+new Date(e.starts_at).toLocaleString()));
  content.append(box);
 }
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
function render(){content.replaceChildren();status.textContent='';
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
  buildTabs();render();
 }catch(e){
  tabs.replaceChildren();content.replaceChildren();empty('Private Center unavailable. Open from your signed-in Sharika app.');
  status.textContent=errMessage(e);overview.textContent='Authenticated Sharika access required.';
 }
}
$('refresh').onclick=refresh;refresh();
})();