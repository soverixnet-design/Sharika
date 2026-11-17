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
  // The room profile follows Exit, before the collapse control, giving its
  // verified cover/name a wide left-aligned touch target even on small phones.
  if (top && roomInfo && roomInfo.parentElement === top && top.children.length > 1)
    top.insertBefore(roomInfo, top.children[1]);
  const roomControls=document.createElement('div');
  roomControls.className='sh-room-live-controls';
  roomControls.hidden=true;
  const masthead=document.createElement('div');
  masthead.className='sh-room-masthead';
  const faces=document.createElement('div');
  faces.className='sh-room-faces';
  faces.setAttribute('aria-label','Members in this room');
  const count=document.createElement('button');
  count.className='sh-room-face-count';
  count.type='button';
  count.onclick=showMembers;
  masthead.append(faces,count);
  const rankRow=document.createElement('div');
  rankRow.className='sh-room-rank-row';
  const ranking=document.createElement('button');
  ranking.id='sh-room-rank-pill';
  ranking.className='sh-room-rank-button';
  ranking.type='button';
  ranking.textContent='🏆 Ranking ›';
  ranking.setAttribute('aria-label','Monthly room gift ranking');
  ranking.onclick=showRankings;
  rankRow.append(ranking);
  roomControls.append(masthead,rankRow);
  top?.after(roomControls);
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
  // The original .inp has just been moved into the detached composer.
  // document.getElementById cannot find descendants until it is reattached;
  // keeping the input reference here is required for Room Chat focus and IME.
  const text = input.querySelector('#txt');
  if (text) text.setAttribute('placeholder', 'Message in room…');
  const send = input.querySelector('#sendTxt');
  if (send) send.textContent = 'Send';
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
    else text?.blur();
  };
  addTool(chatToggle,'chat','Room Chat');
  mic.classList.remove('sh-mic-floating');
  addTool(mic,'mic','Mic');
  addTool(emoji,'emoji','Emoji');
  addTool(inbox,'dm','Private DM');

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
  games.title='Games';

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

  // Reference-room tools: preserve original wired handlers; do not simulate
  // unimplemented money/PK/game transactions on the client.
  (function installReferenceRoomTools() {
    menuPanel.classList.add('sh-reference-room-tools');
    heading.textContent = 'Room Tools';
    const original = Array.from(menuGrid.querySelectorAll('button'));
    const originalAction = label => {
      const control = original.find(button => button.textContent.includes(label));
      if (control) control.click();
      else window.toast?.(label + ' is not available in this build');
    };
    menuGrid.replaceChildren();
    function section(name) {
      const node = document.createElement('section');
      node.className = 'sh-reference-tool-section';
      const heading = document.createElement('h4');
      heading.textContent = name;
      const grid = document.createElement('div');
      grid.className = 'sh-reference-tool-grid';
      node.append(heading, grid);
      menuGrid.append(node);
      return grid;
    }
    function item(grid, label, icon, handler, detail) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sh-reference-tool';
      button.setAttribute('aria-label', label + (handler ? '' : ' — not available'));
      const picture = document.createElement('span');
      picture.className = 'sh-reference-tool-icon';
      picture.setAttribute('aria-hidden', 'true');
      picture.textContent = icon;
      const title = document.createElement('span');
      title.className = 'sh-reference-tool-title';
      title.textContent = label;
      button.append(picture, title);
      if (detail) {
        const hint = document.createElement('small');
        hint.textContent = detail;
        button.append(hint);
      }
      if (!handler) {
        button.disabled = true;
        button.classList.add('sh-reference-unavailable');
        button.title = label + ' needs a verified server-backed feature';
      } else {
        button.onclick = () => {
          closeMenu();
          handler();
        };
      }
      grid.append(button);
    }
    const interactions = section('Interactive features');
    item(interactions, 'Counter', '🧧', null, 'Not enabled');
    item(interactions, 'PK', '⚔️', null, 'Not enabled');
    item(interactions, 'Wheel', '🎡', null, 'Not enabled');
    item(interactions, 'Smash Eggs', '🥚', null, 'Not enabled');

    const management = section('Management tool');
    item(management, 'Clean text', '🧹', null);
    item(management, 'Music', '♫', () => originalAction('Music'));
    item(management, 'Mount effect', '✨', null);
    item(management, 'Gift effect', '🎁', null);
    item(management, 'Sound', '🔊', () => originalAction('Audio'));
    item(management, 'Mic PK', '🎙️', null);
    item(management, 'Gift count', '🎨', null);
    item(management, 'Mic mode', '🪑', () => {
      if (premiumState.room && !premiumState.room.isOwner) {
        window.toast?.('Only the room owner can change mic mode');
        return;
      }
      originalAction('Seats');
    });

    const others = section('Others');
    item(others, 'Dice', '🎲', null);
    item(others, 'RPS', '✌️', null);
    item(others, 'Number', '7️⃣', null);

    const quick = section('Room management');
    item(quick, 'Games', '🎮', () => originalAction('Games'));
    item(quick, 'Theme', '🖼️', () => originalAction('Theme'));
    item(quick, 'Settings', '⚙️', () => originalAction('Settings'));
    item(quick, 'Lock', '🔒', () => originalAction('Room Lock'));
    item(quick, 'Notice', '📣', () => originalAction('Announcement'));
    item(quick, 'Owner', '👑', () => originalAction('Owner tools'));
    item(quick, 'Room photo', '📷', () => originalAction('Photo'));
    item(quick, 'Lucky Box', '🎁', () => box.click());

    const sideGame = document.createElement('button');
    sideGame.id = 'sh-reference-game-banner';
    sideGame.className = 'sh-reference-game-banner';
    sideGame.type = 'button';
    sideGame.setAttribute('aria-label', 'Open room games');
    sideGame.append(sprite('games'), document.createTextNode('Games'));
    sideGame.onclick = () => games.click();
    app.append(sideGame);

    menuButton.setAttribute('aria-label', 'Open interactive and management tools');
  })();


  // Photo remains reachable from the menu with its original permissions.
  if (photo) {
    photo.style.position = 'absolute';
    photo.style.left = '-10000px';
    photo.style.width = '1px';
    photo.style.height = '1px';
  }
  dock.replaceChildren(byId('tray'), toolRow, menuPanel);
  // These overlays are anchored to the room. IME insets affect only the
  // composer, so neither gift control moves with the keyboard.
  app.append(composer, gifts, box);

  // Keep the original seat IDs/click targets and verified state. The visual
  // grid now shows five seats per row without an owner-only slot.
  // CP/Friendship links are rendered only for verified D1 bond pairs.

  const premiumState={room:null,announcement:null,announcementAt:0,announcementPromise:null};
  const promoState={roomId:null,lastRefresh:0,promise:null};
  const promoImagePattern=/^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/room-banners\/([1-9][0-9]{0,8})\/image\?v=[1-9][0-9]*$/;
  const eventStrip=document.createElement('div');
  eventStrip.id='sh-reference-event-banner';
  eventStrip.className='sh-reference-event-banner';
  eventStrip.hidden=true;
  app.querySelector('.chatw')?.before(eventStrip);
  function bannerImage(row) {
    const match=typeof row?.image_url==='string'&&promoImagePattern.exec(row.image_url);
    return match&&Number(match[1])===Number(row.id)&&row.active
      ?row.image_url:null;
  }
  function renderRoomBanners(entries){
    const sideGame=byId('sh-reference-game-banner');
    if(!sideGame)return;
    const rows=Array.isArray(entries)?entries:[];
    const game=rows.find(item=>item.placement==='game'&&bannerImage(item));
    const event=rows.find(item=>item.placement==='event'&&bannerImage(item));
    const gameLabel=document.createElement('span');gameLabel.textContent='Games';
    if(game){
      const picture=document.createElement('img');
      picture.alt='';picture.loading='lazy';
      picture.src=bannerImage(game);
      picture.onerror=()=>sideGame.replaceChildren(sprite('games'),gameLabel);
      sideGame.replaceChildren(picture,gameLabel);
      sideGame.setAttribute('aria-label','Games · '+game.title);
    }else{
      sideGame.replaceChildren(sprite('games'),gameLabel);
      sideGame.setAttribute('aria-label','Open room games');
    }
    eventStrip.replaceChildren();
    eventStrip.hidden=!event;
    if(event){
      const img=document.createElement('img');img.alt='';img.loading='lazy';img.src=bannerImage(event);
      const caption=document.createElement('strong');caption.textContent=String(event.title||'Room event').slice(0,70);
      img.onerror=()=>{eventStrip.hidden=true;};
      eventStrip.append(img,caption);
      eventStrip.setAttribute('aria-label','Room event: '+caption.textContent);
    }
  }
  async function refreshRoomBanners() {
    const view=premiumState.room;
    if(!view||!canShow()||typeof view.loadBanners!=='function')return;
    if(promoState.promise)return promoState.promise;
    if(Date.now()-promoState.lastRefresh<60000)return;
    const roomId=view.roomId;
    // The API returns only actively published artwork and never a payment action.
    promoState.promise=Promise.resolve().then(()=>view.loadBanners()).then(data=>{
      if(premiumState.room?.roomId!==roomId||!canShow())return;
      renderRoomBanners(data?.banners);
      promoState.lastRefresh=Date.now();
    }).catch(()=>{
      // Do not display stale artwork from a different room or fabricate promos.
      if(premiumState.room?.roomId===roomId){
        renderRoomBanners([]);
        promoState.lastRefresh=Date.now();
      }
    }).finally(()=>{promoState.promise=null;});
    return promoState.promise;
  }
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
  let rosterSignature=null;
  function renderLiveMembers(view){
    const signature=JSON.stringify([view.roomId,view.members]);
    if(signature===rosterSignature)return;
    rosterSignature=signature;
    const items=view.members.map(member=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='sh-room-member-chip';
      button.setAttribute('aria-label',member.name+' · ID '+member.displayId);
      const id=document.createElement('small');
      id.textContent=member.displayId;
      button.append(vipAvatar(member),id);
      button.onclick=()=>{
        const current=premiumState.room;
        if(!canShow())return;
        const person=current.members.find(item=>item.publicId===member.publicId);
        if(person)Promise.resolve(current.openProfile(person)).catch(error=>
          window.toast?.('Profile: '+String(error?.message||error)));
      };
      return button;
    });
    faces.replaceChildren(...items);
    count.textContent=String(view.members.length);
    count.setAttribute('aria-label','Online users: '+view.members.length);
  }
  async function showRankings(){
    const v=premiumState.room;
    if(!v||!canShow())return;
    window.open('<div class="sh-premium-sheet sh-reference-rankings">'+
      '<div class="sh-ranking-heading">'+
      '<button type="button" id="sh-ranking-back" aria-label="Back to room">‹</button>'+
      '<h3>Room Ranking</h3></div>'+
      '<div class="sh-ranking-kinds" id="sh-ranking-kinds"></div>'+
      '<div class="sh-ranking-periods" id="sh-ranking-periods"></div>'+
      '<p class="sh-ranking-explanation" id="sh-ranking-explanation"></p>'+
      '<div class="sh-ranking-podium" id="sh-ranking-podium"></div>'+
      '<div id="sh-ranking-list" class="sh-rank-list"></div>'+
      '<button type="button" id="sh-ranking-more" class="sh-wide-action" hidden>Show more</button>'+
      '<p id="sh-ranking-status" role="status"></p></div>');
    // The reference ranking is a real full-height page rather than another
    // cramped mic/dock sheet. Restore the shared sheet for all other controls.
    const rankingBackdrop=byId('bg'),rankingSheet=byId('sheet');
    if(rankingBackdrop&&rankingSheet){
      rankingBackdrop.classList.add('sh-rank-page-active');
      const cleanup=()=>{
        if(!rankingBackdrop.classList.contains('on')||
           !rankingSheet.querySelector('.sh-reference-rankings')){
          rankingBackdrop.classList.remove('sh-rank-page-active');
          observer.disconnect();
        }
      };
      const observer=new MutationObserver(cleanup);
      observer.observe(rankingBackdrop,{attributes:true,attributeFilter:['class']});
      observer.observe(rankingSheet,{childList:true});
      const back=document.getElementById('sh-ranking-back');
      if(back)back.onclick=()=>{
        rankingBackdrop.classList.remove('sh-rank-page-active');
        observer.disconnect();
        window.close();
      };
    }
    const list=document.getElementById('sh-ranking-list');
    const more=document.getElementById('sh-ranking-more');
    const status=document.getElementById('sh-ranking-status');
    const podium=document.getElementById('sh-ranking-podium');
    const periodButtons=document.getElementById('sh-ranking-periods');
    const kindButtons=document.getElementById('sh-ranking-kinds');
    const explanation=document.getElementById('sh-ranking-explanation');
    if(!list||!more||!status||!podium||!periodButtons||!kindButtons)return;
    const selected={kind:'riches',period:'weekly',offset:0,since:null,revision:0};
    function memberProfile(member){
      return {publicId:String(member.public_id||''),
        name:String(member.name||'Member'),pic:member.pic||null,
        displayId:String(member.display_id||member.public_id||''),seatNo:null};
    }
    function memberButton(member,card=false){
      const profile=memberProfile(member);
      const row=document.createElement('button');
      row.type='button';row.className=card?'sh-rank-podium-card':'sh-rank-row';
      const rank=document.createElement('span');
      rank.className=card?'sh-rank-podium-rank':'sh-rank-medal';
      rank.textContent=Number(member.rank)<=3?
        ['🥇','🥈','🥉'][Number(member.rank)-1]:'#'+String(member.rank||'—');
      const label=document.createElement('span');label.className='sh-rank-name';
      const title=document.createElement('strong');title.textContent=profile.name;
      const id=document.createElement('small');id.textContent='ID '+profile.displayId;
      label.append(title,id);
      const amount=document.createElement('b');
      amount.className='sh-rank-amount';
      amount.textContent=Number(member.total||0).toLocaleString('en-US')+' 🪙';
      row.append(rank,vipAvatar(profile),label,amount);
      if(card)row.dataset.place=String(member.rank);
      row.onclick=()=>Promise.resolve(v.openProfile(profile)).catch(error=>
        window.toast?.('Profile: '+String(error?.message||error)));
      return row;
    }
    function drawTabs(container,values,field){
      container.replaceChildren();
      for(const [value,label] of values){
        const button=document.createElement('button');
        button.type='button';button.textContent=label;
        button.setAttribute('aria-pressed',String(selected[field]===value));
        button.onclick=()=>{
          if(selected[field]===value)return;
          selected[field]=value;
          selected.offset=0;selected.since=null;
          renderTabs();load(false).catch(()=>{});
        };
        container.append(button);
      }
    }
    function renderTabs(){
      drawTabs(kindButtons,[['riches','Riches'],['lucky','Lucky']], 'kind');
      drawTabs(periodButtons,[['weekly','Weekly'],['monthly','Monthly']], 'period');
      explanation.textContent=selected.kind==='riches'
        ?'Verified coins spent on gifts in this room. Periods reset in UTC.'
        :'Verified gift coins received by members in this room. This is not a random cash payout.';
    }
    async function load(morePage=false){
      const revision=++selected.revision;
      const period=selected.period,kind=selected.kind;
      const offset=morePage?selected.offset:0;
      if(!morePage){
        selected.offset=0;selected.since=null;
        list.replaceChildren();podium.replaceChildren();
      }
      more.disabled=true;more.hidden=true;
      status.textContent='Loading verified ranking…';
      try{
        const result=await v.loadRankings(period,offset,kind);
        if(!status.isConnected||!canShow()||revision!==selected.revision||
           premiumState.room?.roomId!==v.roomId)return;
        if(result.period!==period||result.kind!==kind)
          throw Error('Ranking response does not match selected filter');
        if(morePage&&selected.since!==result.since_utc)
          return await load(false);
        selected.since=result.since_utc;
        const leaders=Array.isArray(result.leaders)?result.leaders:[];
        if(!offset){
          podium.replaceChildren();
          const firstThree=leaders.filter(item=>Number(item.rank)<=3);
          for(const position of [2,1,3]){
            const member=firstThree.find(item=>Number(item.rank)===position);
            if(member)podium.append(memberButton(member,true));
          }
          podium.hidden=firstThree.length===0;
          if(!leaders.length)list.textContent='No verified gifts for this period.';
        }
        for(const member of leaders)
          list.append(memberButton(member,false));
        selected.offset=result.next_offset;
        more.hidden=result.next_offset==null;
        more.textContent='Show more';
        status.textContent='';
      }catch(error){
        if(!status.isConnected||revision!==selected.revision)return;
        status.textContent='Ranking unavailable: '+String(error?.message||error);
        more.hidden=false;more.textContent='Retry';
      }finally{more.disabled=false;}
    }
    more.onclick=()=>load(selected.offset!=null).catch(()=>{});
    renderTabs();
    await load(false);
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
  window.SharikaRoomPremium={
    sync(view){
      if(premiumState.room?.roomId!==view.roomId){
        premiumState.announcement=null;premiumState.announcementAt=0;
      }
      if(promoState.roomId!==view.roomId){
        promoState.roomId=view.roomId;
        promoState.lastRefresh=0;
        renderRoomBanners([]);
      }
      premiumState.room=view;
      refreshRoomBanners().catch(()=>{});
      renderLiveMembers(view);
      roomControls.hidden=false;
      loadAnnouncement().catch(()=>{});
    },
    showMembers,showRankings,
    refreshAnnouncement:()=>loadAnnouncement(true)
  };

})();
