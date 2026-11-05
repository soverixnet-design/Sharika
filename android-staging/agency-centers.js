/* Sharika Royal BD / Agency / Host Centers.
 * Display only verified Cloudflare D1 workforce balances, policies and roles.
 */
(function(){
  'use strict';
  const definitions={
    bd:{title:'BD Center',short:'BD',subtitle:'Agency network · 5% commission',
      services:[['invite','Invite Agency'],['team','Team Members'],
        ['assistant','Assistant BD'],['salary','Salary Wallet']],
      mine:'My BD Salary',team:'Team Income'},
    agency:{title:'Agency Center',short:'AGENCY',subtitle:'Host network · 10% commission',
      services:[['invite','Invite Host'],['team','Host Members'],
        ['assistant','Agency Assistant'],['salary','Salary Wallet']],
      mine:'My Agency Salary',team:'Host Income'},
    host:{title:'Host Center',short:'HOST',subtitle:'Host gift target · 40% salary',
      services:[['target','My Target'],['history','Gift Records'],
        ['agency','My Agency'],['salary','Salary Wallet']],
      mine:'My Host Salary',team:'Eligible Gifts'}
  };
  const sectionLabels={invite:'Invite & Assign',team:'Team Members',assistant:'Assistant Management',
    salary:'Salary Wallet',target:'Host Target',history:'Gift History',agency:'My Agency'};
  const state={role:'bd',section:'overview',identity:null,data:null,loading:false,error:'',message:''};
  let layer=null,requestSequence=0;
  function text(value){return String(value==null?'':value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));}
  function attr(value){return text(value);}
  function currentUser(){
    const supplied=state.identity||{};
    const local=window.A||{};
    return {name:supplied.name||local.name||'Sharika Member',
      id:supplied.display_id||supplied.special_id||supplied.public_id||local.id||'',
      pic:supplied.pic||local.pic||''};
  }
  function avatarMarkup(pic){
    const safe=typeof pic==='string'&&/^(data:image\/(?:png|jpeg|webp|gif);base64,|https:\/\/|\.\/)/i.test(pic);
    return safe?'<img src="'+attr(pic)+'" alt="Profile photo">':'<span aria-hidden="true">♛</span>';
  }
  function profile(){
    const user=currentUser(),def=definitions[state.role];
    return '<section class="shc-profile"><div class="shc-avatar">'+avatarMarkup(user.pic)+'</div>'+
      '<div class="shc-profile-info"><div class="shc-name">'+text(user.name)+
      '<span class="shc-role">'+def.short+'</span></div><div class="shc-id">ID: '+
      (user.id?text(user.id):'—')+'</div><div class="shc-kicker" style="margin:6px 0 0">'+
      text(def.subtitle)+'</div></div></section>';
  }
  function policy(){
    const p=state.data?.policy||{};
    return '<div class="shc-policy" aria-label="Current income policy">'+
      '<div><b>'+text(p.host_bps==null?'—':p.host_bps/100+'%')+'</b><small>Host Salary</small></div>'+
      '<div><b>'+text(p.agency_bps==null?'—':p.agency_bps/100+'%')+'</b><small>Agency Share</small></div>'+
      '<div><b>'+text(p.bd_bps==null?'—':p.bd_bps/100+'%')+'</b><small>BD Share</small></div></div>';
  }
  function note(message,warning){
    return '<div class="shc-note'+(warning?' shc-warning':'')+'">'+message+'</div>';
  }
  function overview(){
    const def=definitions[state.role];
    const data=state.data,credits=data?.salary?.by_kind||[];
    const match=credits.find(x=>x.kind===state.role);
    const units=match?.units;
    const roleAllowed=data?.role?.kind===state.role&&data?.role?.active;
    return '<span class="shc-kicker">'+(state.role==='bd'?'BD Services':state.role==='agency'?'Agency Services':'Host Services')+'</span>'+
      '<div class="shc-services">'+def.services.map(([id,label])=>
        '<button class="shc-service" type="button" data-shc-section="'+id+'">'+
        '<span class="shc-art '+id+'" aria-hidden="true"></span><b>'+text(label)+'</b><i>›</i></button>').join('')+'</div>'+
      '<section class="shc-income"><div class="shc-income-title"><h2>My Income</h2>'+
      '<span class="shc-period">All time</span></div><div class="shc-income-grid">'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>'+def.mine+'</small><strong>'+
      (roleAllowed&&units!=null?salaryUnits(units):'—')+'</strong></div></div>'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>'+def.team+'</small><strong>'+
      (match?formatCoins(match.gift_coins):'—')+'</strong></div></div></div>'+policy()+'</section>'+
      (state.role==='host'?targetSummary():'')+
      note('Main Wallet Diamond Exchange ('+
        (data?.policy?.direct_exchange_bps==null?'—':data.policy.direct_exchange_bps/100+'%')+
        ') is separate from Salary Wallet. Salary credits become spendable coins only after their settlement period.',false)+
      (state.loading?note('Loading verified salary data…',false):
        (!data?note('Verified salary data is unavailable. No amount will be estimated.',true):
          !roleAllowed?note('You do not have an active '+text(def.short)+' role. Ask an authorized manager to assign it.',true):''));
  }
  function formatCoins(number){
    return Number.isFinite(Number(number))?Number(number).toLocaleString('en-US'):'—';
  }
  function salaryUnits(number){
    return Number.isSafeInteger(Number(number))?formatCoins(Number(number)/10000):'—';
  }
  function targetSummary(){
    const first=state.data?.targets?.[0];
    if(!first)return '';
    const received=Number(state.data.host_target_gifts||0);
    return '<section class="shc-target"><small>First Host Target</small><b>'+text(first.label)+'</b>'+
      '<div class="shc-track"><i style="width:'+Math.min(100,100*received/first.target_coins)+'%"></i></div>'+
      '<small>'+formatCoins(received)+' / '+formatCoins(first.target_coins)+' eligible gift coins</small></section>';
  }
  function salary(){
    const data=state.data,p=data?.policy||{},summary=data?.salary||{};
    const active=data?.role?.kind===state.role&&data?.role?.active;
    const matured=Math.floor(Number(summary.matured_available_units||0)/10000);
    const allowed=active&&p.enabled&&p.salary_exchange_enabled&&matured>0;
    return '<div class="shc-subtitle">Salary Wallet</div>'+
      '<section class="shc-income"><div class="shc-income-grid">'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>Matured Salary (coins)</small><strong>'+
      (data?salaryUnits(summary.matured_available_units):'—')+'</strong></div></div>'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>Salary Balance (coins)</small><strong>'+
      (data?salaryUnits(summary.remaining_units):'—')+'</strong></div></div></div>'+policy()+'</section>'+
      '<span class="shc-kicker">Salary Exchange</span>'+
      '<section class="shc-target"><small>Exchange permission</small><b>'+
      (p.salary_exchange_enabled?'Enabled':'Admin approval required')+'</b>'+
      '<small>Settlement: '+text(p.settlement_mode||'—')+' · Policy version '+text(p.version||'—')+
      '</small></section>'+
      '<label class="shc-kicker" for="shc-exchange-amount">Coins to exchange (available: '+formatCoins(matured)+')</label>'+
      '<input id="shc-exchange-amount" type="number" min="1" max="'+matured+'" value="'+
      (allowed?matured:'')+'" inputmode="numeric" '+(allowed?'':'disabled')+'>'+
      '<button class="shc-primary" type="button" data-shc-exchange '+
      (allowed?'':'disabled')+'>Exchange matured salary to coins</button>'+
      note('Only completed settlement periods are exchangeable. Every transfer is recorded in your main wallet ledger.',false)+
      '<span class="shc-kicker">Salary Transfer History</span>'+ledger('No salary exchanges yet.',
        (data?.exchanges||[]).map(row=>[row.created_at,'Salary → Coins',formatCoins(row.credited_coins)]));
  }
  function ledger(empty,entries){
    return '<table class="shc-ledger"><thead><tr><th>Date</th><th>Details</th><th>Amount</th></tr></thead><tbody>'+
      (entries||[]).map(row=>'<tr>'+row.map(cell=>'<td>'+text(cell)+'</td>').join('')+'</tr>').join('')+
      '</tbody></table>'+(entries?.length?'':'<div class="shc-empty">'+text(empty)+'</div>');
  }
  function target(){
    const tiers=state.data?.target_progress||[];
    return '<div class="shc-subtitle">Host Gift Targets</div>'+note(
      'Gift targets count verified ordinary gifts sent to your Host ID (including self-gifts). Target milestones do not issue a second salary.',false)+
      tiers.map((value,index)=>'<section class="shc-target"><small>Target '+(index+1)+'</small><b>'+text(value.label)+'</b>'+
      '<div class="shc-track"><i style="width:'+Math.min(100,100*value.progress/value.target_coins)+'%"></i></div><small>'+
      formatCoins(value.progress)+' / '+formatCoins(value.target_coins)+' · '+
      (value.completed?'Completed':'In progress')+'</small></section>').join('')+
      (state.data?'':note('Target settings unavailable from the backend.',true));
  }
  function nested(){
    const kind=state.section,role=state.role;
    if(kind==='salary')return salary();
    if(kind==='target')return target();
    const hints={
      invite:role==='bd'?'BD can invite and assign Agencies when Admin grants permission.':
        'Agency can invite and approve Hosts when Admin grants permission.',
      team:role==='bd'?'Agency roster and total eligible Host gift income appear here.':
        'Host roster, gift totals and each Host income report appear here.',
      assistant:role==='bd'?'Assistant BD access must be granted and revoked by an authorized Admin.':
        'Agency assistant access must be granted and revoked by an authorized Admin.',
      history:'Verified gift records will list sender, receiver, date and eligible value.',
      agency:'Your assigned Agency details, owner and contact will appear here.'
    };
    const data=state.data,roleAllowed=data?.role?.kind===role&&data?.role?.active;
    const assignmentRole=kind==='invite'?(role==='bd'?'agency':'host'):
      kind==='assistant'?(role==='bd'?'assistant_bd':'assistant_agency'):null;
    const assignment=assignmentRole&&roleAllowed?'<label class="shc-kicker" for="shc-member-id">Member public ID</label>'+
      '<input id="shc-member-id" inputmode="numeric" maxlength="8" placeholder="10000001">'+
      '<button class="shc-primary" type="button" data-shc-assign="'+assignmentRole+'">Assign '+
      text(assignmentRole.replace('_',' '))+'</button>':'';
    const teamRows=(data?.roster||[]).filter(x=>kind==='assistant'?x.role.includes('assistant'):true)
      .map(x=>[x.assigned_at||'—',x.name+' · '+x.public_id+' ('+x.role+')',x.active?'Active':'Inactive']);
    const giftRows=(data?.recent_salary||[]).map(x=>[x.created_at,
      x.host_id+' · '+x.kind,formatCoins(x.gift_coins)+' gifts']);
    return '<div class="shc-subtitle">'+text(sectionLabels[kind]||kind)+'</div>'+
      note(text(hints[kind]||'Role information'),false)+assignment+
      (kind==='agency'?'<section class="shc-target"><small>Assigned agency</small><b>'+text(
        (data?.ancestry||[]).find(x=>x.role==='agency')?.name||'Not assigned')+'</b></section>':'')+
      ledger('No verified '+(kind==='team'?'members':kind==='history'?'gift records':'assignments')+' available.',
        kind==='history'?giftRows:teamRows)+
      (!roleAllowed?note('This center is read-only until your role is active.',true):'');
  }
  function render(){
    if(!layer||layer.hidden)return;
    const def=definitions[state.role];
    layer.innerHTML='<div class="shc-scroll"><div class="shc-content">'+
      '<header class="shc-top"><button class="shc-back" type="button" data-shc-back aria-label="Back">‹</button>'+
      '<h1>'+text(def.title)+'</h1><button class="shc-refresh" type="button" data-shc-refresh aria-label="Refresh profile">⟳</button></header>'+
      '<nav class="shc-switch" aria-label="Centers">'+
      Object.keys(definitions).map(key=>'<button type="button" data-shc-role="'+key+'" aria-pressed="'+
        (state.role===key?'true':'false')+'">'+definitions[key].short+'</button>').join('')+'</nav>'+
      profile()+(state.section==='overview'?overview():
        '<button class="shc-backlink" type="button" data-shc-overview>‹ '+text(def.title)+'</button>'+nested())+
      '</div></div>';
    const msg=state.message||state.error;
    if(msg)layer.querySelector?.('.shc-content')?.insertAdjacentHTML?.('beforeend',note(text(msg),!!state.error));
  }
  function back(){
    if(!layer||layer.hidden)return false;
    if(state.section!=='overview'){state.section='overview';render();return true;}
    close();return true;
  }
  function close(){if(layer)layer.hidden=true;state.section='overview';}
  async function loadIdentity(){
    const seq=++requestSequence;
    const service=window.SharikaServer;
    if(!service?.connected?.()||typeof service.api!=='function'){
      state.identity=null;state.data=null;state.loading=false;
      state.error='Sign in to load verified workforce data.';render();return;
    }
    state.loading=true;state.error='';state.message='';render();
    try{
      const [result,workforce]=await Promise.all([
        service.api('GET','/me'),service.api('GET','/workforce/me')]);
      if(seq!==requestSequence||!layer||layer.hidden)return;
      state.identity=result||null;
      state.data=workforce||null;
    }catch(error){
      if(seq===requestSequence){state.identity=null;state.data=null;
        state.error='Could not load verified workforce data: '+String(error?.message||error);}
    }
    if(seq!==requestSequence||!layer||layer.hidden)return;
    state.loading=false;
    render();
  }
  function freshRequestId(){
    const bytes=new Uint8Array(16);
    if(typeof window.crypto?.getRandomValues!=='function')return null;
    window.crypto.getRandomValues(bytes);
    return 'salary:'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function exchange(){
    const data=state.data,p=data?.policy||{},service=window.SharikaServer;
    if(!data||!p.salary_exchange_enabled||!p.enabled||
       data.role?.kind!==state.role||!data.role?.active)return;
    const amount=Number(layer?.querySelector?.('#shc-exchange-amount')?.value);
    const limit=Math.floor(Number(data.salary?.matured_available_units||0)/10000);
    if(!Number.isSafeInteger(amount)||amount<1||amount>limit){
      state.error='Enter a whole coin amount within your matured salary balance.';render();return;
    }
    const requestId=freshRequestId();
    if(!requestId){state.error='Secure transaction ID unavailable. Please update Android WebView.';render();return;}
    if(typeof window.confirm==='function'&&!window.confirm('Exchange '+formatCoins(amount)+
      ' verified salary coins to your Main Wallet?'))return;
    state.loading=true;state.error='';state.message='';render();
    try{
      await service.api('POST','/workforce/salary/exchange',{
        coins:amount,expected_version:p.version,request_id:requestId});
      state.message='Salary exchange completed. Main wallet balance updated.';
      service.reloadWallet?.();
      await loadIdentity();
      state.message='Salary exchange completed. Main wallet balance updated.';
    }catch(error){state.error='Salary exchange rejected: '+String(error?.message||error);}
    state.loading=false;render();
  }
  async function assign(kind){
    const data=state.data,service=window.SharikaServer;
    if(!data?.role?.active||data.role.kind!==state.role||
      !['agency','host','assistant_bd','assistant_agency'].includes(kind))return;
    const id=String(layer?.querySelector?.('#shc-member-id')?.value||'').trim();
    if(!/^[0-9]{8}$/.test(id)){
      state.error='Enter the full 8-digit public ID.';render();return;
    }
    state.loading=true;state.error='';state.message='';render();
    try{
      await service.api('POST','/workforce/assign',{role:kind,public_id:id});
      await loadIdentity();state.message='Role assigned successfully to ID '+id+'.';
    }catch(error){state.error='Assignment rejected: '+String(error?.message||error);}
    state.loading=false;render();
  }
  function open(role){
    if(!definitions[role])role='bd';
    ensureLayer();state.role=role;state.section='overview';state.identity=null;state.data=null;
    state.error='';state.message='';state.loading=true;
    layer.hidden=false;render();loadIdentity();
  }
  function ensureLayer(){
    if(layer)return;
    layer=document.createElement('section');layer.id='sh-centers-panel';
    layer.hidden=true;layer.setAttribute('aria-label','Sharika Royal BD Agency Host Centers');
    document.body.appendChild(layer);
    layer.addEventListener('click',event=>{
      const target=event.target.closest('button');if(!target)return;
      if(target.hasAttribute('data-shc-back')){back();return;}
      if(target.hasAttribute('data-shc-refresh')){loadIdentity();return;}
      if(target.hasAttribute('data-shc-exchange')){exchange();return;}
      if(target.dataset.shcAssign){assign(target.dataset.shcAssign);return;}
      if(target.hasAttribute('data-shc-overview')){state.section='overview';render();return;}
      if(target.dataset.shcRole){state.role=target.dataset.shcRole;state.section='overview';render();return;}
      if(target.dataset.shcSection){state.section=target.dataset.shcSection;render();}
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&back())event.preventDefault();
    });
  }
  function mountProfileLinks(){
    const owner=document.querySelector('#v-me .profile-account .ml2');
    if(!owner)return;
    document.getElementById('sh-family-entries')?.remove();
    owner.querySelectorAll('[data-sh-center]').forEach(item=>item.remove());
    const descriptions={bd:'Agents · assistants · salary',agency:'Hosts · team income · salary',
      host:'Gift targets · earnings · salary'};
    Object.keys(definitions).forEach(key=>{
      const button=document.createElement('button');button.type='button';
      button.className='shc-profile-link';button.dataset.shCenter=key;
      button.innerHTML='<span class="shc-menu-icon '+key+'" aria-hidden="true"></span><span>'+
        '<strong class="shc-menu-title">'+definitions[key].title+'</strong><small class="shc-menu-desc">'+
        descriptions[key]+'</small></span><span class="shc-menu-chevron">›</span>';
      button.onclick=()=>open(key);owner.appendChild(button);
    });
  }
  const previousRender=window.renderMe;
  if(typeof previousRender==='function')window.renderMe=function(){
    const result=previousRender.apply(this,arguments);mountProfileLinks();return result;
  };
  mountProfileLinks();
  // Keep the original recharge art and handlers, rename only the visible tab.
  const previousRecharge=window.renderRcp;
  if(typeof previousRecharge==='function')window.renderRcp=function(){
    const result=previousRecharge.apply(this,arguments);
    const exchangeTab=document.querySelector('#rcp [data-x="1"]');
    if(exchangeTab)exchangeTab.textContent='Diamond Exchange';
    return result;
  };
  // Keep currently opened centers in sync with Super Admin policy revisions.
  // Hidden centers make no requests; app resume also refreshes immediately.
  window.setInterval?.(()=>{if(layer&&!layer.hidden&&!state.loading)loadIdentity();},45000);
  window.addEventListener?.('focus',()=>{
    if(layer&&!layer.hidden&&!state.loading)loadIdentity();
  });
  window.sharikaCentersOpen=open;
  window.sharikaCentersBack=back;
  window.sharikaCentersClose=close;
})();
