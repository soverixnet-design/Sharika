/* Sharika production-connection bridge. Loaded AFTER the original HTML scripts.
 * No visual markup, CSS, or art is changed. Never place a service-role key here.
 * Only backend-confirmed balances, profiles, daily claims and room lists count.
 */
(function () {
  'use strict';

  const BASE = 'https://rfrmcmeyamndghtiheci.supabase.co';
  const PUBLISHABLE = 'sb_publishable_hMmbkkboIJhuhRCd6FORuQ_j8y8Kkrh';
  const SESSION_KEY = 'sharika_supabase_session_v1';
  const ACCOUNT_KEY = 'vr_accts_v1';
  const COLORS = ['#9b4dff,#4c1d95','#ff3dc8,#9d174d','#0ea5e9,#075985','#10b981,#065f46'];
  let session = null;
  let balance = { coins: 0, dia: 0, xp: 0 };
  let currentProfile = null;
  let selectedRecharge = 0;
  let selectedExchange = 0;
  let loadingRooms = false;
  let voiceRoom = null;
  let voiceRoomId = null;
  let framePoll = null;
  let giftCatalog = null;

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}

  async function jsonFetch(url, method, body, token) {
    const res = await fetch(url, {
      method,
      headers: {
        apikey: PUBLISHABLE,
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || data.error || ('HTTP ' + res.status));
    return data;
  }

  function setSession(value) {
    session = value ? {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
      user: value.user,
    } : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function accessToken() {
    if (!session || !session.access_token) throw new Error('Please log in first');
    if ((session.expires_at || 0) > Date.now() / 1000 + 60) return session.access_token;
    if (!session.refresh_token) throw new Error('Session expired. Please log in again');
    const refreshed = await jsonFetch(BASE + '/auth/v1/token?grant_type=refresh_token', 'POST', {
      refresh_token: session.refresh_token,
    });
    setSession(refreshed);
    return session.access_token;
  }

  async function api(method, path, body) {
    const token = await accessToken();
    return jsonFetch(BASE + '/functions/v1/sharika-api' + path, method, body, token);
  }

  function rememberProfile(user, profile) {
    currentProfile = profile;
    const key = (user.email || user.phone || user.id || '').toLowerCase();
    const local = {
      key,
      p: {
        id: profile.public_id,
        name: profile.name,
        pic: profile.pic || null,
        cover: profile.cover || null,
        bio: profile.bio || '',
        country: profile.country || '',
        dob: profile.birthdate || '',
        minor: !!profile.minor,
        myRoom: null,
        claim: { d: '', streak: 0 },
      },
      state: { coins: profile.coins || 0, dia: profile.diamonds || 0, xp: profile.xp || 0 },
    };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local]));
    return local;
  }

  async function ensureProfile(user, metadata) {
    try { return await api('GET', '/me'); }
    catch (err) {
      if (err.message !== 'profile_not_found') throw err;
      const data = metadata || user.user_metadata || {};
      if (!data.dob || !data.name) throw new Error('Profile setup needs your name and birth date. Contact support.');
      return api('POST', '/me', {
        name: data.name, birthdate: data.dob, country: data.country || '',
      });
    }
  }

  // Replace local-password hashing with Supabase Auth, preserving the same form.
  window.API.signup = async function (form) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.key)) {
      return { ok: false, msg: 'Phone signup needs SMS setup; please use an email address.' };
    }
    try {
      const result = await jsonFetch(BASE + '/auth/v1/signup', 'POST', {
        email: form.key, password: form.pw,
        data: { name: form.name, country: form.country, dob: form.dob },
      });
      if (!result.access_token) {
        return { ok: false, msg: 'Account created. Please verify your email, then log in.' };
      }
      setSession(result);
      const profile = await ensureProfile(result.user, form);
      balance = { coins: profile.coins, dia: profile.diamonds, xp: profile.xp };
      setTimeout(() => { reloadWallet().catch(() => {}); reloadRooms().catch(() => {}); }, 0);
      return { ok: true, acct: rememberProfile(result.user, profile) };
    } catch (error) { return { ok: false, msg: error.message }; }
  };

  window.API.login = async function (identity, password) {
    if (!identity.includes('@')) return { ok: false, msg: 'Please sign in using your email address.' };
    try {
      const result = await jsonFetch(BASE + '/auth/v1/token?grant_type=password', 'POST', {
        email: identity, password,
      });
      setSession(result);
      const profile = await ensureProfile(result.user);
      balance = { coins: profile.coins, dia: profile.diamonds, xp: profile.xp };
      setTimeout(() => { reloadWallet().catch(() => {}); reloadRooms().catch(() => {}); }, 0);
      return { ok: true, acct: rememberProfile(result.user, profile) };
    } catch (error) { return { ok: false, msg: error.message }; }
  };

  // The existing account page reads these functions. Server amounts take precedence.
  window.RS = function () { return { coins: balance.coins, dia: balance.dia, xp: balance.xp }; };
  window.addCoins = function () { window.toast('Coins are updated securely by the server'); };
  window.addDia = function () { window.toast('Diamonds are updated securely by the server'); };

  async function reloadWallet() {
    const wallet = await api('GET', '/wallet');
    balance = { coins: Number(wallet.coins) || 0, dia: Number(wallet.diamonds) || 0, xp: Number(wallet.xp) || 0 };
    localStorage.setItem('vr_state_v2', JSON.stringify(balance));
    window.refresh();
    return wallet;
  }

  async function reloadRooms() {
    if (loadingRooms) return;
    loadingRooms = true;
    try {
      const data = await api('GET', '/rooms');
      const own = (data.rooms || []).find(r => r.owner_id === session?.user?.id);
      window.CFG.rooms = (data.rooms || []).filter(r => r.owner_id !== session?.user?.id).map((room, i) => ({
        id: room.id, name: room.name, emoji: room.emoji || '🎙️',
        n: 0, host: 'Room owner', tag: 'Voice Room', mics: [],
        c: COLORS[i % COLORS.length], th: room.theme || 'mid',
        owner_id: room.owner_id, seat_count: room.seat_count,
      }));
      window.A.myRoom = own ? {
        name: own.name, emoji: own.emoji, th: own.theme,
        c: COLORS[0], owner_id: own.owner_id, seat_count: own.seat_count,
      } : null;
      window.renderRooms();
    } catch (err) { window.toast('Rooms could not sync: ' + err.message); }
    finally { loadingRooms = false; }
  }

  async function sdk() {
    if (window.LivekitClient) return window.LivekitClient;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Voice SDK could not load'));
      document.head.appendChild(script);
    });
    if (!window.LivekitClient) throw new Error('Voice SDK unavailable');
    return window.LivekitClient;
  }

  async function disconnectVoice() {
    if (voiceRoom) {
      const old = voiceRoom;
      voiceRoom = null; voiceRoomId = null;
      await old.disconnect();
    }
  }

  async function connectVoice(roomId) {
    const info = await api('POST', '/rooms/' + roomId + '/voice-token', {});
    const livekit = await sdk();
    await disconnectVoice();
    const room = new livekit.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true } });
    room.on(livekit.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === livekit.Track.Kind.Audio) {
        const audio = track.attach();
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
    });
    room.on(livekit.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach(element => element.remove());
    });
    room.on(livekit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const win = document.getElementById('rf')?.contentWindow;
      if (!win || !win.seats) return;
      const speaking = new Set(speakers.map(p => p.identity));
      win.seats.forEach(s => { s.talk = speaking.has('sharika:' + s.user_id); });
      win.render();
    });
    await room.connect(info.url, info.token);
    voiceRoom = room; voiceRoomId = roomId;
    if (info.publish) await room.localParticipant.setMicrophoneEnabled(true);
    return { connected: true, publishing: !!info.publish };
  }

  async function toggleMicrophone() {
    if (!voiceRoom || !voiceRoomId) throw new Error('Voice is not connected');
    const mic = voiceRoom.localParticipant.isMicrophoneEnabled;
    await voiceRoom.localParticipant.setMicrophoneEnabled(!mic);
    const win = document.getElementById('rf')?.contentWindow;
    if (win && win.$) {
      const button = win.$('mic');
      if (button) { button.textContent = mic ? '🔇' : '🎤'; button.classList.toggle('off', mic); }
    }
    return !mic;
  }

  async function syncFrame(room, win) {
    if (!win || !win.seats || !window.cur || window.cur.id !== room.id) return;
    const [data,owner] = await Promise.all([
      api('GET', '/rooms/' + room.id + '/members'),
      api('GET', '/users/' + room.id),
    ]);
    const members = data.members || [];
    const slots = Array.from({ length: Math.max(2,Number(room.seat_count || 12) + 1) }, (_, i) => ({ empty: 1, i }));
    const seatIds = {};
    slots[0] = { n: owner.name, e: '👑', i: 0, user_id: room.owner_id, muted: false, talk: false };
    seatIds[0] = room.id;
    const audience = [];
    for (const member of members) {
      const user = member.sharika_users;
      if (!user || member.user_id === room.owner_id) continue;
      if (Number.isInteger(member.seat_no) && member.seat_no > 0 && member.seat_no < slots.length) {
        slots[member.seat_no] = {
          n: user.name, e: '👤', i: member.seat_no, user_id: member.user_id,
          muted: !!member.muted, talk: false,
        };
        seatIds[member.seat_no] = user.public_id;
      } else {
        audience.push({ n: user.name, e: '👤', id: user.public_id, lv: user.wealth_level });
      }
    }
    win.seats = slots;
    win.U = audience;
    win.__sharikaSeatIds = seatIds;
    win.S.coins = balance.coins;
    win.S.xp = balance.xp;
    win.S.n = slots.length;
    win.render();
  }

  async function attachFrame(room) {
    const iframe = document.getElementById('rf');
    const win = iframe && iframe.contentWindow;
    if (!win || !win.seats || !window.cur || window.cur.id !== room.id) return;
    win.tick = function () {}; // No simulated microphone activity.
    win.U = []; // No invented audience accounts.
    win.$('chat')?.querySelectorAll('.msg').forEach(element => element.remove());
    const catalog = await api('GET','/config');
    giftCatalog = catalog.gifts || [];
    win.G = giftCatalog.map(g => [g.emoji || '🎁',Number(g.price_coins),g.name,Number(g.tab),g.image_url || '']);
    win.sendGift = async function () {
      const gift = win.G[win.gsel];
      const recipientIds = (win.rec || []).map(i => win.__sharikaSeatIds?.[i]).filter(Boolean);
      if (!gift || recipientIds.length !== (win.rec || []).length || !recipientIds.length) {
        win.toast('Choose real users in the room'); return;
      }
      try {
        if (!giftCatalog) giftCatalog = (await api('GET', '/config')).gifts || [];
        const matching = giftCatalog.find(g => g.name === gift[2] && Number(g.price_coins) === Number(gift[1]));
        if (!matching) throw new Error('Gift not available on the server');
        const result = await api('POST', '/rooms/' + room.id + '/gift', {
          gift_id: matching.id, qty: win.qty,
          recipient_ids: recipientIds, request_id: crypto.randomUUID(),
        });
        win.S.coins = Number(result.coins);
        win.S.xp = Number(result.xp);
        win.save(); win.close(); win.lockUI();
        win.msg('You', '😎', '→ ' + win.rec.map(i => win.seats[i]?.n).join(', ') +
          '  ' + gift[0] + ' ' + gift[2] + ' x' + win.qty, { me: 1, gf: 1, lv: win.level() });
        win.rec.forEach((seat, index) => {
          for (let i = 0; i < Math.min(win.qty, 20); i++) {
            win.fly(gift[0], seat, index * 180 + i * 140, gift[1]);
          }
        });
        if (gift[3] === 2) setTimeout(() => win.luckyFx(Number(result.lucky_win), Number(result.max_multiplier), gift), 1000);
        await reloadWallet();
      } catch (err) { win.toast(err.message || 'Gift could not be sent'); }
    };
    win.act = async function (action, seat) {
      if (action === 'take' && seat > 0) {
        try {
          await api('PUT', '/rooms/' + room.id + '/seat', { seat_no: seat });
          win.close(); await syncFrame(room,win);
          await connectVoice(room.id);
          win.toast('Microphone connected');
        } catch (error) { win.toast(error.message || 'Seat join failed'); }
        return;
      }
      if (action === 'down') {
        try {
          await api('PUT', '/rooms/' + room.id + '/seat', { seat_no: null });
          win.close(); await syncFrame(room,win);
          await connectVoice(room.id);
        } catch (error) { win.toast(error.message || 'Seat leave failed'); }
        return;
      }
      win.toast('This room action requires server moderation permission');
    };
    if (win.$('mic')) win.$('mic').onclick = async () => {
      try { await toggleMicrophone(); }
      catch (error) { win.toast(error.message); }
    };
    if (win.$('rrpill')) win.$('rrpill').onclick = async () => {
      if (room.owner_id !== session?.user?.id) { win.toast('Only the room owner can claim rewards'); return; }
      try {
        const reward = await api('GET', '/rooms/' + room.id + '/reward');
        win.S.rr = { vol: reward.volume, last: reward.last_claim_at ? Date.parse(reward.last_claim_at) : 0 };
        win.RR_PCT = reward.pct / 100;
        win.RR_DAY = reward.days * 86400000;
        win.rewardSheet();
        if (win.$('rwclaim')) win.$('rwclaim').onclick = async () => {
          try {
            await api('POST', '/rooms/' + room.id + '/reward/claim', { request_id: crypto.randomUUID() });
            win.close(); await reloadWallet(); await syncFrame(room,win);
            win.toast('Reward claimed successfully');
          } catch (error) { win.toast(error.message || 'Reward not ready'); }
        };
      } catch (error) { win.toast(error.message || 'Reward unavailable'); }
    };
    await syncFrame(room, win);
    try {
      const info = await connectVoice(room.id);
      win.toast(info.publishing ? 'Voice microphone connected' : 'Listening to the room');
    } catch (error) { win.toast('Voice pending: ' + error.message); }
    if (framePoll) clearInterval(framePoll);
    framePoll = setInterval(() => { if (window.cur?.id === room.id) syncFrame(room,win).catch(() => {}); }, 12000);
  }

  // Existing dialogs/buttons remain exactly the same; capture their confirmed actions.
  document.addEventListener('click', async function (event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (['wgs','ag'].includes(button.id)) {
      event.preventDefault(); event.stopImmediatePropagation();
      window.toast('Please sign up or log in to enter Sharika');
      return;
    }
    if (button.id === 'wg') {
      event.preventDefault(); event.stopImmediatePropagation();
      window.toast('Google sign-in needs provider configuration');
      return;
    }
    if (button.matches('[data-p]') && button.closest('#rcp')) {
      const match = button.textContent.replace(/,/g, '').match(/\d+/);
      selectedRecharge = match ? Number(match[0]) : 0;
    }
    if (button.matches('[data-e]') && button.closest('#rcp')) {
      const match = button.textContent.replace(/,/g, '').match(/\d+/);
      selectedExchange = match ? Number(match[0]) : 0;
    }
    const action = button.id;
    const isExchange = action === 'ec' && document.querySelector('#sh h3')?.textContent?.includes('Exchange');
    if (!['cl','pc','cm'].includes(action) && !isExchange) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!session) { window.showAuth('login'); return; }
    button.disabled = true;
    try {
      if (action === 'cl') {
        const claim = await api('POST', '/daily', { request_id: crypto.randomUUID() });
        if (!claim.already_claimed) window.toast('+' + claim.coins_awarded + ' coins received');
        else window.toast('Daily coins already claimed');
        const latest = await api('GET', '/daily');
        if (latest.last) window.A.claim = { d: latest.last.claim_day, streak: latest.last.streak };
        window.saveA(); window.closeSheet(); await reloadWallet();
      } else if (action === 'pc') {
        if (!selectedRecharge) throw new Error('Select a recharge package');
        await api('POST', '/recharge-requests', { coins: selectedRecharge, request_id: crypto.randomUUID() });
        window.closeSheet(); window.toast('Request pending admin approval');
      } else if (isExchange) {
        if (!selectedExchange) throw new Error('Select a diamond amount');
        const reply = await api('POST', '/exchange', { diamonds: selectedExchange, request_id: crypto.randomUUID() });
        window.closeSheet(); await reloadWallet(); window.toast('+' + reply.received + ' coins exchanged');
      } else if (action === 'cm') {
        const name = document.getElementById('cn')?.value?.trim() || 'My room';
        const selected = document.querySelector('#ce button.sel');
        const emoji = selected?.textContent?.trim() || '🎙️';
        const room = await api('POST', '/rooms', { name, emoji, theme: 'mid' });
        window.closeSheet(); await reloadRooms();
        const visual = window.myR();
        if (visual) window.openRoom(visual);
        window.toast('Room created ✓');
      }
    } catch (error) { window.toast(error.message || 'Connection error'); }
    finally { button.disabled = false; }
  }, true);

  // Display only actual rooms after authentication. No made-up room cards.
  window.CFG.rooms = [];
  window.CFG.people = [];
  window.CFG.wealth = [];
  window.CFG.chats = [];
  window.renderRooms();
  window.renderMsg = function () {
    document.getElementById('ml').innerHTML = '<div class="empty">No conversations yet.</div>';
  };
  window.renderRank = async function () {
    const board = document.getElementById('rb');
    board.innerHTML = '<div class="empty">Loading verified ranking…</div>';
    try {
      const category = window.rtab === 3 ? 'room' : window.rtab === 6 ? 'recharge' : null;
      if (!category) { board.innerHTML = '<div class="empty">This ranking has no verified results yet.</div>'; return; }
      const result = await api('GET', '/rank?category=' + category);
      const entries = result.rankings || [];
      board.innerHTML = entries.length ? entries.map(r =>
        '<div class="rr"><b class="n">#' + Number(r.rank) + '</b><span>' +
        String(r.room_id || r.user_id || 'User').replace(/[&<>"']/g, '') +
        '</span><b>🪙 ' + Number(r.value).toLocaleString('en-US') + '</b></div>'
      ).join('') : '<div class="empty">No ranking results yet.</div>';
    } catch (error) { board.innerHTML = '<div class="empty">Rankings unavailable.</div>'; }
  };
  window.box = function () {
    window.openSheet('<h3>🏆 Weekly rewards</h3><div class="empty">Rewards will be available after verified weekly rankings.</div>');
  };
  // Remove simulated gifts from the room document; keep all original styles.
  if (typeof window.ROOM_HTML === 'string') {
    window.ROOM_HTML = window.ROOM_HTML.replace('setInterval(botGift,28000);', '');
    // The template's 9-second fake chat timer impersonates users. Remove it.
    window.ROOM_HTML = window.ROOM_HTML.replace(
      /setInterval\(function\(\)\{var o=others\(\);[\s\S]*?\},9000\);/,
      ''
    );
  }
  const oldOpenRoom = window.openRoom;
  window.openRoom = async function (room) {
    if (!session) { window.showAuth('login'); return; }
    try {
      await api('POST', '/rooms/' + room.id + '/join', {});
      const iframe = document.getElementById('rf');
      iframe.onload = () => { attachFrame(room).catch(error => window.toast(error.message || 'Room sync failed')); };
      oldOpenRoom(room); // original 3D design is kept
    } catch (error) { window.toast(error.message || 'Room join failed'); }
  };

  const oldLeaveRoom = window.leaveRoom;
  window.leaveRoom = function () {
    if (framePoll) { clearInterval(framePoll); framePoll = null; }
    disconnectVoice().catch(() => {});
    const iframe = document.getElementById('rf');
    if (iframe) iframe.onload = null;
    oldLeaveRoom();
  };

  const oldLogout = window.logout;
  window.logout = function () {
    const token = session?.access_token;
    setSession(null);
    localStorage.removeItem(ACCOUNT_KEY);
    if (token) jsonFetch(BASE + '/auth/v1/logout', 'POST', {}, token).catch(() => {});
    oldLogout();
  };

  async function restore() {
    if (!session) {
      localStorage.removeItem('vr_sess');
      localStorage.removeItem('vr_guest');
      window.showAuth('welcome');
      return;
    }
    try {
      const user = await jsonFetch(BASE + '/auth/v1/user', 'GET', undefined, await accessToken());
      const profile = await ensureProfile(user);
      const acct = rememberProfile(user, profile);
      window.A = Object.assign(window.A, acct.p);
      localStorage.setItem('vr_sess', acct.key);
      window.saveA();
      await Promise.all([reloadWallet(), reloadRooms()]);
      const day = await api('GET', '/daily');
      if (day.last) {
        window.A.claim = { d: day.last.claim_day, streak: day.last.streak };
        window.saveA();
      }
      window.hideAuth();
    } catch (error) {
      setSession(null);
      localStorage.removeItem('vr_sess');
      window.showAuth('welcome');
      window.toast('Please log in: ' + error.message);
    }
  }

  window.SharikaServer = { api, reloadWallet, reloadRooms, connected: () => !!session };
  restore();
})();
