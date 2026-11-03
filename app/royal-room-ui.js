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
  settingsButton.onclick = () => roomInfo?.click();
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
  menuItem('⚙️ Settings', () => roomInfo?.click());
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
})();
