/* Sharika Royal BD / Agency / Host Centers, staging presentation layer.
 * Money is deliberately read-only until a verified workforce ledger and
 * salary exchange endpoint exist. Never infer balances from demo/local state.
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
  const periods={today:'Today',week:'This week',month:'This month'};
  const state={role:'bd',section:'overview',period:'month',identity:null,loading:false,error:''};
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
    return '<div class="shc-policy" aria-label="Current design policy">'+
      '<div><b>40%</b><small>Host Salary</small></div>'+
      '<div><b>10%</b><small>Agency Share</small></div>'+
      '<div><b>5%</b><small>BD Share</small></div></div>';
  }
  function note(message,warning){
    return '<div class="shc-note'+(warning?' shc-warning':'')+'">'+message+'</div>';
  }
  function overview(){
    const def=definitions[state.role];
    return '<span class="shc-kicker">'+(state.role==='bd'?'BD Services':state.role==='agency'?'Agency Services':'Host Services')+'</span>'+
      '<div class="shc-services">'+def.services.map(([id,label])=>
        '<button class="shc-service" type="button" data-shc-section="'+id+'">'+
        '<span class="shc-art '+id+'" aria-hidden="true"></span><b>'+text(label)+'</b><i>›</i></button>').join('')+'</div>'+
      '<section class="shc-income"><div class="shc-income-title"><h2>My Income</h2>'+
      '<select class="shc-period" aria-label="Income period">'+
      Object.keys(periods).map(key=>'<option value="'+key+'"'+(state.period===key?' selected':'')+'>'+periods[key]+'</option>').join('')+
      '</select></div><div class="shc-income-grid">'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>'+def.mine+'</small><strong>—</strong></div></div>'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>'+def.team+'</small><strong>—</strong></div></div></div>'+policy()+'</section>'+
      (state.role==='host'?'<section class="shc-target"><small>First Host Target</small><b>5M Gift Value</b>'+
        '<div class="shc-track"><i></i></div><small>Target progress: awaiting verified gift records</small></section>':'')+
      note('Main Wallet Diamond Exchange (30%) is separate from this Salary Wallet. '+
        'Salary exchange needs Admin approval for daily, weekly or monthly settlement.',false)+
      note('Verified BD / Agency / Host salary data is not connected to this staging backend yet. '+
        'No balance or payment is being estimated.',true);
  }
  function salary(){
    return '<div class="shc-subtitle">Salary Wallet</div>'+
      '<section class="shc-income"><div class="shc-income-grid">'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>Available Salary</small><strong>—</strong></div></div>'+
      '<div class="shc-stat"><span class="shc-mini" aria-hidden="true"></span><div><small>Pending Settlement</small><strong>—</strong></div></div></div>'+policy()+'</section>'+
      '<span class="shc-kicker">Salary Exchange</span>'+
      '<section class="shc-target"><small>Exchange permission</small><b>Admin controlled</b>'+
      '<small>Daily / Weekly / Monthly schedules are configured by Admin.</small></section>'+
      '<button class="shc-primary" type="button" disabled>Exchange Salary to Coins · Not Activated</button>'+
      note('Only a server-verified salary ledger can become coins. '+
        'No transfer, recharge or payout occurs from this design screen.',true)+
      '<span class="shc-kicker">Salary Transfer History</span>'+ledger('No verified salary transfer records yet.');
  }
  function ledger(empty){
    return '<table class="shc-ledger"><thead><tr><th>Period</th><th>Details</th><th>Amount</th></tr></thead></table>'+
      '<div class="shc-empty">'+text(empty)+'</div>';
  }
  function target(){
    const tiers=['5M','10M','20M','50M'];
    return '<div class="shc-subtitle">Host Gift Targets</div>'+note(
      'The first eligible gift target starts at 5 million. Progress counts verified Host gifts, including permitted self-gifts. No target reward is credited without the backend.',false)+
      tiers.map((value,index)=>'<section class="shc-target"><small>Target '+(index+1)+'</small><b>'+value+'</b>'+
      '<div class="shc-track"><i></i></div><small>Awaiting verified progress</small></section>').join('')+
      note('Host salary policy: 40% of eligible Host gift value. Agency receives 10% and BD receives 5% from the same eligible Host gift base, once verified.',true);
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
    return '<div class="shc-subtitle">'+text(sectionLabels[kind]||kind)+'</div>'+
      note(text(hints[kind]||'Role information'),false)+
      ledger('No verified '+(kind==='team'?'team records':kind==='history'?'gift records':'assignments')+' available.')+
      note('This section requires the new server-side Agency and Host role endpoints. '+
        'An invitation or role assignment cannot be created in this UI preview.',true);
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
      state.identity=null;render();return;
    }
    try{
      const result=await service.api('GET','/me');
      if(seq!==requestSequence||!layer||layer.hidden)return;
      state.identity=result||null;
    }catch(_){if(seq===requestSequence)state.identity=null;}
    render();
  }
  function open(role){
    if(!definitions[role])role='bd';
    ensureLayer();state.role=role;state.section='overview';state.identity=null;
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
      if(target.hasAttribute('data-shc-overview')){state.section='overview';render();return;}
      if(target.dataset.shcRole){state.role=target.dataset.shcRole;state.section='overview';render();return;}
      if(target.dataset.shcSection){state.section=target.dataset.shcSection;render();}
    });
    layer.addEventListener('change',event=>{
      if(event.target.classList.contains('shc-period')){
        state.period=periods[event.target.value]?event.target.value:'month';render();
      }
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
  window.sharikaCentersOpen=open;
  window.sharikaCentersBack=back;
  window.sharikaCentersClose=close;
})();
