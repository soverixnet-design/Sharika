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
  let panel=null,me=null,stack=[],generation=0,lastView=null,lastPreferredView='overview';
  const LOAD_LIMIT_MS=15000;
  function withDeadline(promise){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Agency connection timed out. Please retry.')),
        LOAD_LIMIT_MS);
    })]).finally(()=>clearTimeout(timer));
  }
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
      '<h1>Agency Center</h1></div><div class="ag-empty" role="status">Loading verified records…</div>');
  }
  function fail(error){
    shell('Unavailable','<div class="ag-title"><h1>Agency Center</h1></div>'+
      '<p class="ag-error">Unable to load verified data: '+esc(error?.message||error)+
      '</p><p class="ag-muted">Check your connection or account permissions. No salary or wallet data was changed.</p>'+
      '<button type="button" class="ag-big-button" data-ag-retry>↻ Retry Agency Center</button>');
    const failed=lastView;
    panel.querySelector('[data-ag-retry]').onclick=()=>{
      if(failed&&failed.type!=='overview')show(failed.type,failed.id,failed.period,false);
      else open(lastPreferredView);
    };
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
      '<h3>Agency / BD / Host</h3><p>Verified membership and approval</p></div>'+
      '<div class="ag-empty">You do not have an active Agency Owner, BD, or Host role yet.'+
      '<p>Explore Agencies, request to join, or apply to create your own Agency.</p></div>'+
      '<button type="button" class="ag-big-button" data-ag-directory>'+
      image(icon('agency'),'Agency directory')+'Explore & Join Agencies</button>','agency');
    panel.querySelector('[data-ag-directory]').onclick=()=>show('directory');
  }
  async function renderDirectory(token){
    const [catalog,membership,creation]=await Promise.all([
      api('GET','/family/discover?sort=recommend'),
      api('GET','/family/me'),
      api('GET','/family/creation/requests')
    ]);
    if(token!==generation)return;
    const agencies=catalog.families||[],joined=membership.family,
      applications=membership.applications||[],invites=membership.invitations||[],
      creationRequests=creation.requests||[];
    const status=joined?'<div class="ag-panel"><b>Current Agency: '+esc(joined.name)+
      '</b><p class="ag-muted">You are an approved member. The Agency Owner must assign an active Host role before Host earnings appear.</p></div>':
      '<p class="ag-muted">Tap Apply to request membership. The Agency Owner must approve.</p>';
    const pending=applications.map(x=>'<div class="ag-activity"><span class="ag-grow"><b>'+
      esc(x.family_name)+'</b><small>Membership request</small></span><span class="ag-chip">'+
      esc(x.state)+'</span></div>').join('');
    const invitationRows=invites.map(x=>'<div class="ag-card">'+
      image(icon('agency'),'Agency invitation','ag-gift-icon')+
      '<span class="ag-grow"><b>'+esc(x.family_name)+'</b><small>Invitation received</small></span>'+
      '<button type="button" data-ag-invite-accept="'+esc(x.id)+'">Join</button>'+
      '<button type="button" data-ag-invite-decline="'+esc(x.id)+'">Decline</button></div>').join('');
    const requestRows=creationRequests.map(x=>'<div class="ag-activity">'+
      '<span class="ag-grow"><b>'+esc(x.name)+'</b><small>'+esc(x.decision_reason||
      'Agency creation application')+'</small></span><span class="ag-chip">'+esc(x.state)+
      '</span></div>').join('');
    const cards=agencies.map(x=>'<button type="button" class="ag-card" data-ag-join="'+
      esc(x.id)+'" '+(joined?'disabled':'')+'>'+
      portrait(x.logo,'agency')+'<span class="ag-grow"><h3>'+esc(x.name)+'</h3>'+
      '<small>Owner: '+esc(x.owner_name)+' · '+esc(x.owner_id)+'</small>'+
      '<small>'+fmt(x.member_count)+' / '+fmt(x.max_members)+' members</small></span>'+
      '<span class="ag-arrow">'+(joined?'✓':'Apply ›')+'</span></button>').join('');
    shell('Agency Directory',title('Discover Agencies')+
      status+
      (invitationRows?'<div class="ag-panel"><h3>Invitations</h3>'+invitationRows+'</div>':'')+
      (pending?'<div class="ag-panel"><h3>My Join Requests</h3>'+pending+'</div>':'')+
      '<input type="search" class="ag-search" placeholder="Search Agencies" '+
      'aria-label="Search Agencies" data-ag-directory-search>'+
      '<div data-ag-directory-list>'+cards+'</div>'+
      '<div class="ag-panel"><h3>Apply to Create an Agency</h3>'+
      '<p class="ag-muted">Creation requires Super Admin approval and an active BD assignment.</p>'+
      '<input class="ag-search" maxlength="40" placeholder="Agency name (3–40 characters)" '+
      'aria-label="Agency name" data-ag-create-name>'+
      '<textarea class="ag-search" maxlength="240" placeholder="Description (optional)" '+
      'aria-label="Agency description" data-ag-create-description></textarea>'+
      '<label><input type="checkbox" data-ag-create-agree> I agree to the Agency rules.</label>'+
      '<button type="button" class="ag-big-button" data-ag-create'+(joined?' disabled':'')+'>'+
      image(icon('agency'))+'Send Agency Application</button>'+
      (requestRows?'<h3>My Creation Requests</h3>'+requestRows:'')+
      '<p class="ag-muted" role="status" data-ag-notice></p></div>','agency');
    const list=panel.querySelector('[data-ag-directory-list]');
    panel.querySelector('[data-ag-directory-search]').oninput=event=>{
      const q=String(event.target.value||'').trim().toLowerCase();
      list.querySelectorAll('[data-ag-join]').forEach(button=>{
        const item=agencies.find(x=>String(x.id)===button.dataset.agJoin);
        button.hidden=!!q&&!String(item?.name||'').toLowerCase().includes(q);
      });
    };
    panel.querySelectorAll('[data-ag-join]').forEach(button=>button.onclick=async()=>{
      const agency=agencies.find(x=>String(x.id)===button.dataset.agJoin);
      if(!agency||!window.confirm('Request to join '+agency.name+'? The Owner must approve.'))return;
      button.disabled=true;
      try{await api('POST','/family/join',{family_id:Number(agency.id)});
        await show('directory',undefined,undefined,false);}
      catch(error){button.disabled=false;notice('Request not saved: '+String(error?.message||error));}
    });
    panel.querySelectorAll('[data-ag-invite-accept],[data-ag-invite-decline]').forEach(button=>{
      button.onclick=async()=>{
        const accept=button.hasAttribute('data-ag-invite-accept');
        const id=accept?button.dataset.agInviteAccept:button.dataset.agInviteDecline;
        button.disabled=true;
        try{await api('POST','/family/invites/'+encodeURIComponent(id)+
          (accept?'/accept':'/decline'),{});
          await show('directory',undefined,undefined,false);}
        catch(error){button.disabled=false;notice('Invitation update failed: '+String(error?.message||error));}
      };
    });
    panel.querySelector('[data-ag-create]').onclick=async()=>{
      const name=panel.querySelector('[data-ag-create-name]').value.trim();
      const description=panel.querySelector('[data-ag-create-description]').value.trim();
      const agree=panel.querySelector('[data-ag-create-agree]').checked;
      if(name.length<3||name.length>40||!agree)
        return notice('Enter a 3–40 character Agency name and accept the rules.');
      const button=panel.querySelector('[data-ag-create]');button.disabled=true;
      try{await api('POST','/family/creation/request',{name,description,accept_rules:true});
        await show('directory',undefined,undefined,false);}
      catch(error){button.disabled=false;notice('Application not saved: '+String(error?.message||error));}
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
      '<button type="button" class="ag-big-button" data-ag-salary-wallet>'+image(icon('salary'))+
      'Salary Wallet & Exchange</button>'+
      '<button type="button" class="ag-big-button" data-ag-reports>'+image(icon('reports'))+
      'View Agency Reports</button>','agency');
    panel.querySelectorAll('[data-ag-agency]').forEach(button=>button.onclick=()=>
      show('agency',Number(button.dataset.agAgency)));
    panel.querySelector('[data-ag-reports]').onclick=()=>show('reports');
    panel.querySelector('[data-ag-salary-wallet]').onclick=()=>show('salary');
  }
  function renderAgency(data){
    const agency=data.agency||{},hosts=data.hosts||[];
    const ownAgency=Number(me?.agency?.id)===Number(agency.id);
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
      (ownAgency?'<button type="button" class="ag-big-button" data-ag-manage>'+image(icon('agency'))+
      'Manage Members & Join Requests</button>'+
      '<button type="button" class="ag-big-button" data-ag-add>'+image(icon('host'))+
      'Assign an Approved Host</button>':'')+
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
    if(ownAgency)panel.querySelector('[data-ag-manage]').onclick=()=>show('members',agency.id);
    if(ownAgency)panel.querySelector('[data-ag-add]').onclick=async()=>{
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
  async function renderMembers(token,id){
    const [membership,pending,roster]=await Promise.all([
      api('GET','/family/me'),
      api('GET','/family/requests'),
      api('GET','/agency/'+encodeURIComponent(String(id))+'/hosts')
    ]);
    if(token!==generation)return;
    const agency=membership.family,requests=pending.requests||[],hosts=roster.hosts||[];
    if(!agency||Number(agency.id)!==Number(id)||agency.role!=='leader')
      throw Error('Only the Agency Owner can manage member approvals.');
    const hostById=new Map(hosts.map(h=>[String(h.public_id),h]));
    const applications=requests.map(req=>'<div class="ag-card">'+
      image(icon('host'),'Pending member','ag-gift-icon')+
      '<span class="ag-grow"><h3>'+esc(req.name)+'</h3><small>ID '+esc(req.public_id)+
      ' · Applied '+readableDate(req.created_at)+'</small></span>'+
      '<button type="button" data-ag-approve="'+esc(req.id)+'">Approve</button>'+
      '<button type="button" data-ag-reject="'+esc(req.id)+'">Reject</button></div>').join('')||
      '<div class="ag-empty">No membership requests waiting for approval.</div>';
    const memberCards=(agency.members||[]).map(member=>{
      const id=String(member.public_id),host=hostById.get(id);
      return '<div class="ag-card">'+portrait(member.pic,'host')+
        '<span class="ag-grow"><h3>'+esc(member.name)+'</h3>'+
        '<small>ID '+esc(id)+' · '+esc(member.role)+'</small>'+
        '<small>'+(host?(host.active?'Active Host':'Host paused'):'Approved member')+
        '</small></span><button type="button" data-ag-toggle-host="'+esc(id)+'" '+
        'data-ag-active="'+(host?.active?'0':'1')+'">'+
        (host?.active?'Pause Host':host?'Reactivate':'Activate Host')+
        '</button></div>';
    }).join('');
    shell('Agency Members',title('Manage Members',agency.name)+
      '<div class="ag-hero"><strong>'+fmt(agency.member_count)+'</strong>'+
      '<p>Verified approved members</p></div>'+
      '<div class="ag-panel"><h3>Invite a Member by ID</h3>'+
      '<input class="ag-search" maxlength="8" inputmode="numeric" '+
      'placeholder="8-digit User ID" aria-label="User ID" data-ag-member-invite>'+
      '<button type="button" class="ag-big-button" data-ag-send-invite>'+
      image(icon('host'))+'Send Agency Invitation</button></div>'+
      '<div class="ag-panel"><h3>Pending Join Requests ('+requests.length+')</h3>'+
      applications+'</div>'+
      '<div class="ag-panel"><h3>Approved Members & Host Roles</h3>'+
      '<p class="ag-muted">Only approved adult members may become active Hosts. '+
      'Host assignment affects future qualified gifts, not past earnings.</p>'+
      (memberCards||'<div class="ag-empty">No approved members yet.</div>')+
      '</div><p class="ag-muted" role="status" data-ag-notice></p>','agency');
    panel.querySelector('[data-ag-send-invite]').onclick=async()=>{
      const id=panel.querySelector('[data-ag-member-invite]').value.trim();
      if(!/^[0-9]{8}$/.test(id))return notice('Enter a valid 8-digit User ID.');
      const button=panel.querySelector('[data-ag-send-invite]');button.disabled=true;
      try{await api('POST','/family/invite',{public_id:id});
        notice('Invitation sent. The user must accept it.');}
      catch(error){notice('Invite failed: '+String(error?.message||error));}
      finally{button.disabled=false;}
    };
    panel.querySelectorAll('[data-ag-approve],[data-ag-reject]').forEach(button=>{
      button.onclick=async()=>{
        const approving=button.hasAttribute('data-ag-approve');
        const requestId=approving?button.dataset.agApprove:button.dataset.agReject;
        if(!window.confirm((approving?'Approve':'Reject')+' this Agency membership request?'))return;
        button.disabled=true;
        try{await api('POST','/family/requests/'+encodeURIComponent(requestId)+
          (approving?'/accept':'/reject'),{});
          await show('members',id,undefined,false);}
        catch(error){button.disabled=false;notice('Review failed: '+String(error?.message||error));}
      };
    });
    panel.querySelectorAll('[data-ag-toggle-host]').forEach(button=>button.onclick=async()=>{
      const userId=button.dataset.agToggleHost,active=button.dataset.agActive==='1';
      if(!window.confirm((active?'Activate':'Pause')+' Host '+userId+'?'))return;
      button.disabled=true;
      try{await api('POST','/agency/hosts/assign',{
        agency_id:Number(agency.id),host_public_id:userId,active
      });await show('members',id,undefined,false);}
      catch(error){button.disabled=false;notice('Host assignment failed: '+String(error?.message||error));}
    });
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
  let pendingSalarySellerTransfer=null;
  async function renderSalary(token){
    const [latest,directory]=await Promise.all([
      api('GET','/agency/me'),api('GET','/sellers').catch(()=>({sellers:[]}))
    ]);
    if(token!==generation)return;
    me=latest;
    const salary=latest.salary||{},history=latest.salary_exchanges||[];
    const sellerHistory=latest.salary_seller_transfers||[];
    const sellers=(directory.sellers||[]).filter(s=>/^[0-9]{8}$/.test(s.public_id));
    const maximum=Math.floor((Number(salary.matured_available_units)||0)/10000);
    const maxTransfer=Math.min(maximum,100000000);
    const eligible=!!salary.exchange_enabled&&maximum>0;
    const transferEligible=!!salary.seller_transfer_enabled&&maxTransfer>0&&sellers.length>0;
    const role=latest.host?.active?'Host':latest.agency?'Agency Owner':
      latest.bd?.active?'BD':'Not assigned';
    const targets=(latest.targets||[]).map(target=>
      '<span class="ag-chip">'+fmt(target.target_coins)+' coins</span>').join(' ');
    shell('Salary Wallet',title('Salary Wallet',role)+
      '<div class="ag-hero"><small>Verified Salary Earnings</small>'+
      '<div class="ag-hero-row">'+image(icon('salary'),'Salary','ag-icon')+
      '<strong>'+coinUnits(salary.earned_units)+'</strong></div>'+
      '<p>Salary units • 10,000 units = 1 coin</p></div>'+
      '<div class="ag-stat-grid"><div class="ag-stat"><small>Exchangeable Now</small>'+
      '<strong>'+fmt(maximum)+'</strong><small>coins</small></div>'+
      '<div class="ag-stat"><small>Already Exchanged</small><strong>'+
      coinUnits(salary.exchanged_units)+'</strong><small>coins</small></div>'+
      '<div class="ag-stat"><small>Sent to Coin Sellers</small><strong>'+
      coinUnits(salary.seller_transferred_units)+'</strong><small>coins</small></div></div>'+
      '<div class="ag-panel"><h3>Salary Rules</h3><p>Settlement: <b>'+
      esc(salary.settlement_mode||'weekly')+'</b> • Host minimum target: <b>'+
      fmt(salary.min_host_target_coins)+'</b> received gift coins</p>'+
      '<p>USD reference: $1 = '+fmt(salary.coins_per_usd)+' coins</p>'+
      '<p>Targets: '+targets+'</p>'+
      '<p class="ag-muted">Only completed-period, target-qualified gift salary can be exchanged. '+
      'Main Wallet Diamond Exchange is separate and available to all users.</p></div>'+
      '<div class="ag-panel"><h3>Exchange Salary to Coins</h3><p class="ag-muted">'+
      (salary.exchange_enabled?'Admin has enabled salary exchange.':
        'Admin permission is currently disabled.')+'</p>'+
      '<input type="number" min="1" step="1" max="'+esc(maximum)+'" '+
      'class="ag-search" placeholder="Coins to exchange" data-ag-salary-coins '+
      (eligible?'':'disabled')+' aria-label="Salary exchange coins">'+
      '<button type="button" class="ag-big-button" data-ag-exchange '+
      (eligible?'':'disabled')+'>'+image(icon('commission'))+
      'Exchange to Main Coin Wallet</button><p class="ag-muted" data-ag-notice></p></div>'+
      '<div class="ag-panel"><h3>Transfer Salary Directly to Coin Seller</h3>'+
      '<p class="ag-muted">Salary Wallet is debited; the selected Seller stock is credited. '+
      'Your Main Coin Wallet is not touched. This is separate from Salary Exchange.</p>'+
      '<p class="ag-muted">'+(salary.seller_transfer_enabled?
        'Super Admin has enabled Salary Seller Transfer.':
        'Salary Seller Transfer needs Super Admin permission.')+'</p>'+
      '<select class="ag-search" aria-label="Choose approved Coin Seller" data-ag-seller '+
        (transferEligible?'':'disabled')+'><option value="">Choose approved Coin Seller</option>'+
      sellers.map(s=>'<option value="'+esc(s.public_id)+'">'+esc(s.name)+' · ID '+
        esc(s.public_id)+'</option>').join('')+'</select>'+
      '<input class="ag-search" type="number" min="1" step="1" max="'+esc(maxTransfer)+'" '+
      'placeholder="Salary coins to send" data-ag-transfer-coins '+
        (transferEligible?'':'disabled')+' aria-label="Salary coins to transfer">'+
      '<button type="button" class="ag-big-button" data-ag-transfer '+
        (transferEligible?'':'disabled')+'>'+image(icon('commission'))+
      'Transfer Salary to Seller Wallet</button>'+ 
      '<p class="ag-muted">Seller receives stock coins. No Main Wallet coins are deducted.</p>'+ 
      '<div class="ag-panel"><h3>Salary Seller Transfer History</h3>'+
      (sellerHistory.map(t=>'<div class="ag-activity"><span class="ag-grow"><b>'+
        fmt(t.credited_coins)+' coins → '+esc(t.seller_name||'Coin Seller')+'</b><small>Seller ID '+
        esc(t.seller_public_id)+' · '+readableDate(t.created_at)+'</small></span>'+ 
        '<span class="ag-value">✓</span></div>').join('')||
        '<div class="ag-empty">No Seller Salary transfers yet.</div>')+'</div></div>'+ 
      '<div class="ag-panel"><h3>Salary Exchange Records</h3>'+
      (history.map(item=>'<div class="ag-activity"><span class="ag-grow"><b>'+
        fmt(item.credited_coins)+' coins</b><small>'+esc(item.settlement_mode)+' • '+
        readableDate(item.created_at)+'</small></span><span class="ag-value">✓</span></div>')
        .join('')||'<div class="ag-empty">No salary exchanges recorded.</div>')+'</div>','salary');
    panel.querySelector('[data-ag-transfer]').onclick=async()=>{
      const sellerId=panel.querySelector('[data-ag-seller]')?.value||'';
      const coins=Number(panel.querySelector('[data-ag-transfer-coins]')?.value);
      if(!/^[0-9]{8}$/.test(sellerId)||!Number.isSafeInteger(coins)||
        coins<1||coins>maxTransfer)
        return notice('Choose an approved Seller and enter available whole Salary coins.');
      const seller=sellers.find(s=>s.public_id===sellerId);
      if(!seller||!window.confirm('Transfer '+fmt(coins)+' coins from Salary Wallet to '+
        seller.name+' (Seller ID '+sellerId+')? Main Wallet coins will not be used.'))return;
      const button=panel.querySelector('[data-ag-transfer]');button.disabled=true;
      const fingerprint=sellerId+':'+coins;
      const requestId=pendingSalarySellerTransfer?.fingerprint===fingerprint?
        pendingSalarySellerTransfer.requestId:'salary-seller:'+crypto.randomUUID();
      pendingSalarySellerTransfer={fingerprint,requestId};
      try{
        await api('POST','/agency/salary/transfer',{
          seller_public_id:sellerId,coins,expected_version:salary.policy_version,request_id:requestId
        });
        pendingSalarySellerTransfer=null;
        await show('salary',undefined,undefined,false);
      }catch(error){
        button.disabled=false;
        notice('Salary Seller Transfer not confirmed. Check history before retrying: '+
          String(error?.message||error));
      }
    };
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
    if(type==='unassigned')return renderUnassigned();
    loading();const token=++generation;
    const timer=setTimeout(()=>{
      if(token===generation){generation++;fail(Error('Agency service did not respond in time.'));}
    },LOAD_LIMIT_MS);
    try{
      if(type==='salary')await renderSalary(token);
      else if(type==='directory')await renderDirectory(token);
      else if(type==='members')await renderMembers(token,id);
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
    finally{clearTimeout(timer);}
  }
  async function open(prefer){
    lastPreferredView=prefer||'overview';
    ensurePanel();panel.hidden=false;stack=[];lastView=null;loading();
    const token=++generation;
    try{
      me=await withDeadline(api('GET','/agency/me'));
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
