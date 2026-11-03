/* Sharika Royal Golden room — layout-only enhancement for the existing room.
   Keep the original DOM IDs so Cloudflare/D1, LiveKit and staging adapters
   continue to own seat state, messaging, gifts, mic state and permissions. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  if (!app || app.dataset.royalRoomMounted === 'true') return;
  app.dataset.royalRoomMounted = 'true';
  app.classList.add('sh-royal-room');

  const byId = id => document.getElementById(id);
  const sprite = name => {
    const element = document.createElement('span');
    element.className = 'sh-sprite sh-icon-' + name;
    element.setAttribute('aria-hidden', 'true');
    return element;
  };
  function refreshWallpaper() {
    const settings = window.S || {};
    // A room owner's custom background and HD remote theme take precedence.
    app.classList.toggle('sh-royal-wallpaper',
      !settings.bg && (settings.theme === 'mid' || settings.theme === 'gold'));
  }
  const oldApplyTheme = window.applyTheme;
  if (typeof oldApplyTheme === 'function') {
    window.applyTheme = function (...args) {
      const value = oldApplyTheme.apply(this, args);
      refreshWallpaper();
      return value;
    };
  }
  refreshWallpaper();

  // The owner's profile moves with their verified microphone seat. When it
  // is elsewhere, keep seat 0 as a crown-only throne, not a second identity.
  const originalRender = window.render;
  if (typeof originalRender === 'function') {
    window.render = function (...args) {
      const result = originalRender.apply(this, args);
      const throne = window.seats?.[0];
      if (throne?.owner_throne) {
        const host = byId('host')?.querySelector('.seat');
        const face = host?.querySelector('.face');
        const label = host?.querySelector('.nm');
        if (face) face.textContent = '👑';
        if (label) label.textContent = 'Owner throne';
        if (host && Number.isInteger(throne.owner_mic_seat_no))
          host.onclick = () => window.seatSheet?.(throne.owner_mic_seat_no);
      }
      return result;
    };
  }

  const top = app.querySelector('.top');
  const roomInfo = byId('roomBtn');
  const oldSettingsEmoji = roomInfo?.querySelector(':scope > span:last-child');
  if (oldSettingsEmoji) oldSettingsEmoji.remove();
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'sh-settings';
  settingsButton.setAttribute('aria-label', 'Room settings and themes');
  settingsButton.append(sprite('settings'));
  settingsButton.onclick = () => window.settings?.();
  top?.append(settingsButton);

  const stage = app.querySelector('.stage');
  const games = byId('bGame');
  if (stage && games) {
    games.className = 'sh-games';
    games.setAttribute('aria-label', 'Open games');
    games.replaceChildren(sprite('games'));
    const label = document.createElement('span');
    label.textContent = 'Games';
    games.append(label);
    stage.append(games);
  }

  // Move existing, wired controls. Do not clone buttons, as the staging
  // connection layer binds events by their original element IDs.
  const dock = app.querySelector('.dock');
  const input = dock?.querySelector('.inp');
  const row = dock?.querySelector('.irow');
  const inbox = byId('bMsg');
  const gifts = byId('bGift');
  const mic = byId('mic');
  const photo = byId('imgBtn');
  if (!dock || !input || !row || !inbox || !gifts || !mic) return;

  const composer = document.createElement('div');
  composer.className = 'sh-composer';
  composer.append(input);
  const text = byId('txt');
  if (text) text.setAttribute('placeholder', 'Message in room…');

  const toolRow = document.createElement('div');
  toolRow.className = 'sh-tools';
  function addTool(button, icon, label) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sh-tool';
    button.setAttribute('aria-label', label);
    button.replaceChildren(sprite(icon));
    const caption = document.createElement('span');
    caption.textContent = label;
    wrapper.append(button, caption);
    toolRow.append(wrapper);
    return button;
  }
  addTool(inbox, 'dm', 'DM');
  const box = addTool(document.createElement('button'), 'box', 'Lucky Box');
  box.type = 'button';
  box.id = 'sh-lucky-box';
  box.onclick = () => {
    if (window.__minor || window.__luckyOff) {
      window.toast?.('Lucky Box is unavailable for this account');
      return;
    }
    // Reuse the existing authenticated gift catalogue and Lucky tab.
    if (typeof window.giftSheet === 'function') {
      window.gtab = 2;
      window.giftSheet();
    } else gifts.click();
  };
  addTool(gifts, 'gift', 'Gift');
  gifts.addEventListener('click', () => { window.gtab = 0; }, { capture: true });

  const menuButton = addTool(document.createElement('button'), 'menu', 'Menu');
  menuButton.type = 'button';
  menuButton.id = 'sh-room-menu';
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-controls', 'sh-room-menu-panel');

  // The microphone stays a real, externally managed mic button.
  mic.classList.add('sh-mic-floating');
  mic.setAttribute('aria-label', 'Mute or unmute microphone');

  const menuPanel = document.createElement('section');
  menuPanel.className = 'sh-menu-panel';
  menuPanel.id = 'sh-room-menu-panel';
  menuPanel.setAttribute('aria-label', 'Room tools');
  const heading = document.createElement('h3');
  heading.textContent = 'Royal Room Tools';
  const menuGrid = document.createElement('div');
  menuGrid.className = 'sh-menu-grid';
  menuPanel.append(heading, menuGrid);
  function menuItem(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      closeMenu();
      handler();
    };
    menuGrid.append(button);
  }
  function closeMenu() {
    menuPanel.classList.remove('on');
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.onclick = () => {
    const opening = !menuPanel.classList.contains('on');
    menuPanel.classList.toggle('on', opening);
    menuButton.setAttribute('aria-expanded', String(opening));
  };
  document.addEventListener('pointerdown', event => {
    if (!menuPanel.contains(event.target) && !menuButton.contains(event.target))
      closeMenu();
  });

  // Local music is deliberately not presented as room-wide LiveKit audio.
  // Broadcasting device audio requires a separate approved media-publish path.
  let musicUrl = null;
  function musicSheet() {
    if (typeof window.open !== 'function') return;
    window.open('<h3>🎵 Music & Audio</h3>' +
      '<div class="lbl">Choose a song from your device</div>' +
      '<input id="sh-local-song" class="field" type="file" accept="audio/*">' +
      '<audio id="sh-local-player" controls style="width:100%;margin-top:12px"></audio>' +
      '<div class="lbl" style="line-height:1.5;margin-top:12px">Plays on this phone only. Sharing music with everyone requires the room audio broadcasting service.</div>');
    const picker = byId('sh-local-song');
    const player = byId('sh-local-player');
    if (!picker || !player) return;
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (!file || !file.type.startsWith('audio/')) {
        window.toast?.('Choose an audio file');
        return;
      }
      if (musicUrl) URL.revokeObjectURL(musicUrl);
      musicUrl = URL.createObjectURL(file);
      player.src = musicUrl;
      player.play().catch(() => {});
    };
  }
  menuItem('🎵 Music', musicSheet);
  menuItem('🔊 Audio', musicSheet);
  menuItem('✨ Effects', () => {
    window.toast?.('Voice effects need an enabled audio processing service');
  });
  menuItem('🎨 Theme', () => window.themeSheet?.());
  menuItem('🪑 Seats', () => window.seatSet?.());
  menuItem('⚙️ Settings', () => window.settings?.());
  menuItem('👑 Owner tools', () => byId('bOwn')?.click());
  menuItem('🖼️ Photo', () => photo?.click());

  // Photo remains reachable from the menu with its original permissions.
  if (photo) {
    photo.style.position = 'absolute';
    photo.style.left = '-10000px';
    photo.style.width = '1px';
    photo.style.height = '1px';
  }
  dock.replaceChildren(byId('tray'), composer, toolRow, mic, menuPanel);

  // The room's original renderer already uses one host and a four-column
  // grid for 9 seats. Preserve seat click handlers and server seat ownership.
  // CP/Friendship links are rendered only for verified D1 bond pairs.

  // Real-time top strip and server-backed room detail panels.
  // No mocked members, coin claims or duplicate wallet transfers.
  const premiumState={room:null,rewards:null,rewardsAt:0,rewardPromise:null};
  const fmtCoins=value=>{
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return '0';
    if(n>=1e9)return (n/1e9).toFixed(n%1e9<1e8?1:2).replace(/\.0+$/,'')+'B';
    if(n>=1e6)return (n/1e6).toFixed(n%1e6<1e5?1:2).replace(/\.0+$/,'')+'M';
    if(n>=1e3)return (n/1e3).toFixed(n%1e3<1e2?1:2).replace(/\.0+$/,'')+'K';
    return Math.floor(n).toLocaleString('en-US');
  };
  function vipAvatar(member,cls){
    const el=document.createElement('span');
    el.className='sh-vip-avatar'+(cls?' '+cls:'');
    if(member?.pic){
      const img=document.createElement('img');
      img.src=member.pic;img.alt='';img.loading='lazy';
      img.onerror=()=>{img.remove();el.textContent=(member.name||'?').trim().slice(0,1).toUpperCase();};
      el.appendChild(img);
    }else el.textContent=(member?.name||'?').trim().slice(0,1).toUpperCase();
    return el;
  }
  function canShow(){
    const v=premiumState.room;
    return !!(v&&document.getElementById('app')&&window.parent?.cur?.id===v.roomId);
  }
  async function rewardInfo(force){
    const v=premiumState.room;
    if(!v||!canShow())return null;
    if(!force&&premiumState.rewards&&Date.now()-premiumState.rewardsAt<60000)
      return premiumState.rewards;
    if(premiumState.rewardPromise)return premiumState.rewardPromise;
    const roomId=v.roomId;
    premiumState.rewardPromise=Promise.resolve().then(()=>v.loadRewards()).then(data=>{
      if(premiumState.room?.roomId!==roomId)return null;
      premiumState.rewards=data;premiumState.rewardsAt=Date.now();
      const count=document.getElementById('sh-room-value-total');
      if(count)count.textContent=fmtCoins(
        Number(data.regular_reward_hundredths||0)/
          Math.max(1,Number(data.regular_gift_percent||10)));
      return data;
    }).finally(()=>{premiumState.rewardPromise=null;});
    return premiumState.rewardPromise;
  }
  function showMembers(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    window.open('<div class="sh-premium-sheet">'+
      '<h3>👥 Online Users <span id="sh-online-total"></span></h3>'+
      '<div class="sh-member-list" id="sh-live-members"></div>'+
      '<p class="sh-footnote">Only members currently confirmed in this room are shown.</p></div>');
    const list=document.getElementById('sh-live-members');
    document.getElementById('sh-online-total').textContent=String(v.members.length);
    if(!v.members.length){
      list.textContent='No connected members right now.';return;
    }
    for(const member of v.members){
      const row=document.createElement('button');
      row.type='button';row.className='sh-member-row';
      row.appendChild(vipAvatar(member));
      const info=document.createElement('span');info.className='sh-member-info';
      const name=document.createElement('b');
      name.textContent=member.name||'Member';
      const sub=document.createElement('small');
      sub.textContent='ID: '+(member.displayId||'—')+
        (member.role==='owner'?' · 👑 Owner':member.role==='admin'?' · 🛡 Admin':'');
      info.append(name,sub);row.appendChild(info);
      row.onclick=()=>Promise.resolve(v.openProfile(member)).catch(error=>
        window.toast?.('Profile: '+String(error?.message||error)));
      list.appendChild(row);
    }
  }
  function showOverview(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    window.open('<div class="sh-premium-sheet">'+
      '<div class="sh-overview-hero"><span id="sh-overview-avatar"></span>'+
      '<div><h3 id="sh-overview-name"></h3><small id="sh-overview-id"></small></div></div>'+
      '<div class="sh-segments"><button class="on" id="sh-tab-profile">Profile</button>'+
      '<button id="sh-tab-members">Members</button></div>'+
      '<div class="sh-overview-cards"><div class="sh-overview-card"><small>Room Value</small>'+
      '<strong id="sh-overview-value">—</strong><span>Verified gift contribution</span></div>'+
      '<div class="sh-overview-card"><small>Online Members</small>'+
      '<strong id="sh-overview-members">0</strong><span>Currently in room</span></div></div>'+
      '<button class="sh-wide-action" id="sh-overview-rewards">💎 Room Rewards <span>›</span></button>'+
      '<button class="sh-wide-action alt" id="sh-overview-ranking">🏆 Room Ranking <span>›</span></button>'+
      '<button class="sh-wide-action alt" id="sh-overview-manage" hidden>🎨 Room Theme & Settings <span>›</span></button>'+
      '<p class="sh-footnote">Room statistics come from verified server data.</p></div>');
    document.getElementById('sh-overview-avatar').appendChild(vipAvatar(v.owner,'large'));
    document.getElementById('sh-overview-name').textContent=v.owner.name||'Room Owner';
    document.getElementById('sh-overview-id').textContent='ID: '+(v.owner.displayId||v.roomId);
    document.getElementById('sh-overview-members').textContent=String(v.members.length);
    const valueNode=document.getElementById('sh-overview-value');
    if(premiumState.rewards)
      valueNode.textContent=fmtCoins(Number(premiumState.rewards.regular_reward_hundredths||0)/
        Math.max(1,Number(premiumState.rewards.regular_gift_percent||10)));
    rewardInfo().then(data=>{
      if(data&&valueNode.isConnected)valueNode.textContent=fmtCoins(
        Number(data.regular_reward_hundredths||0)/
        Math.max(1,Number(data.regular_gift_percent||10)));
    }).catch(()=>{if(valueNode.isConnected)valueNode.textContent='Unavailable';});
    document.getElementById('sh-tab-members').onclick=showMembers;
    document.getElementById('sh-overview-rewards').onclick=showRewards;
    document.getElementById('sh-overview-ranking').onclick=()=>showRankings('daily');
    const manage=document.getElementById('sh-overview-manage');
    manage.hidden=!v.isOwner;
    manage.onclick=()=>window.settings?.();
  }
  async function showRewards(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    window.open('<div class="sh-premium-sheet">'+
      '<h3>💎 Room Reward Event</h3>'+
      '<div class="sh-reward-cards">'+
      '<div><small>Total earned</small><strong id="sh-reward-total">—</strong></div>'+
      '<div><small>Already credited to owner wallet</small><strong id="sh-reward-paid">—</strong></div></div>'+
      '<div class="sh-reward-week">🎁 Ordinary gifts: <b id="sh-reward-pct">10%</b>'+
      '<small>Lucky Gift share: <span id="sh-reward-lucky">1%</span></small></div>'+
      '<h3>Contribution → owner reward</h3>'+
      '<div id="sh-reward-tiers" class="sh-tier-list"></div>'+
      '<p class="sh-footnote">Illustrative amounts at the active ordinary-gift rate. The owner wallet is credited automatically; these are not additional claimable event prizes.</p></div>');
    const total=document.getElementById('sh-reward-total');
    const paid=document.getElementById('sh-reward-paid');
    try{
      const data=await rewardInfo(true);
      if(!data||!total.isConnected)return;
      const ordinaryPct=Number(data.regular_gift_percent||10);
      total.textContent=fmtCoins(Number(data.reward_hundredths||0)/100)+' 🪙';
      paid.textContent=fmtCoins(data.owner_wallet_credited_coins||0)+' 🪙';
      document.getElementById('sh-reward-pct').textContent=ordinaryPct+'%';
      document.getElementById('sh-reward-lucky').textContent=
        Number(data.lucky_gift_percent||1)+'%';
      const tiers=document.getElementById('sh-reward-tiers');
      [3000000,6000000,10000000,14000000,20000000,30000000,40000000,
        50000000,60000000,70000000,80000000].forEach((threshold,i)=>{
        const row=document.createElement('div');row.className='sh-tier';
        const left=document.createElement('span');
        left.textContent=String(i+1).padStart(2,'0')+'   '+fmtCoins(threshold);
        const right=document.createElement('strong');
        right.textContent=fmtCoins(threshold*ordinaryPct/100)+' 🪙';
        row.append(left,right);tiers.appendChild(row);
      });
    }catch(error){
      if(total.isConnected)total.textContent='Unavailable';
      if(paid.isConnected)paid.textContent=String(error?.message||error);
    }
  }
  async function showRankings(period){
    const v=premiumState.room;
    if(!v||!canShow())return;
    const periods=[['daily','Day'],['weekly','Week'],['monthly','Monthly']];
    window.open('<div class="sh-premium-sheet">'+
      '<h3>🏆 Room Ranking</h3><div class="sh-segments sh-rank-tabs" id="sh-ranking-tabs"></div>'+
      '<div id="sh-ranking-list" class="sh-rank-list">Loading verified results…</div>'+
      '<p class="sh-footnote">Based on verified room gift activity. Ranking is read-only; no separate reward is issued here.</p></div>');
    const tabs=document.getElementById('sh-ranking-tabs');
    for(const entry of periods){
      const b=document.createElement('button');
      b.textContent=entry[1];b.className=entry[0]===period?'on':'';
      b.onclick=()=>showRankings(entry[0]);
      tabs.appendChild(b);
    }
    const list=document.getElementById('sh-ranking-list');
    try{
      const result=await v.loadRankings(period);
      if(!list.isConnected||!canShow())return;
      list.replaceChildren();
      const leaders=Array.isArray(result.leaders)?result.leaders:[];
      if(!leaders.length){list.textContent='No verified room gifts recorded for this period.';return;}
      for(const room of leaders.slice(0,20)){
        const row=document.createElement('div');row.className='sh-rank-row';
        const rank=document.createElement('span');rank.className='sh-rank-medal';
        rank.textContent=Number(room.rank)<=3?['🥇','🥈','🥉'][Number(room.rank)-1]:
          '#'+String(room.rank||'—');
        const name=document.createElement('span');name.className='sh-rank-name';
        name.textContent=String(room.emoji||'🎙️')+' '+String(room.name||'Room');
        const sum=document.createElement('b');
        sum.textContent=fmtCoins(room.total)+' 🪙';
        row.append(rank,name,sum);list.appendChild(row);
      }
    }catch(error){
      if(list.isConnected)list.textContent='Ranking unavailable: '+String(error?.message||error);
    }
  }
  function renderPremiumHeader(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    const top=app.querySelector('.top');
    if(!top)return;
    let bar=document.getElementById('sh-room-masthead');
    if(!bar){
      bar=document.createElement('div');
      bar.id='sh-room-masthead';bar.className='sh-room-masthead';
      const score=document.createElement('button');
      score.id='sh-room-score';score.type='button';score.className='sh-room-score';
      score.innerHTML='<span>🏆</span><span class="sh-score-text"><small>Room Value</small>'+
        '<b id="sh-room-value-total">—</b></span><span>›</span>';
      const people=document.createElement('div');
      people.id='sh-room-faces';people.className='sh-room-faces';
      bar.append(score,people);
      top.after(bar);
      score.onclick=()=>showRankings('daily');
    }
    const faces=document.getElementById('sh-room-faces');
    faces.replaceChildren();
    for(const member of v.members.slice(0,4)){
      const button=document.createElement('button');
      button.type='button';button.className='sh-room-face-button';
      button.title=member.name||'Room member';button.appendChild(vipAvatar(member));
      button.onclick=()=>Promise.resolve(v.openProfile(member)).catch(error=>
        window.toast?.('Profile: '+String(error?.message||error)));
      faces.appendChild(button);
    }
    const count=document.createElement('button');
    count.className='sh-room-face-count';count.type='button';
    count.textContent=String(v.members.length);
    count.setAttribute('aria-label','Online users: '+v.members.length);
    count.onclick=showMembers;faces.appendChild(count);
    const old=document.getElementById('ustat');
    if(old){old.textContent='👥 '+v.members.length+' ›';old.onclick=showMembers;}
    const score=document.getElementById('sh-room-value-total');
    if(score&&premiumState.rewards)score.textContent=fmtCoins(
      Number(premiumState.rewards.regular_reward_hundredths||0)/
        Math.max(1,Number(premiumState.rewards.regular_gift_percent||10)));
    if(!premiumState.rewards)rewardInfo().catch(()=>{if(score?.isConnected)score.textContent='—';});
  }
  window.SharikaRoomPremium={
    sync(view){
      if(premiumState.room?.roomId!==view.roomId){
        premiumState.rewards=null;premiumState.rewardsAt=0;
      }
      premiumState.room=view;
      renderPremiumHeader();
    },
    showOverview,showMembers,showRewards,showRankings
  };
  if(roomInfo)roomInfo.onclick=showOverview;

})();
