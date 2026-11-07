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

  // Seat zero remains an internal owner identity for the legacy transport.
  // It must never render as a dedicated microphone/"owner throne" seat.
  // Every visible seat is a normal, numbered mic seat (1..seat_count).
  byId('host')?.setAttribute('aria-hidden', 'true');

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
  if (games) {
    games.className = 'sh-games';
    games.setAttribute('aria-label', 'Open games');
  }

  // Move existing, wired controls. Do not clone buttons, as the staging
  // connection layer binds events by their original element IDs.
  const dock = app.querySelector('.dock');
  const input = dock?.querySelector('.inp');
  const row = dock?.querySelector('.irow');
  const inbox = byId('bMsg');
  const gifts = byId('bGift');
  const mic = byId('mic');
  const emoji = byId('emo');
  const photo = byId('imgBtn');
  if (!dock || !input || !row || !inbox || !gifts || !mic || !emoji || !games) return;

  const composer = document.createElement('div');
  composer.className = 'sh-composer';
  composer.append(input);
  composer.hidden = true;
  const text = byId('txt');
  if (text) text.setAttribute('placeholder', 'Message in room…');
  // The original room still listens for visualViewport.resize and sets an
  // inline app height. CSS now overrides that legacy resize. Independently
  // keep the existing seat geometry and move ONLY the composer above Gboard.
  // Android WebViews differ in whether the parent iframe or its own visual
  // viewport shrinks, so listen to both and calculate the obscured bottom.
  if (text) {
    const seats = app.querySelector('.stage');
    // Freeze the actual pre-IME avatar geometry. Short Android WebViews can
    // cross a max-height breakpoint while Gboard opens, enlarging the owner
    // avatar and pushing the first seat downward.
    let pinnedAvatars = [];
    const releaseAvatarGeometry = () => {
      for (const pin of pinnedAvatars) {
        for (const prop of ['width', 'height']) {
          const previous = pin[prop];
          if (previous.value)
            pin.element.style.setProperty(prop, previous.value, previous.priority);
          else pin.element.style.removeProperty(prop);
        }
      }
      pinnedAvatars = [];
    };
    const pinAvatarGeometry = () => {
      releaseAvatarGeometry();
      for (const element of seats?.querySelectorAll('.av') || []) {
        const computed = window.getComputedStyle(element);
        const width = computed.width;
        const height = computed.height;
        if (!width || !height || width === 'auto' || height === 'auto') continue;
        const original = prop => ({ value:element.style.getPropertyValue(prop),
          priority:element.style.getPropertyPriority(prop) });
        pinnedAvatars.push({ element, width:original('width'), height:original('height') });
        element.style.setProperty('width',width,'important');
        element.style.setProperty('height',height,'important');
      }
    };
    let blurTask;
    let keyboardActive = false;
    let nativeImeOpen = false;
    let nativeImeInset = 0;
    let keepTopTask;
    let parentViewport;
    let parentWindow;
    try {
      parentWindow = window.parent !== window ? window.parent : null;
      parentViewport = parentWindow?.visualViewport;
    } catch (_) { /* Cross-origin preview: local viewport is sufficient. */ }

    const keyboardInset = () => {
      const view = window.visualViewport;
      const localBottom = view ? view.offsetTop + view.height : window.innerHeight;
      let inset = Math.max(0, window.innerHeight - localBottom);
      try {
        const frame = window.frameElement;
        if (frame && parentViewport) {
          const frameBottom = frame.getBoundingClientRect().bottom;
          const visibleBottom = parentViewport.offsetTop + parentViewport.height;
          inset = Math.max(inset, frameBottom - visibleBottom);
        }
      } catch (_) { /* The parent may be cross-origin outside Android. */ }
      // ADJUST_NOTHING does not shrink the WebView or visualViewport. Android
      // passes physical IME pixels; divide by the iframe's device pixel ratio
      // to get CSS pixels before positioning the fixed composer.
      return Math.max(nativeImeInset, 0, Math.round(inset));
    };

    const keepRoomAnchored = () => {
      if (!keyboardActive) return;
      // This restores legacy inline resizing without disturbing its handler
      // registration or the server-driven room state.
      app.style.removeProperty('height');
      app.style.setProperty('--sh-ime-inset', keyboardInset() + 'px');
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
      try {
        parentWindow?.scrollTo(0, 0);
      } catch (_) { /* Room preview inside a foreign parent. */ }
    };
    const onFocus = () => {
      clearTimeout(blurTask);
      if (!keyboardActive && seats) {
        // Capture once *before* IME resize; the seat grid must not reflow to
        // fit the keyboard or jump when its input becomes visible.
        pinAvatarGeometry();
        const measured = Math.ceil(seats.getBoundingClientRect().height);
        if (measured > 0) app.style.setProperty('--sh-seat-height', measured + 'px');
      }
      keyboardActive = true;
      app.classList.add('sh-keyboard-open');
      keepRoomAnchored();
      requestAnimationFrame(keepRoomAnchored);
      clearTimeout(keepTopTask);
      keepTopTask = setTimeout(keepRoomAnchored, 220);
    };
    const onBlur = (forceClose = false) => {
      clearTimeout(blurTask);
      blurTask = setTimeout(() => {
        if (forceClose || (!nativeImeOpen &&
            document.activeElement?.id !== 'txt' && keyboardInset() < 90)) {
          keyboardActive = false;
          app.classList.remove('sh-keyboard-open');
          releaseAvatarGeometry();
          app.style.removeProperty('--sh-seat-height');
          app.style.removeProperty('--sh-ime-inset');
          app.style.removeProperty('height');
        }
      }, 180);
    };
    // Never relocate the composer on pointerdown. Moving its hitbox before
    // Android dispatches focus cancels the tap, so Gboard never opens.
    // Focusin fires on the live input even if the connection layer rebinds it.
    document.addEventListener('focusin', event => {
      if (event.target?.id === 'txt') onFocus();
    }, true);
    document.addEventListener('focusout', event => {
      if (event.target?.id === 'txt') onBlur();
    }, true);
    const onViewportResize = () => {
      if (document.activeElement?.id === 'txt' && !keyboardActive) onFocus();
      if (keyboardActive) {
        keepRoomAnchored();
        requestAnimationFrame(keepRoomAnchored);
      }
    };
    window.visualViewport?.addEventListener('resize', onViewportResize);
    parentViewport?.addEventListener('resize', onViewportResize);
    window.addEventListener('resize', onViewportResize);
    // Native Android WindowInsets is an independent keyboard visibility
    // signal. It also fires when a WebView inside srcdoc misses focusin.
    window.SharikaRoyalKeyboard = Object.freeze({
      setNativeIme(visible, physicalInsetPx = 0) {
        nativeImeOpen = !!visible;
        // Some Android keyboards draw a suggestions/voice toolbar above the
        // area reported by Type.ime(). Leave clearance for that toolbar so
        // the entire composer remains touchable, not hidden under Gboard.
        nativeImeInset = nativeImeOpen ? Math.max(0, Math.round(
          Number(physicalInsetPx || 0) / (window.devicePixelRatio || 1))) + 56 : 0;
        if (nativeImeOpen) onFocus();
        else onBlur(true);
      }
    });
  }

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
  const chatToggle=document.createElement('button');
  chatToggle.type='button';chatToggle.id='sh-chat-toggle';
  chatToggle.setAttribute('aria-expanded','false');
  chatToggle.setAttribute('aria-controls','sh-room-composer');
  composer.id='sh-room-composer';
  chatToggle.onclick=()=>{
    const opening=composer.hidden;
    composer.hidden=!opening;
    chatToggle.setAttribute('aria-expanded',String(opening));
    if(opening)text?.focus();
  };
  addTool(chatToggle,'dm','Chat');
  mic.classList.remove('sh-mic-floating');
  addTool(mic,'mic','Mic');
  addTool(emoji,'emoji','Emoji');
  addTool(inbox,'dm','DM');

  const box=document.createElement('button');
  box.type = 'button';
  box.id = 'sh-lucky-box';
  box.className='sh-room-side-box';
  box.setAttribute('aria-label','Open Lucky Box');
  box.append(sprite('box'));
  box.onclick = () => {
    const api=window.parent?.SharikaLuckyBox;
    if(typeof api?.open==='function')api.open();
    else window.toast?.('Free Lucky Box needs the latest Sharika app');
  };
  gifts.classList.add('sh-room-side-gift');
  gifts.setAttribute('aria-label','Send gift');
  gifts.replaceChildren(sprite('gift'));
  gifts.addEventListener('click', () => { window.gtab = 0; }, { capture: true });

  const menuButton = addTool(document.createElement('button'), 'menu', 'Menu');
  menuButton.type = 'button';
  menuButton.id = 'sh-room-menu';
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-controls', 'sh-room-menu-panel');
  addTool(games,'games','Games');

  // The microphone stays the original, externally managed mic button.
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

  // The authenticated Android bridge owns shared playback and permissions.
  // Never claim a local-only <audio> element is audible to other members.
  function musicSheet() {
    const music=window.parent?.SharikaRoomMusic;
    if(music&&typeof music.open==='function')music.open();
    else window.toast?.('Update Sharika to use shared room music');
  }
  menuItem('🎵 Music', musicSheet);
  menuItem('🎮 Games', () => games?.click());
  menuItem('🔊 Audio', musicSheet);
  menuItem('✨ Effects', () => {
    window.toast?.('Voice effects need an enabled audio processing service');
  });
  menuItem('🎨 Theme', () => window.themeSheet?.());
  menuItem('🪑 Seats', () => window.seatSet?.());
  menuItem('🔒 Room Lock', () => window.roomLockSheet?.());
  menuItem('⚙️ Settings', () => window.settings?.());
  menuItem('👑 Owner tools', () => byId('bOwn')?.click());
  menuItem('🖼️ Photo', () => photo?.click());
  menuItem('📣 Announcement', () => editAnnouncement());

  // Photo remains reachable from the menu with its original permissions.
  if (photo) {
    photo.style.position = 'absolute';
    photo.style.left = '-10000px';
    photo.style.width = '1px';
    photo.style.height = '1px';
  }
  dock.replaceChildren(byId('tray'), composer, toolRow, gifts, box, menuPanel);

  // Keep the original seat IDs/click targets and verified state. The visual
  // grid now shows five seats per row without an owner-only slot.
  // CP/Friendship links are rendered only for verified D1 bond pairs.

  // Real-time top strip and server-backed room detail panels.
  // No mocked members, coin claims or duplicate wallet transfers.
  const premiumState={room:null,rewards:null,rewardsAt:0,rewardPromise:null,
    announcement:null,announcementAt:0,announcementPromise:null,
    rankAt:0,rankPromise:null};
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
    if(!v||!canShow()||!v.isOwner)return null;
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
    // Public gift contribution is distinct from the owner's private payout.
    v.loadRankings('weekly').then(data=>{
      if(data&&valueNode.isConnected)valueNode.textContent=fmtCoins(data.total_contribution_coins||0);
    }).catch(()=>{if(valueNode.isConnected)valueNode.textContent='Unavailable';});
    document.getElementById('sh-overview-rewards').hidden=!v.isOwner;
    document.getElementById('sh-tab-members').onclick=showMembers;
    document.getElementById('sh-overview-rewards').onclick=showRewards;
    document.getElementById('sh-overview-ranking').onclick=()=>showRankings('daily');
    const manage=document.getElementById('sh-overview-manage');
    manage.hidden=!v.isOwner;
    manage.onclick=()=>window.settings?.();
  }
  async function showRewards(){
    const v=premiumState.room;
    if(!v||!canShow()||!v.isOwner)return;
    window.open('<div class="sh-premium-sheet">'+
      '<h3>💎 Room Reward Event</h3>'+
      '<div class="sh-reward-cards">'+
      '<div><small>Total earned</small><strong id="sh-reward-total">—</strong></div>'+
      '<div><small>Already credited</small><strong id="sh-reward-paid">—</strong></div>'+
      '<div><small>Pending weekly payout</small><strong id="sh-reward-pending">—</strong></div></div>'+
      '<div class="sh-reward-week">🎁 Ordinary gifts: <b id="sh-reward-pct">10%</b>'+
      '<small>Lucky Gift share: <span id="sh-reward-lucky">1%</span></small>'+
      '<small>Weekly room contribution (UTC): <b id="sh-week-contribution">Loading…</b></small>'+
      '<small>Next automatic payout (UTC): <b id="sh-week-payout">Loading…</b></small></div>'+
      '<h3>Contribution → owner reward</h3>'+
      '<div id="sh-reward-tiers" class="sh-tier-list"></div>'+
      '<p class="sh-footnote">The existing 10% room share is credited to the owner as eligible gifts settle. This is not a second weekly payout. A separate weekly member reward still needs an approved payout rule.</p></div>');
    const total=document.getElementById('sh-reward-total');
    const paid=document.getElementById('sh-reward-paid');
    try{
      const data=await rewardInfo(true);
      if(!data||!total.isConnected)return;
      const ordinaryPct=Number(data.regular_gift_percent||10);
      total.textContent=fmtCoins(Number(data.reward_hundredths||0)/100)+' 🪙';
      paid.textContent=fmtCoins(data.owner_wallet_credited_coins||0)+' 🪙';
      const pending=document.getElementById('sh-reward-pending');
      if(pending)pending.textContent=fmtCoins(data.weekly_pending_coins||0)+' 🪙';
      const payout=document.getElementById('sh-week-payout');
      if(payout)payout.textContent=data.weekly_next_settlement_utc||'—';
      v.loadRankings('weekly').then(result=>{
        const week=document.getElementById('sh-week-contribution');
        if(week?.isConnected)
          week.textContent=fmtCoins(result.total_contribution_coins)+' 🪙';
      }).catch(()=>{
        const week=document.getElementById('sh-week-contribution');
        if(week?.isConnected)week.textContent='Unavailable';
      });
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
      '<p class="sh-footnote">Ranked by verified coins gifted in this room (UTC). Ranking does not issue an extra reward.</p></div>');
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
      for(const member of leaders.slice(0,20)){
        const row=document.createElement('button');
        row.type='button';row.className='sh-rank-row';
        const rank=document.createElement('span');rank.className='sh-rank-medal';
        rank.textContent=Number(member.rank)<=3?
          ['🥇','🥈','🥉'][Number(member.rank)-1]:'#'+String(member.rank||'—');
        const profile={
          publicId:String(member.public_id||''),
          name:String(member.name||'Member'),
          pic:member.pic||null,
          displayId:String(member.display_id||member.public_id||''),
          seatNo:null
        };
        const name=document.createElement('span');name.className='sh-rank-name';
        name.textContent=profile.name;
        const sum=document.createElement('b');
        sum.textContent=fmtCoins(member.total)+' 🪙';
        row.append(rank,vipAvatar(profile),name,sum);
        row.onclick=()=>Promise.resolve(v.openProfile(profile)).catch(error=>
          window.toast?.('Profile: '+String(error?.message||error)));
        list.appendChild(row);
      }
    }catch(error){
      if(list.isConnected)list.textContent='Ranking unavailable: '+String(error?.message||error);
    }
  }
  function displayAnnouncement(text){
    let strip=document.getElementById('sh-room-announcement');
    if(!strip){
      const stats=app.querySelector('.stats');
      if(!stats)return;
      strip=document.createElement('div');
      strip.id='sh-room-announcement';
      strip.className='sh-room-announcement';
      strip.setAttribute('role','note');
      stats.after(strip);
    }
    const value=String(text||'').trim().slice(0,280);
    strip.hidden=!value;
    strip.replaceChildren();
    if(value){
      const pin=document.createElement('span');
      pin.textContent='📣';
      const label=document.createElement('span');
      label.textContent='Announcement · '+value;
      strip.append(pin,label);
    }
  }
  async function loadAnnouncement(force=false){
    const v=premiumState.room;
    if(!v||!canShow())return;
    if(!force&&premiumState.announcement!==null&&
       Date.now()-premiumState.announcementAt<60000){
      displayAnnouncement(premiumState.announcement);return;
    }
    if(premiumState.announcementPromise)return premiumState.announcementPromise;
    const roomId=v.roomId;
    premiumState.announcementPromise=Promise.resolve(v.loadAnnouncement()).then(result=>{
      if(premiumState.room?.roomId!==roomId)return;
      premiumState.announcement=String(result?.text||'');
      premiumState.announcementAt=Date.now();
      displayAnnouncement(premiumState.announcement);
    }).finally(()=>{premiumState.announcementPromise=null;});
    return premiumState.announcementPromise;
  }
  async function editAnnouncement(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    if(!v.isOwner){window.toast?.('Only the room owner can edit announcements');return;}
    await loadAnnouncement().catch(()=>{});
    window.open('<div class="sh-premium-sheet"><h3>📣 Room Announcement</h3>'+
      '<p class="sh-footnote">Shown to every room member, including new arrivals.</p>'+
      '<textarea id="sh-room-notice-input" maxlength="280" rows="4" '+
      'placeholder="Write your room announcement…" '+
      'style="width:100%;padding:12px;border:1px solid #e9b965;'+
      'border-radius:14px;background:#1b0a32;color:#ffedc8"></textarea>'+
      '<button class="sh-wide-action" id="sh-room-notice-save">Save announcement</button>'+
      '<p id="sh-room-notice-status" class="sh-footnote"></p></div>');
    const input=document.getElementById('sh-room-notice-input');
    const save=document.getElementById('sh-room-notice-save');
    if(!input||!save)return;
    input.value=premiumState.announcement||'';
    save.onclick=async()=>{
      save.disabled=true;
      const status=document.getElementById('sh-room-notice-status');
      try{
        const result=await v.saveAnnouncement(input.value);
        if(premiumState.room?.roomId!==v.roomId)return;
        premiumState.announcement=String(result?.text||'');
        premiumState.announcementAt=Date.now();
        displayAnnouncement(premiumState.announcement);
        if(status?.isConnected)status.textContent='Saved for everyone in this room ✓';
      }catch(error){
        if(status?.isConnected)status.textContent='Save failed: '+String(error?.message||error);
      }finally{save.disabled=false;}
    };
  }
  async function refreshSmallRanking(force=false){
    const v=premiumState.room;
    const chip=document.getElementById('sh-room-rank-pill');
    if(!v||!chip||!canShow())return;
    if(!force&&Date.now()-premiumState.rankAt<60000)return;
    if(premiumState.rankPromise)return premiumState.rankPromise;
    const roomId=v.roomId;
    premiumState.rankPromise=Promise.resolve(v.loadRankings('daily')).then(result=>{
      if(premiumState.room?.roomId!==roomId||!chip.isConnected)return;
      chip.textContent='🏆 '+fmtCoins(result?.total_contribution_coins||0)+' ›';
      premiumState.rankAt=Date.now();
    }).catch(()=>{if(chip.isConnected)chip.textContent='🏆 Ranking ›';})
      .finally(()=>{premiumState.rankPromise=null;});
    return premiumState.rankPromise;
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
      const people=document.createElement('div');
      people.id='sh-room-faces';people.className='sh-room-faces';
      bar.append(people);
      top.after(bar);
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
    const stats=app.querySelector('.stats');
    const smallRank=stats?.querySelector('.pill:not([id])');
    if(smallRank){
      smallRank.id='sh-room-rank-pill';
      smallRank.style.cursor='pointer';
      smallRank.setAttribute('role','button');
      smallRank.tabIndex=0;
      smallRank.setAttribute('aria-label','Show verified room contribution ranking');
      smallRank.onclick=()=>showRankings('daily');
      smallRank.onkeydown=event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();showRankings('daily');}
      };
    }
    const rewardChip=byId('rrpill');
    if(rewardChip){
      rewardChip.style.setProperty('display','inline-flex','important');
      rewardChip.style.cursor='pointer';
      rewardChip.textContent='💰 Reward ›';
      rewardChip.onclick=showRewards;
    }
    refreshSmallRanking().catch(()=>{});
    loadAnnouncement().catch(()=>{});
  }
  window.SharikaRoomPremium={
    sync(view){
      if(premiumState.room?.roomId!==view.roomId){
        premiumState.rewards=null;premiumState.rewardsAt=0;
        premiumState.announcement=null;premiumState.announcementAt=0;
        premiumState.rankAt=0;
      }
      premiumState.room=view;
      renderPremiumHeader();
    },
    showOverview,showMembers,showRewards,showRankings,
    refreshAnnouncement:()=>renderAnnouncement(true)
  };
  if(roomInfo)roomInfo.onclick=showOverview;

})();
