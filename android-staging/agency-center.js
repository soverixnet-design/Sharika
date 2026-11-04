/* Sharika BD Center / Agency Roster / Host Earnings.
 * All figures come from the authenticated Worker; no demo balances or salaries.
 */
(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,
    ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
  const icon=name=>'./sharika-agency-icons/'+name+'.webp';
  const image=(src,alt='',className='')=>
    '<img class="'+esc(className)+'" src="'+esc(src)+'" alt="'+esc(alt)+'">';
  const safePic=value=>{
    try{
      if(!value)return null;
      const url=new URL(String(value),location.href);
      if(!['https:','http:'].includes(url.protocol))return null;
      if(url.protocol==='http:'&&url.origin!==location.origin)return null;
      if(url.username||url.password)return null;
      return url.href;
    }catch{return null;}
  };
  const portrait=(src,fallback='host',round=false)=>image(safePic(src)||icon(fallback),'',
    round?'ag-avatar-round':'ag-avatar');
  const fmt=value=>{
    const n=Number(value)||0;
    if(Math.abs(n)>=1e6)return (n/1e6).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'M';
    if(Math.abs(n)>=1e3)return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K';
    return n.toLocaleString('en-US');
  };
  const coinUnits=units=>{
    const number=(Number(units)||0)/10000;
    return number.toLocaleString('en-US',{maximumFractionDigits:2});
  };
  const roomTime=seconds=>{
    const value=Math.max(0,Math.floor(Number(seconds)||0));
    if(value>0&&value<60)return 'under 1m';
    const minutes=Math.floor(value/60),hours=Math.floor(minutes/60);
    return hours?hours+'h '+String(minutes%60).padStart(2,'0')+'m':minutes+'m';
  };
  const readableDate=value=>{
    if(!value)return 'Date unavailable';
    const raw=String(value).replace(' ','T');
    const date=new Date(/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/.test(raw)?raw:raw+'Z');
    return Number.isNaN(+date)?esc(value):date.toLocaleDateString('en-GB',
      {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  };
  const today=()=>new Date().toLocaleDateString('en-GB',
    {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const dayActivity=days=>(days||[]).map(day=>
    '<div class="ag-activity ag-time-row">'+image(icon('ranking'),'Activity','ag-gift-icon')+
    '<span class="ag-grow"><b>'+esc(readableDate(day.utc_day))+'</b>'+
    '<small>'+fmt(day.rooms)+' rooms joined</small></span>'+
    '<span class="ag-value">'+roomTime(day.seconds)+'</span></div>').join('')||
    '<div class="ag-empty">No verified room activity recorded in the last 30 days.</div>';
  const api=(method,path,body)=>{
    if(typeof window.sharikaAgencyApi!=='function')throw Error('Secure Sharika connection unavailable');
    return window.sharikaAgencyApi(method,path,body);
  };
  let panel=null,me=null,stack=[],generation=0,lastView=null;
  function ensurePanel(){
    if(panel?.isConnected)return panel;
    panel=document.createElement('section');panel.id='sh-agency-panel';
    panel.setAttribute('aria-label','Sharika Agency Center');panel.hidden=true;
    document.body.appendChild(panel);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&panel&&!panel.hidden){event.preventDefault();back();}
    });
    return panel;
  }
  function close(){generation++;if(panel)panel.hidden=true;stack=[];lastView=null;}
  function back(){
    if(!panel||panel.hidden)return false;
    const previous=stack.pop();
    if(previous)show(previous.type,previous.id,previous.period,false);
    else close();
    return true;
  }
  function footer(current){
    const tabs=[['home','Overview'],['agency','Agencies'],['reports','Reports'],['host','Profile']];
    return '<nav class="ag-bottom" aria-label="Agency navigation">'+
      tabs.map(([key,title])=>'<button type="button" data-ag-tab="'+key+'" '+
        (current===key?'aria-current="page"':'')+'>'+image(icon(key==='home'?'agency':
          key==='agency'?'host':key==='reports'?'reports':'bd'))+esc(title)+'</button>').join('')+'</nav>';
  }
  function shell(title,body,tab='home'){
    panel.innerHTML='<div class="ag-shell"><div class="ag-header">'+
      '<button type="button" class="ag-back" aria-label="Go back">‹</button>'+
      '<strong>SHARIKA • VOICE CHAT</strong>'+image(icon('bd'),'BD emblem','ag-logo-mini')+
      '</div>'+body+'</div>'+footer(tab);
    panel.querySelector('.ag-header img').style.cssText='width:41px;height:41px;object-fit:contain';
    panel.querySelector('.ag-back').onclick=back;
    panel.querySelectorAll('[data-ag-tab]').forEach(button=>button.onclick=()=>{
      const selected=button.dataset.agTab;
      if(selected==='host'){
        if(me?.host?.active&&me.host.public_id)show('host',me.host.public_id);
        else if(me?.agency)show('agency',me.agency.id);
        else {close();if(typeof window.go==='function')window.go('me');}
      }else if(selected==='agency'){
        if(me?.bd?.active)show('bd');
        else if(me?.agency)show('agency',me.agency.id);
        else show('unassigned');
      }else if(selected==='reports')show('reports');
      else show('overview');
    });
    panel.scrollTop=0;
  }
  function notice(message){
    const p=panel?.querySelector('[data-ag-notice]');
    if(p)p.textContent=message;
    else window.alert(message);
  }
  function loading(){
    shell('Agency Center','<div class="ag-title"><span class="ag-crown">♛</span>'+
      '<h1>Agency Center</h1></div><div class="ag-empty">Loading verified records…</div>');
  }
  function fail(error){
    shell('Unavailable','<div class="ag-title"><h1>Agency Center</h1></div>'+
      '<p class="ag-error">Unable to load verified data: '+esc(error?.message||error)+
      '</p><p class="ag-muted">The staging Worker and new database migration must be deployed together.</p>');
  }
  const title=(heading,code)=>'<header class="ag-title"><span class="ag-crown">♛</span>'+
    '<h1>'+esc(heading)+'</h1>'+(code?'<span class="ag-id">'+esc(code)+'</span>':'')+'</header>';
  function showOverview(){
    if(me?.bd?.active)return show('bd',undefined,undefined,false);
    if(me?.agency)return show('agency',me.agency.id,undefined,false);
    if(me?.host?.active)return show('host',me.host.public_id,undefined,false);
    return show('unassigned',undefined,undefined,false);
  }
  function renderUnassigned(){
    shell('Agency Center',title('Agency & Host')+
      '<div class="ag-hero">'+image(icon('agency'),'Royal Agency emblem','ag-icon')+
      '<h3>Agency / BD / Host</h3><p>Official approval required</p></div>'+
      '<div class="ag-empty">You are not yet an assigned Agency Owner, BD, or active Host.'+
      '<p>Apply through the Royal Family system. Your approved Family can be linked as an Agency.</p></div>'+
      '<button type="button" class="ag-big-button" data-ag-family>Open Royal Family</button>');
    panel.querySelector('[data-ag-family]').onclick=()=>{
      close();window.sharikaOpenRoyalFamily?.();
    };
  }
  function renderBd(data){
    const agencies=data.families||[];
    const bd=data.bd_profile||{};
    const totalGifts=agencies.reduce((sum,item)=>sum+(Number(item.week_gifts)||0),0);
    const rows=agencies.map(item=>'<button class="ag-card" data-ag-agency="'+esc(item.id)+'">'+
      portrait(item.logo,'agency')+
      '<span class="ag-grow"><h3>'+esc(item.name)+'</h3><small>Owner: '+esc(item.owner_name)+
      ' · Real ID '+esc(item.owner_id)+'</small><small>'+fmt(item.hosts)+' Active Hosts</small>'+
      '<div class="ag-progress"><span style="width:'+Math.min(100,
        totalGifts?100*Number(item.week_gifts)/totalGifts:0)+'%"></span></div></span>'+
      '<span><small>Qualifying Gifts</small><span class="ag-value">'+fmt(item.week_gifts)+'</span></span>'+
      '<span class="ag-arrow">›</span></button>').join('');
    shell('BD Center',title('BD Center',today())+
      '<div class="ag-identity">'+portrait(bd.pic,'bd',true)+
      '<div class="ag-grow"><small>VERIFIED BD PROFILE</small><h3>'+esc(bd.name)+'</h3>'+
      '<p>Real ID '+esc(bd.public_id)+'</p><small>Today in Rooms: '+roomTime(data.today_active_seconds)+'</small></div>'+
      image(icon('bd'),'BD badge','ag-role-emblem')+'</div>'+
      '<div class="ag-hero"><small>Team Gift Performance • This Week</small>'+
      '<div class="ag-hero-row">'+image(icon('gifts'),'Gifts','ag-icon')+
      '<strong>'+fmt(totalGifts)+'</strong></div><p>Estimated BD commission</p>'+
      '<span class="ag-chip">'+coinUnits(data.pending_bd_units)+' coins • Pending verification</span></div>'+
      '<details class="ag-panel ag-days-collapse"><summary>My Daily Room Activity (UTC)</summary>'+
      dayActivity(data.bd_activity_by_day)+'</details>'+
      '<h2>Assigned Agencies ('+agencies.length+')</h2>'+
      (rows||'<div class="ag-empty">No agencies have been assigned to this BD account.</div>')+
      '<button type="button" class="ag-big-button" data-ag-reports>'+image(icon('reports'))+
      'View Agency Reports</button>','agency');
    panel.querySelectorAll('[data-ag-agency]').forEach(button=>button.onclick=()=>
      show('agency',Number(button.dataset.agAgency)));
    panel.querySelector('[data-ag-reports]').onclick=()=>show('reports');
  }
  function renderAgency(data){
    const agency=data.agency||{},hosts=data.hosts||[];
    const active=hosts.filter(h=>h.active);
    const totalWeek=hosts.reduce((sum,h)=>sum+(Number(h.week_gifts)||0),0);
    const teamToday=hosts.reduce((sum,h)=>sum+(Number(h.today_seconds)||0),0);
    shell('Agency',title(agency.name||'Royal Agency','AG-'+agency.id)+
      '<div class="ag-identity">'+portrait(agency.logo,'agency',true)+
      '<div class="ag-grow"><small>VERIFIED AGENCY OWNER</small><h3>'+esc(agency.owner_name)+'</h3>'+
      '<p>Real ID '+esc(agency.owner_id)+'</p><small>Owner in Rooms Today: '+
      roomTime(agency.owner_today_seconds)+'</small></div>'+
      image(icon('agency'),'Agency badge','ag-role-emblem')+'</div>'+
      '<div class="ag-hero"><div class="ag-stat-grid">'+
      '<div><strong>'+active.length+'</strong><small>Active Hosts</small></div>'+
      '<div><strong>'+hosts.length+'</strong><small>Total Hosts</small></div></div></div>'+
      '<div class="ag-panel ag-row">'+image(icon('gifts'),'Gift total','ag-icon')+
      '<span class="ag-grow"><h3>Weekly Gifts</h3><small>Verified recipient gifts</small></span>'+
      '<b class="ag-value">'+fmt(totalWeek)+'</b></div>'+
      '<div class="ag-panel ag-row">'+image(icon('ranking'),'Room Time','ag-icon')+
      '<span class="ag-grow"><h3>Team Room Activity Today</h3>'+
      '<small>Sum of verified Host presence • UTC</small></span>'+
      '<b class="ag-value">'+roomTime(teamToday)+'</b></div>'+
      '<details class="ag-panel ag-days-collapse"><summary>Owner Daily Room Activity (UTC)</summary>'+
      dayActivity(agency.owner_activity_by_day)+'</details>'+
      '<h2>Host Roster <small>'+esc(today())+'</small></h2>'+
      '<input type="search" class="ag-search" aria-label="Search Host ID" '+
      'placeholder="Search Host ID or name" data-ag-search>'+
      '<div class="ag-period"><button data-ag-filter="all" aria-pressed="true">All</button>'+
      '<button data-ag-filter="active" aria-pressed="false">Active</button>'+
      '<button data-ag-filter="review" aria-pressed="false">Review</button></div>'+
      '<div data-ag-hosts></div>'+
      '<button type="button" class="ag-big-button" data-ag-add>'+image(icon('host'))+
      'Invite / Assign Host</button><p class="ag-muted" data-ag-notice></p>','agency');
    let filter='all',query='';
    const draw=()=>{
      const matches=hosts.filter(h=>(filter==='all'||(filter==='active'?!!h.active:!h.active))&&
        (String(h.public_id).includes(query)||String(h.name).toLowerCase().includes(query)));
      panel.querySelector('[data-ag-hosts]').innerHTML=matches.map(h=>
        '<button type="button" class="ag-card" data-ag-host="'+esc(h.public_id)+'">'+
        portrait(h.pic)+'<span class="ag-grow"><h3>'+esc(h.name)+'</h3>'+
        '<small>Real ID '+esc(h.public_id)+' · '+(h.active?'Active Host':'Under Review')+'</small>'+
        '<small class="ag-time-label">Room Time Today: '+roomTime(h.today_seconds)+'</small></span>'+
        '<span class="ag-card-metric"><small>Today’s Gifts</small><span class="ag-value">'+fmt(h.today_gifts)+'</span></span>'+
        '<span class="ag-arrow">›</span></button>').join('')||
        '<div class="ag-empty">No matching verified hosts.</div>';
      panel.querySelectorAll('[data-ag-host]').forEach(button=>button.onclick=()=>
        show('host',button.dataset.agHost));
    };
    draw();
    panel.querySelector('[data-ag-search]').oninput=event=>{
      query=event.target.value.trim().toLowerCase();draw();
    };
    panel.querySelectorAll('[data-ag-filter]').forEach(button=>button.onclick=()=>{
      filter=button.dataset.agFilter;
      panel.querySelectorAll('[data-ag-filter]').forEach(b=>b.setAttribute('aria-pressed',
        String(b===button)));draw();
    });
    panel.querySelector('[data-ag-add]').onclick=async()=>{
      const id=window.prompt('Enter the approved Agency member’s 8-digit ID:');
      if(id===null)return;
      if(!/^[0-9]{8}$/.test(id))return notice('Enter an 8-digit User ID.');
      try{
        await api('POST','/agency/hosts/assign',{
          agency_id:Number(agency.id),host_public_id:id,active:true
        });
        notice('Host assigned successfully. Refreshing roster…');
        await show('agency',agency.id,undefined,false);
      }catch(error){
        notice('Host assignment not saved: '+String(error?.message||error)+
          '. Host must first accept the Royal Family invitation.');
      }
    };
  }
  function renderHost(data){
    const host=data.host||{},period=data.period||'today';
    const gifts=data.gifts||[];
    const days=data.activity_by_day||[],rooms=data.activity_by_room||[];
    const item=g=>'<div class="ag-activity">'+
      image(icon('gifts'),'Gift','ag-gift-icon')+
      '<span class="ag-grow"><b>'+esc(g.gift_name)+'</b><small>From ID '+esc(g.sender_id)+
      ' • '+readableDate(g.created_at)+'</small></span><span class="ag-value">+'+
      fmt(g.gift_coins)+'</span></div>';
    shell('Host Earnings',
      '<div class="ag-title"><h1 style="font-size:26px">Host Earnings</h1></div>'+
      '<div class="ag-host-head">'+portrait(host.pic,'host',true)+
      '<div><h2>'+esc(host.name)+'</h2><p class="ag-real-id">Real ID '+esc(host.public_id)+'</p>'+
      '<span class="ag-chip ag-positive">'+(host.active?'● Active Host':'● Under Review')+'</span>'+
      '<p class="ag-muted">'+esc(host.agency_name)+'</p></div></div>'+
      '<div class="ag-panel">'+image(icon('reports'))+' &nbsp; '+esc(today())+'</div>'+
      '<div class="ag-period"><button data-ag-period="today" aria-pressed="'+(period==='today')+'">Today</button>'+
      '<button data-ag-period="week" aria-pressed="'+(period==='week')+'">7 Days</button>'+
      '<button data-ag-period="month" aria-pressed="'+(period==='month')+'">Month</button></div>'+
      '<div class="ag-hero"><small>Estimated Host Salary</small>'+
      '<div class="ag-hero-row">'+image(icon('salary'),'Salary','ag-icon')+
      '<strong>'+coinUnits(data.estimated_salary_units)+'</strong></div>'+
      '<small>coins • Pending approval</small></div>'+
      '<div class="ag-stat-grid"><div class="ag-stat">'+image(icon('gifts'))+
      '<small>Qualifying Gift Events</small><strong>'+fmt(data.qualified_gift_events)+'</strong></div>'+
      '<div class="ag-stat">'+image(icon('ranking'))+
      '<small>Verified Room Time</small><strong class="ag-time-value">'+roomTime(data.active_seconds)+
      '</strong></div></div>'+
      '<div class="ag-panel"><h3>Daily Room Activity</h3>'+
      '<small>Server-verified room presence • UTC days</small>'+
      dayActivity(days)+'</div>'+
      '<div class="ag-panel"><h3>Time by Room · '+esc(period)+'</h3>'+
      (rooms.map(room=>'<div class="ag-activity ag-time-row">'+
        image(icon('host'),'Voice room','ag-gift-icon')+
        '<span class="ag-grow"><b>'+esc(room.room_name)+'</b>'+
        '<small>Room ID '+esc(room.room_id)+'</small></span>'+
        '<span class="ag-value">'+roomTime(room.seconds)+'</span></div>').join('')||
        '<div class="ag-empty">No verified time in rooms during this period.</div>')+'</div>'+
      '<div class="ag-panel"><h3>Monthly Target</h3>'+
      '<p class="ag-muted">Admin has not configured a verified target yet.</p></div>'+
      '<div class="ag-panel"><h3>Gift Activity</h3><small>'+esc(period)+' • Gift values in coins</small>'+
      (gifts.map(item).join('')||'<div class="ag-empty">No qualifying gifts for this period.</div>')+'</div>'+
      '<button type="button" class="ag-big-button" data-ag-salary>'+image(icon('salary'))+
      'View Salary Statement</button>'+
      '<button type="button" class="ag-big-button" data-ag-transactions>'+image(icon('commission'))+
      'Coin Transactions</button><p class="ag-muted" data-ag-notice></p>','host');
    panel.querySelectorAll('[data-ag-period]').forEach(button=>button.onclick=()=>
      show('host',host.public_id,button.dataset.agPeriod,false));
    panel.querySelector('[data-ag-salary]').onclick=()=>{
      window.alert('Verified '+period+' host salary estimate: '+
        coinUnits(data.estimated_salary_units)+' coins. Status: Pending Admin approval. '+
        'This is not yet credited to your wallet.');
    };
    panel.querySelector('[data-ag-transactions]').onclick=()=>show('transactions');
  }
  async function renderTransactions(token){
    const wallet=await api('GET','/wallet');
    if(token!==generation)return;
    const list=wallet.ledger||[];
    shell('Coin Transactions',title('Coin Transactions')+
      '<div class="ag-stat-grid"><div class="ag-stat"><small>Coins</small><strong>'+fmt(wallet.coins)+'</strong></div>'+
      '<div class="ag-stat"><small>Diamonds</small><strong>'+fmt(wallet.diamonds)+'</strong></div></div>'+
      '<div class="ag-panel"><h3>Verified Wallet Ledger</h3>'+list.map(entry=>
        '<div class="ag-activity"><span class="ag-grow"><b>'+esc(entry.reason)+'</b>'+
        '<small>'+esc(entry.currency)+' • '+readableDate(entry.created_at)+'</small></span>'+
        '<span class="ag-value">'+(entry.delta>0?'+':'')+fmt(entry.delta)+'</span></div>').join('')+
      (list.length?'':'<div class="ag-empty">No wallet transactions yet.</div>')+'</div>'+
      '<p class="ag-muted">Pending Host/Agency/BD earnings are not wallet coins.</p>','reports');
  }
  async function renderReports(token){
    if(me?.bd?.active){
      const data=await api('GET','/agency/bd/center');
      if(token!==generation)return;
      const families=data.families||[];
      shell('BD Reports',title('BD Reports','This Week')+
        '<div class="ag-hero">'+image(icon('reports'),'Reports','ag-icon')+
        '<h3>Estimated BD Earnings</h3><strong>'+coinUnits(data.pending_bd_units)+'</strong>'+
        '<span class="ag-chip">Pending Admin verification</span></div>'+
        families.map(f=>'<button class="ag-card" data-ag-agency="'+esc(f.id)+'">'+
          portrait(f.logo,'agency')+'<span class="ag-grow"><h3>'+esc(f.name)+'</h3>'+
          '<small>'+fmt(f.hosts)+' hosts</small></span><b class="ag-value">'+
          fmt(f.week_gifts)+'</b><span class="ag-arrow">›</span></button>').join('')+
        '<p class="ag-muted">Statement figures are projections, not an approved payout.</p>','reports');
      panel.querySelectorAll('[data-ag-agency]').forEach(b=>b.onclick=()=>show('agency',Number(b.dataset.agAgency)));
    }else if(me?.agency){show('agency',me.agency.id,undefined,false);}
    else if(me?.host?.active){show('host',me.host.public_id,'month',false);}
    else renderUnassigned();
  }
  async function show(type,id,period,keepHistory=true){
    ensurePanel();panel.hidden=false;
    if(keepHistory&&lastView&&type!=='overview')stack.push(lastView);
    lastView={type,id,period};
    if(type==='overview')return showOverview();
    if(type==='unassigned')return renderUnassigned();
    loading();const token=++generation;
    try{
      if(type==='bd'){
        const data=await api('GET','/agency/bd/center');
        if(token===generation)renderBd(data);
      }else if(type==='agency'){
        const data=await api('GET','/agency/'+encodeURIComponent(String(id))+'/hosts');
        if(token===generation)renderAgency(data);
      }else if(type==='host'){
        const data=await api('GET','/agency/host/'+encodeURIComponent(String(id))+
          '/earnings?period='+(period||'today'));
        if(token===generation)renderHost(data);
      }else if(type==='transactions')await renderTransactions(token);
      else if(type==='reports')await renderReports(token);
    }catch(error){if(token===generation)fail(error);}
  }
  async function open(prefer){
    ensurePanel();panel.hidden=false;stack=[];lastView=null;loading();
    const token=++generation;
    try{
      me=await api('GET','/agency/me');
      if(token!==generation)return;
      // Host's own public ID can be obtained from the authenticated profile,
      // but we avoid guessing: the /agency/me API supplies it directly.
      if(prefer==='bd'&&me.bd?.active)return show('bd');
      return showOverview();
    }catch(error){if(token===generation)fail(error);}
  }
  window.sharikaOpenAgencyCenter=open;
  window.sharikaAgencyBack=back;
  window.sharikaCloseAgencyCenter=close;
})();
