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
    const tabs=[['home','Overview'],['agency','Agencies'],['reports','Reports'],
      ['salary','Salary'],['host','Profile']];
    return '<nav class="ag-bottom" aria-label="Agency navigation">'+
      tabs.map(([key,title])=>'<button type="button" data-ag-tab="'+key+'" '+
        (current===key?'aria-current="page"':'')+'>'+image(icon(key==='home'?'agency':
          key==='agency'?'host':key==='reports'?'reports':key==='salary'?'salary':'bd'))+
          esc(title)+'</button>').join('')+'</nav>';
  }
  function shell(title,body,tab='home'){
    panel.innerHTML='<div class="ag-shell"><div class="ag-header">'+
      '<button type="button" class="ag-back" aria-label="Go back">‹</button>'+
      '<strong><span>SHARIKA</span> <i>│</i> '+esc(title.toUpperCase())+'</strong>'+
      image(icon('bd'),'BD emblem','ag-logo-mini')+
      '<button type="button" class="ag-refresh" aria-label="Refresh '+esc(title)+'">↻</button>'+
      '</div>'+body+'</div>'+(tab==='bd'||tab==='salary'||tab==='unassigned'?'':footer(tab));
    panel.querySelector('.ag-header img').style.cssText='width:41px;height:41px;object-fit:contain';
    panel.querySelector('.ag-back').onclick=back;
    panel.querySelector('.ag-refresh').onclick=()=>show(lastView?.type||'overview',
      lastView?.id,lastView?.period,false);
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
      else if(selected==='salary')show('salary');
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
  async function renderUnassigned(token){
    const [discovery,applications]=await Promise.all([
      api('GET','/agency/discover'),api('GET','/agency/create/requests')]);
    if(token!==generation)return;
    const agencies=discovery.families||[],requests=applications.requests||[];
    shell('Agency Center',title('Discover Agency')+
      '<div class="ag-hero">'+image(icon('agency'),'Agency crest','ag-icon')+
      '<h3>BD • Agency • Host</h3><p>Choose an approved Agency or apply to create one.</p></div>'+
      '<div class="ag-panel"><h3>Apply to Create an Agency</h3>'+
      '<p class="ag-muted">Super Admin approval and an active BD assignment are required.</p>'+
      '<label>Agency name<input data-ag-create-name class="ag-search" maxlength="40" '+
      'placeholder="Royal Agency Name"></label>'+
      '<button type="button" class="ag-big-button" data-ag-create-request>Submit Application</button>'+
      (requests.length?'<p class="ag-muted">Your previous applications: '+
        requests.slice(0,3).map(r=>esc(r.name)+' ('+esc(r.state)+')').join(' • ')+'</p>':'')+
      '<p class="ag-muted" data-ag-notice></p></div>'+
      '<h2>Registered Agencies</h2><div class="ag-agency-discovery">'+
      (agencies.length?agencies.map(a=>'<div class="ag-card">'+portrait(a.logo,'agency')+
        '<span class="ag-grow"><h3>'+esc(a.name)+'</h3><small>Owner ID '+esc(a.owner_id)+
        ' · '+fmt(a.member_count)+' members</small></span>'+
        '<button type="button" class="ag-mini-button" data-ag-join="'+esc(a.id)+'">Apply to Join</button></div>').join(''):
        '<div class="ag-empty">No approved Agencies yet. Submit a new application.</div>')+
      '</div>','unassigned');
    panel.querySelector('[data-ag-create-request]').onclick=async()=>{
      const name=panel.querySelector('[data-ag-create-name]').value.trim();
      if(name.length<3||name.length>40)return notice('Enter an Agency name of 3–40 characters.');
      const button=panel.querySelector('[data-ag-create-request]');button.disabled=true;
      try{await api('POST','/agency/create/request',{name,description:'',accept_rules:true});
        notice('Application received. The Super Admin must approve it and assign a BD.');
      }catch(error){button.disabled=false;notice('Application failed: '+String(error?.message||error));}
    };
    panel.querySelectorAll('[data-ag-join]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await api('POST','/agency/join',{family_id:Number(button.dataset.agJoin)});
        button.textContent='Pending Owner Approval';
      }catch(error){button.disabled=false;notice('Join request failed: '+String(error?.message||error));}
    });
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
    shell('BD Center',
      '<div class="ag-identity">'+portrait(bd.pic,'bd',true)+
      '<div class="ag-grow"><h3>'+esc(bd.name)+'</h3><span class="ag-chip ag-bd-pill">BD</span>'+
      '<p>ID: '+esc(bd.public_id)+'</p></div>'+
      image(icon('bd'),'BD badge','ag-role-emblem')+'</div>'+
      '<h2 class="ag-section-title">BD Services</h2>'+
      '<div class="ag-service-grid">'+
      '<button type="button" data-ag-grant>'+image(icon('host'))+'Invite Agent ›</button>'+
      '<button type="button" data-ag-list>'+image(icon('ranking'))+'Team Members ›</button>'+
      '<button type="button" data-ag-assistant>'+image(icon('bd'))+'Assistant BD ›</button>'+
      '<button type="button" data-ag-hosts>'+image(icon('agency'))+'Agency Hosts ›</button></div>'+
      '<h2 class="ag-section-title">My Income</h2><div class="ag-income-grid">'+
      '<div>'+image(icon('salary'))+'<span><small>BD Salary</small><b>Pending review</b></span></div>'+
      '<div>'+image(icon('commission'))+'<span><small>Team Income</small><b>'+
      coinUnits(data.pending_bd_units)+' coins</b></span></div></div>'+
      '<button type="button" class="ag-big-button ag-purple-action" data-ag-salary-wallet>'+
      image(icon('salary'))+'Open Wallet ›</button>'+
      '<details class="ag-panel ag-days-collapse"><summary>Verified BD Activity • UTC</summary>'+
      '<p>This week: '+fmt(totalGifts)+' qualifying gift coins • Today in rooms: '+
      roomTime(data.today_active_seconds)+'</p>'+dayActivity(data.bd_activity_by_day)+'</details>'+
      '<section class="ag-bd-assigned"><h2>Assigned Agencies ('+agencies.length+')</h2>'+
      (rows||'<div class="ag-empty">No agencies have been assigned to this BD account.</div>')+
      '</section><p class="ag-muted" data-ag-notice></p>'+
      '<button type="button" class="ag-big-button" data-ag-reports>'+image(icon('reports'))+
      'View Detailed Reports</button>','bd');
    panel.querySelectorAll('[data-ag-agency]').forEach(button=>button.onclick=()=>
      show('agency',Number(button.dataset.agAgency)));
    panel.querySelector('[data-ag-reports]').onclick=()=>show('reports');
    panel.querySelector('[data-ag-salary-wallet]').onclick=()=>show('salary');
    panel.querySelector('[data-ag-grant]').onclick=()=>{
      if(!me?.bd?.can_grant)return notice('Agency grants require Super Admin BD permission.');
      show('grant');
    };
    panel.querySelector('[data-ag-assistant]').onclick=()=>notice(
      'Assistant BD permission is managed by Super Admin. No assistants are assigned automatically.');
    for(const selector of ['[data-ag-list]','[data-ag-hosts]'])
      panel.querySelector(selector).onclick=()=>panel.querySelector('.ag-bd-assigned')?.scrollIntoView({behavior:'smooth'});
  }
  function renderGrant(){
    if(!me?.bd?.active||!me?.bd?.can_grant){
      renderUnassigned(generation);return;
    }
    shell('BD • Invite Agent',title('Grant Agency')+
      '<div class="ag-panel"><h3>Assign a new Agency Owner</h3>'+
      '<p class="ag-muted">Only an active BD with grant permission may create an Agency. '+
      'The Owner must have an active account and not belong to another Agency.</p>'+
      '<label>Owner ID<input class="ag-search" data-ag-grant-owner inputmode="numeric" maxlength="8" '+
      'placeholder="8-digit user ID"></label>'+
      '<label>Agency Name<input class="ag-search" data-ag-grant-name maxlength="40" '+
      'placeholder="Royal Agency"></label>'+
      '<button type="button" class="ag-big-button" data-ag-grant-submit>Confirm BD Grant</button>'+
      '<p class="ag-muted" data-ag-notice></p></div>','bd');
    panel.querySelector('[data-ag-grant-submit]').onclick=async()=>{
      const owner=panel.querySelector('[data-ag-grant-owner]').value.trim();
      const name=panel.querySelector('[data-ag-grant-name]').value.trim();
      if(!/^[0-9]{8}$/.test(owner)||name.length<3||name.length>40)
        return notice('Enter a valid Owner ID and Agency name.');
      const button=panel.querySelector('[data-ag-grant-submit]');button.disabled=true;
      try{
        await api('POST','/agency/bd/grant',{owner_public_id:owner,name,
          request_id:'agency:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2,13)});
        notice('Agency granted ✓ Owner '+owner+' can now open the Agency Dashboard.');
      }catch(error){button.disabled=false;notice('BD grant failed: '+String(error?.message||error));}
    };
  }
  async function renderRequests(token){
    const data=await api('GET','/agency/requests');
    if(token!==generation)return;
    const requests=data.requests||[];
    shell('Agency Requests',title('Join Requests')+
      '<div class="ag-panel"><h3>Owner Approval</h3><p class="ag-muted">'+
      'Accept only people who should join your Agency. This does not transfer coins.</p>'+
      (requests.map(r=>'<div class="ag-activity"><span class="ag-grow"><b>'+esc(r.name)+
        '</b><small>ID '+esc(r.public_id)+' · '+readableDate(r.created_at)+'</small></span>'+
        '<button type="button" class="ag-mini-button" data-ag-accept="'+esc(r.id)+'">Accept</button>'+
        '<button type="button" class="ag-mini-button" data-ag-reject="'+esc(r.id)+'">Reject</button></div>').join('')||
        '<p class="ag-empty">No pending requests.</p>')+
      '<p class="ag-muted" data-ag-notice></p></div>','agency');
    panel.querySelectorAll('[data-ag-accept],[data-ag-reject]').forEach(button=>button.onclick=async()=>{
      const action=button.hasAttribute('data-ag-accept')?'accept':'reject';
      const id=button.dataset.agAccept||button.dataset.agReject;
      button.disabled=true;
      try{await api('POST','/agency/requests/'+id+'/'+action,{});
        await show('requests',undefined,undefined,false);
      }catch(error){button.disabled=false;notice('Review failed: '+String(error?.message||error));}
    });
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
      (agency.viewer_can_manage?'<button type="button" class="ag-big-button" data-ag-requests>'+
        image(icon('reports'))+'Review Join Requests</button>':'' )+
      (agency.viewer_can_manage?'<button type="button" class="ag-big-button" data-ag-add>'+image(icon('host'))+
        'Assign Approved Host</button>':'')+
      '<button type="button" class="ag-big-button" data-ag-salary-wallet>'+image(icon('salary'))+
      'Salary Wallet & Exchange</button><p class="ag-muted" data-ag-notice></p>','agency');
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
    panel.querySelector('[data-ag-requests]')?.addEventListener('click',()=>show('requests'));
    const assignHost=panel.querySelector('[data-ag-add]');
    if(assignHost)assignHost.onclick=async()=>{
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
          '. Host must first be approved for this Agency.');
      }
    };
    panel.querySelector('[data-ag-salary-wallet]').onclick=()=>show('salary');
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
      '<div class="ag-panel"><h3>Host Gift Target</h3>'+
      '<p>Received gifts: <b>'+fmt(data.target_progress_coins)+'</b> coins</p>'+
      (data.targets||[]).map(t=>'<div class="ag-activity ag-time-row"><span class="ag-grow">'+
        '<b>'+fmt(t.target_coins)+'</b><small>Admin-configured target</small></span>'+
        '<span class="ag-chip">'+(t.completed?'✓ Reached':'In progress')+'</span></div>').join('')+
      '</div>'+
      '<div class="ag-panel"><h3>Gift Activity</h3><small>'+esc(period)+' • Gift values in coins</small>'+
      (gifts.map(item).join('')||'<div class="ag-empty">No qualifying gifts for this period.</div>')+'</div>'+
      '<button type="button" class="ag-big-button" data-ag-salary>'+image(icon('salary'))+
      'Salary Wallet & Exchange</button>'+
      '<button type="button" class="ag-big-button" data-ag-transactions>'+image(icon('commission'))+
      'Coin Transactions</button><p class="ag-muted" data-ag-notice></p>','host');
    panel.querySelectorAll('[data-ag-period]').forEach(button=>button.onclick=()=>
      show('host',host.public_id,button.dataset.agPeriod,false));
    panel.querySelector('[data-ag-salary]').onclick=()=>show('salary');
    panel.querySelector('[data-ag-transactions]').onclick=()=>show('transactions');
  }
  async function renderSalary(token){
    const latest=await api('GET','/agency/me');
    if(token!==generation)return;
    me=latest;
    const salary=latest.salary||{},history=latest.salary_exchanges||[];
    const maximum=Math.floor((Number(salary.matured_available_units)||0)/10000);
    const eligible=!!salary.exchange_enabled&&maximum>0;
    const role=latest.host?.active?'Host':latest.agency?'Agency Owner':
      latest.bd?.active?'BD':'Not assigned';
    const targets=(latest.targets||[]).map(target=>
      '<span class="ag-chip">'+fmt(target.target_coins)+' coins</span>').join(' ');
    shell('Agency Wallet',
      '<h2 class="ag-section-title">Wallet <small>'+esc(role)+'</small></h2>'+
      '<div class="ag-wallet-metrics">'+
      '<div>'+image(icon('salary'))+'<span><small>Available Earnings</small><b>'+
      (salary.exchange_enabled?fmt(maximum):'—')+'</b></span></div>'+
      '<div>'+image(icon('bd'))+'<span><small>Pending Verification</small><b>'+
      coinUnits(Math.max(0,(Number(salary.earned_units)||0)-(Number(salary.exchanged_units)||0)-
        (Number(salary.matured_available_units)||0)))+'</b></span></div></div>'+
      '<div class="ag-service-grid ag-wallet-nav">'+
      '<button type="button" data-ag-detail>'+image(icon('reports'))+'Details</button>'+
      '<button type="button" data-ag-history>'+image(icon('commission'))+'Transfer Records</button></div>'+
      '<div class="ag-wallet-actions">'+
      '<button type="button" data-ag-seller>'+image(icon('host'))+'Transfer to Seller</button>'+
      '<button type="button" class="ag-wallet-action-selected">'+image(icon('gifts'))+
      'Exchange to Coins</button>'+
      '<button type="button" data-ag-wallet-ledger>'+image(icon('ranking'))+'Coin Ledger</button></div>'+
      '<div class="ag-panel ag-exchange-rate">'+image(icon('reports'))+
      '<span class="ag-grow"><b>Admin-set Rate</b><small>10,000 salary units = 1 virtual coin</small></span>'+
      '<b>1 USD reference = '+fmt(salary.coins_per_usd)+' coins</b></div>'+
      '<h2 class="ag-section-title">Amount</h2>'+
      '<div class="ag-panel"><label class="ag-wallet-label">Virtual Coins to Exchange</label>'+
      '<input type="number" min="1" step="1" max="'+esc(maximum)+'" '+
      'class="ag-search" placeholder="Enter whole coins (up to '+fmt(maximum)+')" data-ag-salary-coins '+
      (eligible?'':'disabled')+' aria-label="Salary exchange coins">'+
      '<p class="ag-muted">Already exchanged: '+coinUnits(salary.exchanged_units)+' coins • '+
      'Settlement: '+esc(salary.settlement_mode||'weekly')+' • Target: '+
      fmt(salary.min_host_target_coins)+' received gift coins.</p>'+
      '<p class="ag-muted">'+(salary.exchange_enabled?
        'Only verified earnings from completed periods can be converted.':
        'Admin has not yet enabled exchange for this wallet.')+'</p>'+
      '<p class="ag-muted">Target tiers: '+targets+'</p></div>'+
      '<button type="button" class="ag-big-button ag-purple-action" data-ag-exchange '+
      (eligible?'':'disabled')+'>'+image(icon('commission'))+
      'Confirm Exchange</button><p class="ag-muted" data-ag-notice></p>'+
      '<div class="ag-panel"><h3>Exchange Records</h3>'+
      (history.map(item=>'<div class="ag-activity"><span class="ag-grow"><b>'+
        fmt(item.credited_coins)+' coins</b><small>'+esc(item.settlement_mode)+' • '+
        readableDate(item.created_at)+'</small></span><span class="ag-value">✓</span></div>')
        .join('')||'<div class="ag-empty">No salary exchanges recorded.</div>')+'</div>'+
      '<p class="ag-muted">This is virtual app currency only. No bank transfer or cash withdrawal.</p>','salary');
    panel.querySelector('[data-ag-detail]').onclick=()=>show('reports');
    panel.querySelector('[data-ag-history]').onclick=()=>show('transactions');
    panel.querySelector('[data-ag-wallet-ledger]').onclick=()=>show('transactions');
    panel.querySelector('[data-ag-seller]').onclick=()=>notice(
      'Agency salary cannot be transferred to a Seller. Only verified exchange to the in-app coin wallet is available.');
    panel.querySelector('[data-ag-exchange]').onclick=async()=>{
      const field=panel.querySelector('[data-ag-salary-coins]');
      const coins=Number(field?.value);
      if(!Number.isSafeInteger(coins)||coins<1||coins>maximum)
        return notice('Enter a whole coin amount within your verified available salary.');
      const button=panel.querySelector('[data-ag-exchange]');
      button.disabled=true;
      try{
        await api('POST','/agency/salary/exchange',{
          coins,expected_version:salary.policy_version,
          request_id:'salary:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2,13)
        });
        await show('salary',undefined,undefined,false);
      }catch(error){
        button.disabled=false;
        notice('Exchange was not completed: '+String(error?.message||error));
      }
    };
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
    loading();const token=++generation;
    try{
      if(type==='unassigned')await renderUnassigned(token);
      else if(type==='grant')renderGrant();
      else if(type==='requests')await renderRequests(token);
      else if(type==='salary')await renderSalary(token);
      else if(type==='bd'){
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
      if(prefer==='agency'&&me.agency)return show('agency',me.agency.id);
      if(prefer==='host'&&me.host?.active&&me.host.public_id)
        return show('host',me.host.public_id);
      return showOverview();
    }catch(error){if(token===generation)fail(error);}
  }
  window.sharikaOpenAgencyCenter=open;
  window.sharikaAgencyBack=back;
  window.sharikaCloseAgencyCenter=close;
})();
