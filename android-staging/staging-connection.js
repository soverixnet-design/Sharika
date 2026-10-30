/* Sharika Android-only staging adapter.
 * Preserves the original supplied HTML/CSS/room art. No Supabase endpoint,
 * service-role key, demo identity, fake payouts, or plaintext token in JS.
 * Requires native SharikaActivity, which verifies Firebase authentication
 * and sends allowlisted requests exclusively to the new Cloudflare Worker.
 */
(function () {
  'use strict';
  // This override is loaded only by the Android staging shell. Keep the
  // original HTML design unchanged while allowing it to fill phone screens.
  function fitAndroidViewport(doc, roomFrame) {
    if (!doc || !doc.head || doc.getElementById('sharika-android-viewport')) return;
    const style = doc.createElement('style');
    style.id = 'sharika-android-viewport';
    style.textContent = [
      'html,body{width:100%!important;max-width:none!important;margin:0!important}',
      '.app{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}',
      roomFrame ? '' : [
        'html{padding-top:0!important;padding-bottom:0!important}',
        '#v-home,#v-rank,#v-msg{padding-top:calc(10px + env(safe-area-inset-top,0px))!important}',
        '.auth .aw{padding-top:calc(28px + env(safe-area-inset-top,0px))!important}'
      ].join('')
    ].join('');
    doc.head.appendChild(style);
  }
  fitAndroidViewport(document, false);
  const ACCOUNT_KEY = 'vr_accts_v1';
  const META_KEY = 'sharika_staging_registration_v1';
  const COLORS = ['#9b4dff,#4c1d95','#ff3dc8,#9d174d','#0ea5e9,#075985','#10b981,#065f46'];
  const calls = new Map();
  let seq = 0, session = null, profile = null;
  let balance = { coins: 0, dia: 0, xp: 0 };
  let busyRooms = false, framePoll = null, giftPoll = null, chatPoll = null;
  let voiceRoom = null, voiceRoomId = null, voiceSdkPromise = null;
  let voiceBackend = null;

  function errText(error) { return String(error && error.message || error || 'Connection unavailable'); }
  function toast(message) { if (window.toast) window.toast(message); }
  function native(action, payload) {
    if (!window.SharikaNative || typeof window.SharikaNative.call !== 'function')
      return Promise.reject(new Error('Android native bridge unavailable'));
    return new Promise((resolve, reject) => {
      const id = String(++seq);
      const timer = setTimeout(() => { calls.delete(id); reject(new Error('Request timed out')); }, 25000);
      calls.set(id, { resolve, reject, timer });
      try { window.SharikaNative.call(id, action, JSON.stringify(payload || {})); }
      catch (error) { clearTimeout(timer); calls.delete(id); reject(error); }
    });
  }
  window.SharikaNativeReply = function (id, response) {
    const pending = calls.get(id);
    if (!pending) return;
    calls.delete(id);
    clearTimeout(pending.timer);
    try {
      const message = JSON.parse(response);
      if (message.ok) pending.resolve(message.data || {});
      else pending.reject(new Error(message.error || 'unknown_error'));
    } catch (error) { pending.reject(error); }
  };
  async function api(method, path, body) {
    return native('api', { method, path: '/api/v1' + path, body });
  }

  // Cloudflare Realtime SFU voice transport; room art and seat UI stay as-is.
  let sfuState = null;
  async function waitIce(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Voice network timeout'));},12000);
      function changed(){ if(peer.iceGatheringState==='complete'){cleanup();resolve();} }
      function cleanup(){clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',changed);}
      peer.addEventListener('icegatheringstatechange',changed);
      changed();
    });
  }
  async function disconnectSfu() {
    const state=sfuState;
    if(!state)return;
    sfuState=null;
    state.closed=true;
    if(state.timer)clearInterval(state.timer);
    for(const element of state.audioElements){element.pause();element.srcObject=null;element.remove();}
    if(state.media)for(const track of state.media.getTracks())track.stop();
    for(const pc of [state.publishPC,state.receivePC])if(pc)pc.close();
    if(state.sessionIds.length) {
      try {await api('POST','/rooms/'+state.roomId+'/voice/leave',{sessionIds:state.sessionIds});}
      catch (_) { /* stale sessions expire in the coordinator */ }
    }
  }
  function addAudioTrack(state,event) {
    if(state.closed)return;
    const audio=document.createElement('audio');
    audio.autoplay=true;
    audio.playsInline=true;
    audio.dataset.sharikaVoice='true';
    audio.srcObject=new MediaStream([event.track]);
    document.body.appendChild(audio);
    state.audioElements.add(audio);
    audio.play().catch(()=>{ /* Android may require a user tap for playback */ });
    event.track.addEventListener('ended',()=>{
      state.audioElements.delete(audio);audio.pause();audio.remove();
    },{once:true});
  }
  async function subscribeSfu(state) {
    if(state.closed || state.syncing)return;
    state.syncing=true;
    try {
      const data=await api('GET','/rooms/'+state.roomId+'/voice/publications');
      const upcoming=(data.publications||[]).filter(x=>x &&
        !state.subscribed.has(x.sessionId+':'+x.trackName));
      if(!upcoming.length)return;
      for(let cursor=0;cursor<upcoming.length;cursor+=8) {
        if(state.closed)return;
        const batch=upcoming.slice(cursor,cursor+8);
        const response=await api('POST','/rooms/'+state.roomId+'/voice/subscribe',{
          sessionId:state.subscribeId,
          publications:batch.map(x=>({sessionId:x.sessionId,trackName:x.trackName}))
        });
        // Map the SFU's receiving MIDs before setRemoteDescription fires "track".
        for(const track of response.tracks||[]) {
          state.remoteMids.set(String(track.mid),track.userId||'');
        }
        await state.receivePC.setRemoteDescription(response.sessionDescription);
        const answer=await state.receivePC.createAnswer();
        await state.receivePC.setLocalDescription(answer);
        await waitIce(state.receivePC);
        await api('PUT','/rooms/'+state.roomId+'/voice/renegotiate',{
          sessionId:state.subscribeId,sessionDescription:state.receivePC.localDescription
        });
        batch.forEach(x=>state.subscribed.add(x.sessionId+':'+x.trackName));
      }
    }catch(error) {
      console.warn('Sharika voice subscriptions:',errText(error));
    }finally {state.syncing=false;}
  }
  async function connectSfu(roomId,canPublish) {
    const state={
      roomId,closed:false,sessionIds:[],publishPC:null,receivePC:null,
      media:null,audioElements:new Set(),remoteMids:new Map(),
      subscribed:new Set(),subscribeId:null,timer:null,syncing:false
    };
    sfuState=state;
    try {
      if(canPublish) {
        state.media=await navigator.mediaDevices.getUserMedia({
          audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false
        });
        if(wantedVoiceRoom!==roomId)throw new Error('Voice room changed');
        state.publishPC=new RTCPeerConnection();
        const local=state.media.getAudioTracks()[0];
        const transceiver=state.publishPC.addTransceiver(local,{direction:'sendonly'});
        const offer=await state.publishPC.createOffer();
        await state.publishPC.setLocalDescription(offer);
        await waitIce(state.publishPC);
        const published=await api('POST','/rooms/'+roomId+'/voice/session',{mode:'publish'});
        state.sessionIds.push(published.sessionId);
        const negotiation=await api('POST','/rooms/'+roomId+'/voice/publish',{
          sessionId:published.sessionId,
          sessionDescription:state.publishPC.localDescription,
          mid:transceiver.mid,trackName:'microphone'
        });
        await state.publishPC.setRemoteDescription(negotiation.sessionDescription);
      }
      if(wantedVoiceRoom!==roomId)throw new Error('Voice room changed');
      const joined=await api('POST','/rooms/'+roomId+'/voice/session',{mode:'subscribe'});
      state.subscribeId=joined.sessionId;
      state.sessionIds.push(joined.sessionId);
      state.receivePC=new RTCPeerConnection();
      state.receivePC.ontrack=event=>addAudioTrack(state,event);
      await subscribeSfu(state);
      // Refresh both presence and publications; do not consume room resources
      // on a tight per-frame timer.
      state.timer=setInterval(()=>{
        if(state.closed)return;
        api('POST','/rooms/'+roomId+'/voice/heartbeat',{sessionIds:state.sessionIds}).catch(()=>{});
        subscribeSfu(state).catch(()=>{});
      },8000);
      return {publishing:canPublish};
    }catch(error){
      await disconnectSfu();
      throw error;
    }
  }

  async function voiceSdk() {
    if (window.LivekitClient) return window.LivekitClient;
    if (!voiceSdkPromise) {
      voiceSdkPromise = new Promise((resolve,reject)=>{
        const script = document.createElement('script');
        // The version is pinned; only fetched when a Sharika-scoped token is
        // available. Never load the live user's Supabase voice adapter.
        script.src='https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js';
        script.onload=()=>window.LivekitClient ?
          resolve(window.LivekitClient) : reject(new Error('LiveKit SDK unavailable'));
        script.onerror=()=>reject(new Error('LiveKit SDK could not load'));
        document.head.appendChild(script);
      });
    }
    return voiceSdkPromise;
  }
  async function disconnectVoice() {
    if(sfuState)await disconnectSfu();
    voiceBackend=null;
    if(!voiceRoom)return;
    const room=voiceRoom;
    voiceRoom=null;voiceRoomId=null;
    await room.disconnect();
  }
  // One connection transition at a time: seat/poll callbacks can fire together.
  // Switching rooms or leaving invalidates stale async connection attempts.
  let voiceOperation=Promise.resolve(),pendingVoice=null,wantedVoiceRoom=null;
  function releaseVoice() {
    wantedVoiceRoom=null;
    const task=voiceOperation.catch(()=>{}).then(()=>disconnectVoice());
    voiceOperation=task;
    return task;
  }
  async function connectVoice(roomId) {
    if(pendingVoice?.roomId===roomId)return pendingVoice.promise;
    wantedVoiceRoom=roomId;
    const task=voiceOperation.catch(()=>{}).then(async()=>{
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      const config=await api('GET','/rooms/'+roomId+'/voice/config');
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      await disconnectVoice();
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      if(config.provider==='cloudflare_sfu') {
        voiceBackend='cloudflare_sfu';
        return connectSfu(roomId,!!config.publish);
      }
      if(config.provider!=='livekit')throw new Error('Voice provider unavailable');
      // Keep the isolated LiveKit fallback only when explicitly configured.
      const info=await api('POST','/rooms/'+roomId+'/voice-token',{});
      const sdk=await voiceSdk();
      if(wantedVoiceRoom!==roomId)return {publishing:false,stale:true};
      voiceBackend='livekit';
      const room=new sdk.Room({
        audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true}
      });
      room.on(sdk.RoomEvent.TrackSubscribed,(track)=>{
        if(track.kind===sdk.Track.Kind.Audio) {
          const element=track.attach();
          element.autoplay=true;
          element.dataset.sharikaVoice='true';
          document.body.appendChild(element);
        }
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed,(track)=>{
        track.detach().forEach(node=>node.remove());
      });
      room.on(sdk.RoomEvent.ActiveSpeakersChanged,(speakers)=>{
        const frame=document.getElementById('rf')?.contentWindow;
        if(!frame || !frame.seats)return;
        const talking=new Set(speakers.map(p=>p.identity));
        for(const seat of frame.seats){
          if(seat && seat.user_id)seat.talk=talking.has('sharika:'+seat.user_id);
        }
        if(typeof frame.render==='function')frame.render();
      });
      try{await room.connect(info.url,info.token);}
      catch(error){await room.disconnect().catch(()=>{});throw error;}
      if(wantedVoiceRoom!==roomId) {
        await room.disconnect().catch(()=>{});
        return {publishing:false,stale:true};
      }
      voiceRoom=room;voiceRoomId=roomId;
      try{await room.startAudio();}catch(_){}
      if(info.publish)await room.localParticipant.setMicrophoneEnabled(true);
      return {publishing:!!info.publish};
    });
    voiceOperation=task;
    pendingVoice={roomId,promise:task};
    try {
      const result=await task;
      if(!result.stale && wantedVoiceRoom===roomId)markLocalMicrophone(!!result.publishing);
      return result;
    } finally {
      if(pendingVoice?.promise===task)pendingVoice=null;
    }
  }
  function markLocalMicrophone(enabled) {
    const frame=document.getElementById('rf')?.contentWindow;
    if(!frame||!Array.isArray(frame.seats))return;
    const localSeat=frame.seats.find(slot=>slot?.user_id===session?.user?.id);
    if(localSeat) {
      localSeat.muted=!enabled;
      if(typeof frame.render==='function')frame.render();
    }
    const mic=frame.$?.('mic');
    if(mic) {
      mic.textContent=enabled?'🎤':'🔇';
      mic.classList.toggle('off',!enabled);
    }
  }
  async function toggleVoice() {
    if(sfuState) {
      const track=sfuState.media?.getAudioTracks()[0];
      if(!track)throw new Error('Take an available mic seat first');
      track.enabled=!track.enabled;
      markLocalMicrophone(track.enabled);
      return track.enabled;
    }
    if(!voiceRoom || !voiceRoomId)throw new Error('Voice connection is not available');
    const currently=voiceRoom.localParticipant.isMicrophoneEnabled;
    await voiceRoom.localParticipant.setMicrophoneEnabled(!currently);
    markLocalMicrophone(!currently);
    return !currently;
  }
  function cleanLocalFakeState() {
    try {
      localStorage.removeItem('vr_guest');
      localStorage.removeItem('sharika_supabase_session_v1');
      localStorage.removeItem('vr_state_v2');
      localStorage.removeItem('vr_sess');
      localStorage.removeItem('vr_app_v1');
      // An isolated staging build must never import the HTML demo accounts.
      localStorage.setItem(ACCOUNT_KEY, '[]');
    } catch (_) {}
    window.CFG.rooms = [];
    window.CFG.people = [];
    window.CFG.chats = [];
    window.CFG.wealth = [];
    window.renderRooms();
  }
  function remember(account, current) {
    profile = current;
    const key = String(account.email || current.user_id || '').toLowerCase();
    const local = {
      key,
      p: {
        id: current.public_id, name: current.name, pic: current.pic || null,
        country: current.country || '', dob: current.birthdate || '',
        minor: !!current.minor, cover: current.cover || null, bio: current.bio || '',
        myRoom: null, claim: { d:'', streak:0 }
      },
      state: { coins:current.coins || 0, dia:current.diamonds || 0, xp:current.xp || 0 }
    };
    balance = { ...local.state };
    session = { email: account.email, user: { id:current.user_id, email:account.email } };
    startPresence();
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local]));
      localStorage.setItem('vr_state_v2', JSON.stringify(balance));
    } catch (_) {}
    return local;
  }
  function cachedSignup(email) {
    try {
      const record = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      return record && record.email === email ? record : null;
    } catch (_) { return null; }
  }
  function birthdateFromUi(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD for your date of birth');
    return value;
  }
  function profileForm(account) {
    return new Promise((resolve, reject) => {
      const layer = document.createElement('div');
      layer.id = 'sharika-stage-profile-setup';
      layer.style.cssText = 'position:fixed;z-index:2147483646;inset:0;background:#0c0920f5;display:flex;align-items:center;justify-content:center;padding:22px;color:white;font-family:inherit';
      layer.innerHTML = '<form style="width:min(100%,410px);background:linear-gradient(160deg,#2d2158,#131530);border:1px solid #6754c0;border-radius:24px;padding:24px;box-shadow:0 15px 45px #0008">' +
        '<h2 style="margin:0 0 8px">Finish your Sharika profile</h2>' +
        '<p style="font-size:13px;opacity:.8">A real name and birth date are needed for the new staging account. Existing accounts are not imported.</p>' +
        '<label>Name<input name="name" maxlength="80" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0" value=""></label>' +
        '<label>Birth date<input name="birthdate" type="date" required style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<label>Country<input name="country" maxlength="16" placeholder="BD" style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<label>Invite code (optional)<input name="invite_code" maxlength="8" inputmode="numeric" placeholder="8-digit inviter ID" style="box-sizing:border-box;width:100%;margin:8px 0 16px;padding:13px;border-radius:10px;background:#fff;color:#161121;border:0"></label>' +
        '<div id="stage-profile-error" style="color:#ffb4b4;font-size:13px"></div>' +
        '<button type="submit" style="width:100%;padding:15px;border:0;border-radius:14px;background:#8e72f6;color:#fff;font-weight:700">Create staging profile</button>' +
        '<button type="button" id="stage-profile-cancel" style="width:100%;padding:13px;border:0;background:transparent;color:#ddd">Cancel</button></form>';
      document.body.appendChild(layer);
      const name = layer.querySelector('[name="name"]');
      name.value = account.displayName || '';
      layer.querySelector('[name="invite_code"]').value=cachedSignup(account.email)?.invite_code||'';
      let finished = false;
      function close() { if (finished) return; finished = true; layer.remove(); }
      layer.querySelector('#stage-profile-cancel').onclick = () => {
        close(); reject(new Error('Profile setup cancelled'));
      };
      layer.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('[type=submit]');
        button.disabled = true;
        try {
          const data = {
            name:form.elements.name.value.trim(),
            birthdate:birthdateFromUi(form.elements.birthdate.value),
            country:form.elements.country.value.trim(),
            invite_code:form.elements.invite_code.value.trim()
          };
          const saved = await api('POST','/me',data);
          close(); resolve(saved);
        } catch (error) {
          layer.querySelector('#stage-profile-error').textContent = errText(error);
          button.disabled = false;
        }
      };
    });
  }
  async function ensureProfile(account, form) {
    try { return await api('GET', '/me'); }
    catch (error) {
      if (errText(error) !== 'profile_not_found') throw error;
      const cached = form || cachedSignup(account.email);
      if (cached && cached.name && cached.dob) {
        try{
          const saved = await api('POST','/me',{
            name:cached.name,birthdate:cached.dob,country:cached.country||'',
            invite_code:cached.invite_code||''
          });
          try{localStorage.removeItem(META_KEY);}catch(_){}
          return saved;
        }catch(error){
          if(!['invalid_invite_code','invite_code_not_found','cannot_invite_self'].includes(errText(error)))
            throw error;
          // A typed invite code can be corrected without making a fake account.
        }
      }
      return profileForm(account);
    }
  }
  async function authenticated(account, form) {
    if (!account.signedIn || !account.emailVerified)
      throw new Error('Check your email verification link, then sign in again');
    const current = await ensureProfile(account, form);
    const local = remember(account, current);
    await Promise.allSettled([reloadWallet(), reloadRooms()]);
    // The original UI's login function reconstructs A from this object;
    // carry the real room back so it does not hide the newly loaded own room.
    local.p.myRoom = window.A.myRoom || null;
    local.state = {...balance};
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify([local])); } catch (_) {}
    return local;
  }


  // Add one optional field to the original themed signup card; no layout redesign.
  function ensureInviteCodeInput(){
    const auth=document.getElementById('au');
    const terms=auth?.querySelector('.tc');
    if(!terms||auth.querySelector('#stage-invite-code'))return;
    terms.insertAdjacentHTML('beforebegin',
      '<div class="lbl">Invite code (optional)</div>'+
      '<input class="field" id="stage-invite-code" maxlength="8" inputmode="numeric" '+
      'placeholder="Inviter 8-digit Sharika ID" autocomplete="off">');
  }
  const inviteAuthRoot=document.getElementById('au');
  if(inviteAuthRoot){
    const inviteObserver=new MutationObserver(ensureInviteCodeInput);
    inviteObserver.observe(inviteAuthRoot,{childList:true});
    ensureInviteCodeInput();
  }

  window.API.signup = async function (form) {
    if (!form.key || !form.key.includes('@'))
      return { ok:false, msg:'Use an email address. Phone OTP is not enabled yet.' };
    if (String(form.pw || '').length < 12)
      return { ok:false, msg:'Use at least 12 characters for your password.' };
    try {
      const result = await native('emailSignUp', {email:form.key.trim(), password:form.pw});
      try {
        localStorage.setItem(META_KEY, JSON.stringify({
          email:form.key.trim(), name:form.name, dob:form.dob, country:form.country,
          invite_code:document.getElementById('stage-invite-code')?.value.trim()||''
        }));
      } catch (_) {}
      return { ok:false, msg:result.verificationSent ?
        'Account created. Verify your email, then log in.' :
        'Account created. Verification email could not be sent; try again later.' };
    } catch (error) { return { ok:false, msg:errText(error) }; }
  };
  window.API.login = async function (identity, password) {
    if (!identity.includes('@')) return {ok:false,msg:'Sign in using your email address'};
    try {
      const account = await native('emailSignIn',{email:identity.trim(),password});
      const local = await authenticated(account);
      return {ok:true,acct:local};
    } catch (error) { return {ok:false,msg:errText(error)}; }
  };
  async function googleLogin() {
    try {
      toast('Opening Google account picker…');
      const account = await native('googleSignIn');
      const local = await authenticated(account);
      window.enter(local,'Signed in to Sharika staging');
    } catch (error) { toast(errText(error)); }
  }

  // Keep original login imagery, forms, colors, and navigation.
  const previousAuthRender = window.authRender;
  window.authRender = function () {
    previousAuthRender();
    const google = document.getElementById('wg');
    if (google) google.onclick = googleLogin;
    for (const id of ['wgs','ag']) {
      const guest = document.getElementById(id);
      if (guest) {
        guest.disabled = true;
        guest.style.display = 'none';
      }
    }
    const notice = document.querySelector('#au .aw > .lbl:last-child');
    if (notice) notice.textContent = 'Accounts use real Firebase Authentication and isolated Cloudflare staging.';
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (['wgs','ag'].includes(button.id)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Sign in to use Sharika');
    }
  }, true);

  window.RS = function () { return {...balance}; };
  window.addCoins = function () { toast('Coin changes require the verified server'); };
  window.addDia = function () { toast('Diamond changes require the verified server'); };
  // Authenticated users only: a backgrounded app disappears after 90 seconds.
  let presenceTimer=null;
  async function heartbeatPresence(roomId) {
    if(!session)return;
    try {
      await api('POST','/presence/heartbeat',{
        room_id:roomId===undefined?(window.cur?.id||null):roomId
      });
    }catch(error){console.warn('Sharika presence:',errText(error));}
  }
  function startPresence(){
    if(presenceTimer)clearInterval(presenceTimer);
    heartbeatPresence(null);
    presenceTimer=setInterval(()=>{
      heartbeatPresence();
      // Refresh real room-card counters without changing the original cards.
      if(!window.cur && document.visibilityState==='visible')reloadRooms().catch(()=>{});
    },25000);
  }
  async function reloadWallet() {
    const wallet = await api('GET','/wallet');
    balance = {coins:Number(wallet.coins)||0,dia:Number(wallet.diamonds)||0,xp:Number(wallet.xp)||0};
    localStorage.setItem('vr_state_v2',JSON.stringify(balance));
    window.refresh();
    return wallet;
  }
  async function reloadRooms() {
    if (busyRooms || !session) return;
    busyRooms = true;
    try {
      const data = await api('GET','/rooms');
      const rows = data.rooms || [];
      const own = rows.find(r => r.owner_id === session.user.id);
      window.CFG.rooms = rows.filter(r => r.owner_id !== session.user.id).map((r,i)=>({
        id:r.id,name:r.name,emoji:r.emoji || '🎙️',n:Number(r.online_count)||0,host:'Room owner',
        tag:'Voice Room',mics:[],c:COLORS[i%COLORS.length],
        th:r.theme || 'mid',owner_id:r.owner_id,seat_count:r.seat_count
      }));
      window.A.myRoom = own ? {
        id:own.id,name:own.name,emoji:own.emoji,th:own.theme,
        c:COLORS[0],owner_id:own.owner_id,seat_count:own.seat_count,n:Number(own.online_count)||0
      } : null;
      window.renderRooms();
    } catch (error) { toast('Rooms unavailable: '+errText(error)); }
    finally { busyRooms = false; }
  }
  async function syncFrame(room,frame) {
    if (!frame || !frame.seats || !window.cur || window.cur.id !== room.id) return;
    const [data,owner] = await Promise.all([
      api('GET','/rooms/'+room.id+'/members'),
      api('GET','/users/'+room.id)
    ]);
    const self=(data.members||[]).find(m=>m.user_id===session?.user?.id);
    const eligible=room.owner_id===session?.user?.id||
      (!!self && self.seat_no!==null && !self.muted);
    if(sfuState?.roomId===room.id && !!sfuState.media!==!!eligible)
      connectVoice(room.id).catch(error=>frame.toast('Voice update: '+errText(error)));
    const localMic=sfuState?.roomId===room.id ?
      sfuState.media?.getAudioTracks()[0]?.enabled :
      voiceRoomId===room.id&&voiceRoom ?
        voiceRoom.localParticipant.isMicrophoneEnabled : undefined;
    const slots = Array.from({length: Math.max(2,Number(room.seat_count||12)+1)},
      (_,i)=>({empty:1,i}));
    slots[0]={n:owner.name,e:'👑',i:0,user_id:room.owner_id,public_id:room.id,
      muted:room.owner_id===session?.user?.id&&localMic===false,talk:false};
    const audience=[];
    for(const member of data.members || []) {
      const user=member.sharika_users;
      if(!user || member.user_id===room.owner_id) continue;
      if(Number.isInteger(member.seat_no) && member.seat_no>0 && member.seat_no<slots.length)
        slots[member.seat_no]={
          n:user.name,e:'👤',i:member.seat_no,user_id:member.user_id,public_id:user.public_id,
          muted:!!member.muted||(member.user_id===session?.user?.id&&localMic===false),talk:false
        };
      else audience.push({n:user.name,e:'👤',id:user.public_id,lv:user.wealth_level});
    }
    frame.seats=slots;
    frame.U=audience;
    frame.S.coins=balance.coins;
    frame.S.xp=balance.xp;
    frame.S.n=slots.length;
    frame.render();
  }
  async function attachFrame(room) {
    const frame=document.getElementById('rf')?.contentWindow;
    if (frame && frame.document) fitAndroidViewport(frame.document, true);
    if(!frame || !frame.seats || !window.cur || window.cur.id!==room.id) return;
    frame.tick=function(){};
    frame.U=[];
    frame.G=[];
    frame.sendGift=function(){ frame.toast('Use the verified gift box Send button'); };
    frame.others=function(){return (frame.seats||[]).filter(s=>s&&!s.empty&&!s.lock);};
    // Only the server may enable Lucky Gifts, and never for a minor.
    frame.__minor=profile?.minor!==false;
    frame.__luckyOff=true;
    let availableGiftIds=[];
    let giftBusy=false;
    let lastGiftEventId=null;
    let lastChatId=0,chatPollInFlight=null,chatSendBusy=false;
    // Load only the real gift catalog approved in D1 by the admin panel.
    // Keep the existing original Sharika gift box and its original artwork.
    const giftButton=frame.$ && frame.$('bGift');
    const originalGiftOpen=giftButton && giftButton.onclick;
    if(giftButton)giftButton.onclick=async ()=>{
      try{
        const data=await api('GET','/gifts');
        const gifts=(data.gifts||[]).filter(g=>g.tab===0||g.tab===1||
          (g.tab===2 && data.lucky_enabled===true && profile?.minor===false));
        if(!gifts.length){frame.toast('No active gifts in the catalog yet');return;}
        const htmlSafe=text=>String(text??'').replace(/[&<>"']/g,
          c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const imageSafe=value=>{
          const url=String(value||'').trim();
          return url.startsWith('https://') && url.length<=1000 &&
            !Array.from(url).some(c=>c.charCodeAt(0)<=32 || ['"',"'",'<','>'].includes(c))
            ?htmlSafe(url):'';
        };
        availableGiftIds=gifts.map(g=>g.id);
        frame.__luckyOff=!gifts.some(g=>g.tab===2);
        frame.gtab=[0,1,2].find(tab=>gifts.some(g=>g.tab===tab))??0;
        frame.gsel=Math.max(0,gifts.findIndex(g=>g.tab===frame.gtab));
        frame.G=gifts.map(g=>[htmlSafe(g.emoji||'🎁'),Number(g.price_coins),
          htmlSafe(g.name),Number(g.tab),imageSafe(g.image_url)]);
        if(typeof originalGiftOpen==='function') {
          originalGiftOpen.call(giftButton);
          // Google Play requires chance-based virtual reward odds next to a
          // purchase. Preserve the original gift modal, insert text only.
          frame.document.getElementById('sharika-lucky-odds')?.remove();
          if(data.lucky_enabled===true && Array.isArray(data.lucky_odds)) {
            const send=frame.document.getElementById('snd');
            if(send?.parentElement) {
              const label=frame.document.createElement('div');
              label.id='sharika-lucky-odds';
              label.style.cssText='font-size:11px;line-height:1.4;padding:6px;color:#e7d8ff;text-align:center';
              label.textContent='Lucky Gift odds: '+data.lucky_odds.map(x=>
                x.multiplier+'x '+x.probability_percent+'%').join(' · ')+
                '. Virtual rewards only; no cashout or resale.';
              send.parentElement.insertBefore(label,send);
            }
          }
        } else frame.toast('Gift box unavailable');
      }catch(error){frame.toast('Gift catalog unavailable: '+errText(error));}
    };
    // The original gift game debits a local wallet; always intercept before it
    // executes, settle at the server, then use the original gift flight artwork.
    frame.document.addEventListener('click',async event=>{
      const button=event.target.closest?.('#snd');
      if(!button)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(giftBusy||!session)return;
      giftBusy=true;button.disabled=true;
      try{
        const chosen=Number(frame.gsel);
        const giftId=availableGiftIds[chosen];
        const quantity=Number(frame.qty);
        const indices=Array.isArray(frame.rec)?frame.rec:[];
        const recipients=[...new Set(indices.map(index=>
          frame.seats?.[Number(index)]?.public_id).filter(Boolean))];
        if(!giftId||!Number.isInteger(quantity)||quantity<1||quantity>10||
          !recipients.length)throw new Error('Select a gift and an occupied seat');
        const requestId='gift:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
        const result=await api('POST','/rooms/'+room.id+'/gifts',{
          gift_id:giftId,quantity,recipient_public_ids:recipients,request_id:requestId
        });
        await reloadWallet();
        frame.S.coins=balance.coins;
        frame.S.xp=balance.xp;
        frame.close();
        frame.toast('Gift sent · '+result.spent_coins+' coins charged ✓');
        if(result.lucky) {
          frame.toast('Lucky Gift: receiver 5% diamonds · room 1% reward');
        }
        if(result.lucky && typeof frame.luckyFx==='function') {
          const confirmed={payout_coins:Number(result.lucky.payout_coins)||0,
            max_multiplier:Number(result.lucky.max_multiplier)||0};
          setTimeout(()=>{
            if(window.cur?.id===room.id)
              frame.luckyFx(confirmed.payout_coins,confirmed.max_multiplier,
                frame.G[chosen]||[result.gift.emoji]);
          },1000);
        }
        for(const index of indices.slice(0,20)){
          const slot=frame.seats?.[Number(index)];
          if(!slot||!recipients.includes(slot.public_id))continue;
          for(let n=0;n<Math.min(quantity,2);n++){
            if(typeof frame.fly==='function')
              frame.fly(result.gift.emoji,Number(index),n*180,Number(frame.G[chosen]?.[1]||0));
          }
        }
        const feed=await api('GET','/rooms/'+room.id+'/gifts').catch(()=>null);
        if(feed?.events?.length)lastGiftEventId=Math.max(...feed.events.map(e=>e.id));
      }catch(error){frame.toast('Gift not sent: '+errText(error));}
      finally{giftBusy=false;button.disabled=false;}
    },true);
    async function pollGiftEvents(){
      const data=await api('GET','/rooms/'+room.id+'/gifts');
      const events=data.events||[];
      const latest=Math.max(0,...events.map(e=>Number(e.id)||0));
      if(lastGiftEventId===null){lastGiftEventId=latest;return;}
      let receivedGift=false;
      for(const event of events){
        if(event.id<=lastGiftEventId||event.sender_id===profile?.public_id)continue;
        if(event.recipient_id===profile?.public_id)receivedGift=true;
        const seat=(frame.seats||[]).find(s=>s?.public_id===event.recipient_id);
        if(seat && typeof frame.fly==='function')
          frame.fly(event.emoji,seat.i,0,event.price_coins);
      }
      lastGiftEventId=Math.max(lastGiftEventId,latest);
      // Recipients see their verified diamond/coin balance after incoming gifts.
      if(receivedGift)await reloadWallet();
    }
    async function moderateSeat(action,seat) {
      if(room.owner_id!==session?.user?.id)throw new Error('Room owner only');
      const target=frame.seats?.[seat];
      if(!target||target.empty||!target.public_id||
         target.user_id===room.owner_id)throw new Error('Choose a guest seat');
      const result=await api('POST','/rooms/'+room.id+'/moderate',{
        action,target_public_id:target.public_id
      });
      frame.close();
      await syncFrame(room,frame);
      frame.toast(action==='kick'?'Guest removed for 10 minutes':
        action==='remove_seat'?'Guest removed from mic':'Guest '+action+'d');
      return result;
    }
    frame.act=async function(action,seat) {
      try {
        const target=frame.seats?.[seat];
        const isSelf=target?.user_id===session?.user?.id;
        const owner=room.owner_id===session?.user?.id;
        if(action==='take' && seat>0) {
          await api('PUT','/rooms/'+room.id+'/seat',{seat_no:seat});
          frame.close(); await syncFrame(room,frame);
          let state=await connectVoice(room.id);
          // An in-flight listener connection might have started before the
          // seat assignment; recheck verified publish permission once.
          if(!state.publishing) {
            const current=await api('GET','/rooms/'+room.id+'/voice/config');
            if(current.publish)state=await connectVoice(room.id);
          }
          frame.toast(state.publishing?'Microphone enabled':'Listening to room');
        } else if(action==='down' && seat>0) {
          if(!isSelf && owner && target?.user_id) {
            await moderateSeat('remove_seat',seat);
          } else if(isSelf) {
            await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
            frame.close(); await syncFrame(room,frame);
            await connectVoice(room.id);
            frame.toast('Seat released; listening only');
          } else throw new Error('You can only leave your own seat');
        } else if(action==='mute' && seat>0) {
          if(owner && target?.user_id && !isSelf)
            await moderateSeat(target.muted?'unmute':'mute',seat);
          else if(isSelf) {
            const enabled=await toggleVoice();
            frame.close();
            frame.toast(enabled?'Microphone on':'Microphone off');
          } else throw new Error('Only the owner can mute another user');
        } else if(action==='kick' && seat>0) {
          await moderateSeat('kick',seat);
        } else if(action==='own' && owner) {
          frame.open('<h3>👑 Verified owner controls</h3>'+
            '<div class="row">Tap an occupied seat to mute, unmute, remove from mic or kick a guest.</div>');
        } else if(action==='prof' && target?.public_id) {
          const member=await api('GET','/users/'+target.public_id);
          frame.open('<h3>👤 Verified profile</h3><div id="sh-room-profile"></div>');
          const node=frame.$('sh-room-profile');
          if(node) {
            const name=frame.document.createElement('div');
            name.className='row';
            name.textContent=(member.name||'Member')+' · ID '+member.id;
            const detail=frame.document.createElement('div');
            detail.className='lbl';
            detail.textContent='Country: '+(member.country||'Not set')+
              ' · Wealth Lv '+Number(member.wealth_level||0)+
              ' · Charm Lv '+Number(member.charm_level||0);
            node.append(name,detail);
          }
        } else if(action==='gift' && seat>0 && target?.public_id) {
          frame.rec=[seat];
          frame.$('bGift')?.click();
        } else frame.toast('This action is not connected to the verified server yet');
      } catch (error) { frame.toast(errText(error)); }
    };
    // The supplied room template advertises a demo 10% weekly local-coin
    // claim. Never expose that fake balance mutation as a real room reward.
    frame.rewardSheet=async function(){
      frame.open('<h3>💰 Verified Room Reward</h3>'+
        '<div id="sh-real-room-reward" class="row">Checking room reward…</div>');
      const target=frame.$('sh-real-room-reward');
      if(!target)return;
      try{
        const rewards=await api('GET','/rooms/'+room.id+'/rewards');
        if(target.isConnected)target.textContent='Lucky Gift room reward: '+
          Number(rewards.reward_coins||0).toLocaleString('en-US')+
          ' coins (held in room ledger, not added to personal wallet).';
      }catch(error){
        if(target.isConnected)target.textContent=
          'Lucky Gift room rewards are unavailable until enabled by the server.';
      }
    };
    // The existing room-settings sheet is reused. Its original Save action
    // runs only after the authenticated D1 owner update succeeds.
    const roomButton=frame.$ && frame.$('roomBtn');
    if(roomButton){
      const oldRoomOpen=roomButton.onclick;
      roomButton.onclick=()=>{
        if(room.owner_id!==session?.user?.id){frame.toast('Only room owner can edit settings');return;}
        if(typeof frame.settings==='function')frame.settings();
        else if(typeof oldRoomOpen==='function')oldRoomOpen.call(roomButton);
        const rewardLabel=frame.$('rRw')?.querySelector('small');
        if(rewardLabel)rewardLabel.textContent='1% of enabled Lucky Gifts · server verified';
      };
    }
    frame.document.addEventListener('click',async event=>{
      const saveButton=event.target.closest?.('#save');
      if(!saveButton || !frame.$('sheet')?.querySelector('h3')?.textContent?.includes('Room settings'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(room.owner_id!==session?.user?.id){frame.toast('Room owner only');return;}
      if(saveButton.disabled)return;
      const oldSave=saveButton.onclick;
      const name=frame.$('nm')?.value?.trim()||'My Sharika room';
      const newSeatCount=Number(frame.S.n)-1;
      if(!Number.isInteger(newSeatCount)||newSeatCount<4||newSeatCount>20){
        frame.toast('Please choose 5–21 total seats');return;
      }
      saveButton.disabled=true;
      try{
        const data=await api('PATCH','/rooms/'+room.id,{
          name,seat_count:newSeatCount,theme:frame.S.theme||room.th||'mid'
        });
        room.name=data.room.name;
        room.seat_count=data.room.seat_count;
        room.th=data.room.theme;
        if(typeof oldSave==='function')oldSave.call(saveButton);
        await reloadRooms();
        await syncFrame(room,frame);
        frame.toast('Room settings saved on server ✓');
      }catch(error){
        frame.S.name=room.name;
        await syncFrame(room,frame).catch(()=>{});
        frame.toast('Settings not saved: '+errText(error));
        saveButton.disabled=false;
      }
    },true);
    // Mirror the verified room conversation into the original chat area.
    // No local-only send, simulated user, or repeated history on reconnect.
    async function pollRoomChat() {
      if(chatPollInFlight)return chatPollInFlight;
      const work=(async()=>{
        if(window.cur?.id!==room.id)return;
        const data=await api('GET','/rooms/'+room.id+'/chat?after='+lastChatId);
        const messages=Array.isArray(data.messages)?data.messages:[];
        for(const item of messages) {
          const id=Number(item.id);
          if(!Number.isSafeInteger(id)||id<=lastChatId)continue;
          lastChatId=id;
          frame.msg(String(item.name||'Member'),'👤',String(item.body||''),{
            me:item.sender_id===profile?.public_id,lv:1
          });
        }
      })();
      chatPollInFlight=work;
      try{await work;}finally{if(chatPollInFlight===work)chatPollInFlight=null;}
    }
    const messageInput=frame.$ && frame.$('txt');
    const messageSend=frame.$ && frame.$('sendTxt');
    async function sendRoomMessage() {
      const body=messageInput?.value?.trim()||'';
      if(!body||chatSendBusy)return;
      if(body.length>300){frame.toast('Room messages must be 300 characters or fewer');return;}
      chatSendBusy=true;
      if(messageSend)messageSend.disabled=true;
      try {
        const requestId='chat:'+Date.now().toString(36)+':'+
          Math.random().toString(36).slice(2);
        await api('POST','/rooms/'+room.id+'/chat',{body,request_id:requestId});
        if(messageInput?.value?.trim()===body)messageInput.value='';
        if(typeof frame.updBtn==='function')frame.updBtn();
        await pollRoomChat();
      }catch(error){frame.toast('Message not sent: '+errText(error));}
      finally {
        chatSendBusy=false;
        if(messageSend)messageSend.disabled=false;
      }
    }
    if(messageSend)messageSend.onclick=sendRoomMessage;
    if(messageInput)messageInput.onkeydown=event=>{
      if(event.key==='Enter'&&!event.shiftKey){
        event.preventDefault();
        sendRoomMessage();
      }
    };
    const imageSend=frame.$ && frame.$('imgBtn');
    if(imageSend)imageSend.onclick=()=>frame.toast('Room photo messages are not online yet');
    pollRoomChat().catch(error=>frame.toast('Chat unavailable: '+errText(error)));
    if(chatPoll)clearInterval(chatPoll);
    chatPoll=setInterval(()=>{
      if(window.cur?.id===room.id)pollRoomChat().catch(()=>{});
    },3500);
    const mic=frame.$ && frame.$('mic');
    if(mic) mic.onclick=async ()=>{
      try {
        const enabled=await toggleVoice();
        mic.textContent=enabled?'🎤':'🔇';
        mic.classList.toggle('off',!enabled);
        frame.toast(enabled?'Microphone enabled':'Microphone muted');
      } catch(error) {frame.toast(errText(error));}
    };
    const inboxButton=frame.$ && frame.$('bMsg');
    if(inboxButton) {
      // The original badge was a demo unread count, not verified server data.
      inboxButton.querySelector('em')?.remove();
      inboxButton.onclick=()=>{
        // Minimize without leaving the D1 room or disconnecting WebRTC audio.
        if(typeof frame.close==='function')frame.close();
        document.getElementById('rw')?.classList.remove('on');
        const bubble=document.getElementById('minib');
        if(bubble)bubble.textContent=room.emoji||'🎙️';
        document.getElementById('mini')?.classList.add('on');
        window.go('msg'); // Reuses verified direct messages and mutual-follow checks.
      };
    }
    const ownerButton=frame.$ && frame.$('bOwn');
    if(ownerButton) {
      ownerButton.style.display=room.owner_id===session?.user?.id?'':'none';
      ownerButton.onclick=()=>frame.open('<h3>👑 Verified owner controls</h3>'+
        '<div class="row">Tap any occupied guest seat to mute, unmute, remove from mic or kick.</div>');
    }
    const roomGameButton=frame.$ && frame.$('bGame');
    if(roomGameButton)roomGameButton.onclick=()=>showGameCard(frame.document,true,frame.toast);
    const rewards=frame.$ && frame.$('rrpill');
    if(rewards) rewards.onclick=async()=>{
      frame.open('<h3>🏆 Weekly Top Rooms</h3>'+
        '<div id="sh-room-week" class="empty">Loading verified room results…</div>'+
        '<p style="font-size:12px;opacity:.7;text-align:center">'+
        'This ranking is read-only. Automatic room-reward coins are not enabled yet.</p>');
      const target=frame.$('sh-room-week');
      if(!target)return;
      try{
        const data=await api('GET','/rankings?period=weekly&kind=room');
        if(!target.isConnected||!session)return;
        target.textContent='';
        const rooms=Array.isArray(data.leaders)?data.leaders.slice(0,10):[];
        if(!rooms.length){
          target.textContent='No verified room gifts recorded this week.';
          return;
        }
        for(const item of rooms){
          const row=frame.document.createElement('div');
          row.className='row';
          const label=frame.document.createElement('b');
          label.textContent='#'+item.rank+' '+(item.emoji||'🎙️')+' '+
            (item.name||'Room')+' · ID '+item.room_id;
          const amount=frame.document.createElement('span');
          amount.textContent='🪙 '+Number(item.total||0).toLocaleString('en-US');
          row.append(label,amount);
          target.appendChild(row);
        }
      }catch(error){
        if(target.isConnected)target.textContent='Room ranking unavailable: '+errText(error);
      }
    };
    await syncFrame(room,frame);
    try {
      const voice=await connectVoice(room.id);
      frame.toast(voice.publishing?'Voice connected, microphone on':'Listening to room');
    } catch(error) {
      frame.toast('Voice pending: '+errText(error));
    }
    if(framePoll) clearInterval(framePoll);
    framePoll=setInterval(()=>{
      if(window.cur?.id!==room.id)return;
      syncFrame(room,frame).catch(error=>{
        if(errText(error)==='join_room_first') {
          window.leaveRoom();
          toast('The room owner removed you from the room');
        }
      });
    },15000);
    if(giftPoll)clearInterval(giftPoll);
    pollGiftEvents().catch(()=>{});
    giftPoll=setInterval(()=>{if(window.cur?.id===room.id)pollGiftEvents().catch(()=>{});},5000);
  }
  // Block simulated gift/chat bots in the original room HTML only in this
  // packaged staging APK. Do not edit the user's original layout or art.
  if(typeof window.ROOM_HTML === 'string') {
    window.ROOM_HTML=window.ROOM_HTML.replace('setInterval(botGift,28000);','');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'function others(){return seats.filter(function(s){return s.i>0&&!s.empty&&!s.lock})}',
      'function others(){return seats.filter(function(s){return !s.empty&&!s.lock})}');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      /setInterval\(function\(\)\{var o=others\(\);[\s\S]*?\},9000\);/,'');
    window.ROOM_HTML=window.ROOM_HTML.replace(
      'msg("Rafi","🧑‍🎤","Greetings to everyone 👋",{ci:1,lv:16});'+
      'msg("Nusrat","👩‍🦰","Will sing tonight 🎶",{ci:2,lv:19});','');
  }
  const originalOpenRoom=window.openRoom;
  window.openRoom=async function(room) {
    if(!session){ window.showAuth('welcome'); return; }
    try {
      const prior=window.cur;
      if(prior?.id===room.id) {
        document.getElementById('rw')?.classList.add('on');
        document.getElementById('mini')?.classList.remove('on');
        return;
      }
      // Room-to-room navigation must release old seats, membership and audio.
      if(prior && prior.id!==room.id) {
        if(framePoll){clearInterval(framePoll);framePoll=null;}
        if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
        if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
        await releaseVoice();
        await api('POST','/rooms/'+prior.id+'/leave',{});
      }
      await api('POST','/rooms/'+room.id+'/join',{});
      heartbeatPresence(room.id);
      const iframe=document.getElementById('rf');
      iframe.onload=()=>attachFrame(room).catch(error=>toast(errText(error)));
      originalOpenRoom(room);
    } catch(error) { toast('Could not join: '+errText(error)); }
  };
  const originalLeaveRoom=window.leaveRoom;
  window.leaveRoom=function() {
    const current=window.cur;
    if(framePoll){clearInterval(framePoll);framePoll=null;}
    if(giftPoll){clearInterval(giftPoll);giftPoll=null;}
    if(chatPoll){clearInterval(chatPoll);chatPoll=null;}
    releaseVoice().catch(()=>{});
    if(current && session)api('POST','/rooms/'+current.id+'/leave',{}).catch(()=>{});
    if(session)heartbeatPresence(null);
    const iframe=document.getElementById('rf');
    if(iframe) iframe.onload=null;
    originalLeaveRoom();
  };
  // Preserve original recharge/exchange artwork, but never use demo balances.
  // The rate is fixed on the verified server: 100 diamonds -> 70 coins.
  window.RATE=0.7;
  let selectedRecharge='';let selectedDiamonds=null;let walletOperationBusy=false;
  document.addEventListener('click',e=>{
    const exchange=e.target.closest?.('#rcp [data-e]');
    if(exchange){
      const presets=[500,1000,5000,20000];
      selectedDiamonds=presets[Number(exchange.dataset.e)]||null;
    }
    const recharge=e.target.closest?.('#rcp [data-p]');
    if(recharge)selectedRecharge=recharge.textContent.trim().replace(/\s+/g,' ').slice(0,150);
  },true);
  function nextWalletRequestId(prefix){
    return prefix+':'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
  }

  // Approved Coin Sellers: actual D1 seller rows, never fabricated profiles.
  const sellerEscape=v=>String(v==null?'':v).replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function showVerifiedCoinSellers(){
    window.openSheet('<h3>🪙 Coin sellers</h3><div id="sharika-seller-content">Loading approved sellers…</div>');
    const root=document.getElementById('sharika-seller-content');
    if(!root)return;
    try{
      const [directory,mine]=await Promise.all([
        api('GET','/sellers'),api('GET','/sellers/me')
      ]);
      if(!root.isConnected)return;
      const listed=(directory.sellers||[]).map(s=>
        '<div class="opt" style="padding:10px;border-radius:12px">'+
        '<b>🪙 '+sellerEscape(s.name||'Coin seller')+'</b> · ID '+
        sellerEscape(s.public_id)+'</div>').join('');
      const self=mine.seller;
      const me=self&&self.active?
        '<div class="card" style="margin-top:12px;padding:12px">'+
        '<b>Your seller stock: '+Number(self.available_coins||0).toLocaleString('en-US')+' coins</b>'+
        '<p class="n">Recharge an existing Sharika user with your assigned seller stock.</p>'+
        '<input id="sharika-seller-target" inputmode="numeric" maxlength="8" placeholder="Recipient 8-digit user ID" aria-label="Recipient user ID">'+
        '<input id="sharika-seller-amount" inputmode="numeric" placeholder="Coins to send (1–1,000,000)" aria-label="Coins to send">'+
        '<button class="btn" type="button" id="sharika-seller-send">Transfer coins</button>'+
        '<div id="sharika-seller-note" aria-live="polite"></div></div>':
        self?'<p class="n">Your seller permission is currently suspended.</p>':'';
      root.innerHTML='<div class="empty">'+(listed||'No approved coin sellers yet.')+'</div>'+me;
      const send=document.getElementById('sharika-seller-send');
      if(send)send.addEventListener('click',async()=>{
        const recipient=document.getElementById('sharika-seller-target')?.value.trim()||'';
        const raw=document.getElementById('sharika-seller-amount')?.value.trim()||'';
        const amount=Number(raw);
        const note=document.getElementById('sharika-seller-note');
        if(!/^[0-9]{8}$/.test(recipient)||!/^\d+$/.test(raw)||
          !Number.isSafeInteger(amount)||amount<1||amount>1000000){
          if(note)note.textContent='Enter a valid eight-digit user ID and 1–1,000,000 coins.';
          return;
        }
        if(!window.confirm('Transfer '+amount.toLocaleString('en-US')+' coins to user '+recipient+'?'))return;
        const requestId=nextWalletRequestId('seller');
        send.disabled=true;
        try{
          const result=await api('POST','/sellers/transfer',{
            target_public_id:recipient,coins:amount,request_id:requestId
          });
          if(note)note.textContent='Transfer #'+result.transfer_id+' complete. Remaining stock: '+
            Number(result.available_coins).toLocaleString('en-US')+' coins.';
          toast('Coin transfer recorded');
          await reloadWallet();
        }catch(error){
          if(note)note.textContent=errText(error);
          send.disabled=false;
        }
      });
    }catch(error){if(root.isConnected)root.textContent='Unable to load sellers: '+errText(error);}
  }


  // Original daily reward card retained; values and claim status come from D1.
  let dailyClaimBusy=false;
  async function showVerifiedDailySheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🎁 Daily check-in</h3>'+
      '<div id="sharika-daily-content" aria-live="polite">Loading verified daily rewards…</div>');
    const root=document.getElementById('sharika-daily-content');
    if(!root)return;
    try{
      const data=await api('GET','/daily');
      if(!root.isConnected)return;
      const steps=(data.rewards||[]).map((coins,i)=>
        '<button type="button" class="'+(data.next_day===i+1&&!data.claimed_today?'sel':'')+
        '" disabled style="'+(data.claimed_today&&data.claimed?.streak===i+1?'opacity:.6;':'')+'">'+
        '<span>'+(i===6?'🎁':'🪙')+'</span>Day '+(i+1)+'<br>'+
        Number(coins).toLocaleString('en-US')+'</button>').join('');
      const claim=data.claimed_today?
        '<button class="big" id="cl" disabled style="opacity:.5">Today reward already claimed ✓</button>':
        '<button class="big" id="cl">🪙 '+Number(data.rewards?.[data.next_day-1]||0).toLocaleString('en-US')+
        ' Get coins</button>';
      const tasks=(data.tasks||[]).map(t=>
        '<div class="row"><span>'+(t.completed?'✅ ':'☑️ ')+sellerEscape(t.title)+
        '</span><b>'+(t.completed?'Done':'Pending')+'</b></div>').join('');
      root.innerHTML='<div class="g4">'+steps+'</div>'+claim+
        '<p class="n">Your streak: '+Number(data.streak||0)+' days · Resets after a missed UTC day.</p>'+
        '<div class="card" style="margin-top:12px;padding:12px"><b>Today’s activity</b>'+
        (tasks||'<p class="n">No task activity available.</p>')+
        '<p class="n">Task progress is verified; separate task coin rewards are not enabled.</p></div>';
    }catch(error){if(root.isConnected)root.textContent='Daily rewards unavailable: '+errText(error);}
  }
  async function claimVerifiedDaily(){
    if(dailyClaimBusy)return;
    dailyClaimBusy=true;
    const button=document.getElementById('cl');
    if(button)button.disabled=true;
    try{
      const result=await api('POST','/daily/check-in',{});
      await reloadWallet();
      toast(result.duplicate?'Today’s reward was already claimed':
        '+'+Number(result.claimed?.reward_coins||0).toLocaleString('en-US')+' coins received 🎉');
      await showVerifiedDailySheet();
    }catch(error){
      toast('Check-in failed: '+errText(error));
      if(button)button.disabled=false;
      // A concurrent claim may have succeeded: server refresh resolves truth.
      await showVerifiedDailySheet();
    }finally{dailyClaimBusy=false;}
  }
  async function showVerifiedInviteSheet(){
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🤝 Invite a friend</h3>'+
      '<div id="sharika-invite-data" aria-live="polite">Loading verified invites…</div>');
    const root=document.getElementById('sharika-invite-data');
    if(!root)return;
    try{
      const result=await api('GET','/invites');
      if(!root.isConnected)return;
      const invite=String(result.invite_code||'');
      if(!/^[0-9]{8}$/.test(invite))throw new Error('Verified ID unavailable');
      const referrals=(result.referrals||[]).map(r=>
        '<div class="row"><span>ID '+sellerEscape(r.public_id)+'</span>'+
        '<b>'+sellerEscape(r.name)+'</b></div>').join('');
      root.innerHTML='<p class="n">New invite signup: you earn 5,000 coins; your friend starts with 10,000 coins. You also earn 5% of their verified coin-seller recharges.</p>'+
        '<div class="idp" style="margin-top:12px">Your invite code: <b>'+
        sellerEscape(invite)+'</b></div>'+
        '<div class="row"><span>Friends who joined</span><b>'+
        Number(result.total_invites||0).toLocaleString('en-US')+'</b></div>'+
        '<div class="row"><span>Signup invite rewards earned</span><b>'+
        Number(result.signup_bonus_coins||0).toLocaleString('en-US')+' coins</b></div>'+
        '<div class="row"><span>5% recharge rewards earned</span><b>'+
        Number(result.recharge_bonus_coins||0).toLocaleString('en-US')+' coins</b></div>'+
        (result.invited_by?'<p class="n">You joined with code '+sellerEscape(result.invited_by)+'</p>':'')+
        (referrals?'<div class="card" style="padding:12px;margin-top:12px">'+
        '<b>Verified referrals</b>'+referrals+'</div>':'')+
        '<button class="big" id="sharika-share-invite">📤 Share code</button>';
      document.getElementById('sharika-share-invite')?.addEventListener('click',async()=>{
        const message='Join me on Sharika Voice Chat! Enter my invite code '+invite+
          ' when creating your account.';
        try{
          if(navigator.share)await navigator.share({text:message});
          else if(navigator.clipboard)await navigator.clipboard.writeText(message);
          else{toast('Invite code: '+invite);return;}
          toast('Invite code shared');
        }catch(_){toast('Invite code: '+invite);}
      });
    }catch(error){if(root.isConnected)root.textContent='Invite tracking unavailable: '+errText(error);}
  }
  window.dailySheet=showVerifiedDailySheet;
  window.inviteSheet=showVerifiedInviteSheet;
  document.addEventListener('click',event=>{
    const daily=event.target.closest?.('#qd,[data-m="daily"]');
    const invite=event.target.closest?.('#qi,[data-m="invite"]');
    if(!daily&&!invite)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(daily)showVerifiedDailySheet();else showVerifiedInviteSheet();
  },true);

  // Wallet writes require verified exchange, check-in or approved seller transfer.
  document.addEventListener('click', async event => {
    const button=event.target.closest('button');
    if(!button) return;
    const id=button.id;
    if(!['cl','pc','ec','cm','rcs','rcl2'].includes(id)) return;
    if(id==='ec' && !document.querySelector('#sh h3')?.textContent?.includes('Exchange')) return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!session){window.showAuth('welcome');return;}
    if(id==='cl'){await claimVerifiedDaily();return;}
    if(id==='rcl2'){await showVerifiedCoinSellers();return;}
    if(id==='rcs'){
      document.getElementById('rcp')?.classList.remove('on');
      openSupportThread();return;
    }
    if(id==='ec'||id==='pc'){
      if(walletOperationBusy)return;
      walletOperationBusy=true;button.disabled=true;
      try{
        if(id==='ec'){
          if(!selectedDiamonds)throw new Error('Select a diamond amount');
          const result=await api('POST','/wallet/exchange',{
            diamonds:selectedDiamonds,request_id:nextWalletRequestId('exchange')
          });
          await reloadWallet();
          window.closeSheet();
          toast(result.duplicate?'Exchange already completed':
            'Exchange complete: +'+result.credited_coins+' coins');
        }else{
          if(!selectedRecharge)throw new Error('Choose a recharge package');
          await api('POST','/support/messages',{
            body:'Recharge request · '+selectedRecharge+' · User ID '+
              String(profile?.public_id||'')+
              '. Please verify payment and confirm before crediting coins.',
            request_id:nextWalletRequestId('recharge')
          });
          window.closeSheet();
          toast('Recharge request sent to verified support. No coins added yet.');
        }
      }catch(error){toast('Request not completed: '+errText(error));}
      finally{walletOperationBusy=false;button.disabled=false;}
      return;
    }
    button.disabled=true;
    try {
      const name=document.getElementById('cn')?.value?.trim() || 'My Sharika room';
      const chosen=document.querySelector('#ce button.sel');
      await api('POST','/rooms',{name,emoji:chosen?.textContent?.trim() || '🎙️',theme:'mid'});
      window.closeSheet();
      await reloadRooms();
      const room=window.myR();
      if(room) window.openRoom(room);
      toast('Your staging room has been created');
    } catch(error) {toast(errText(error));}
    finally {button.disabled=false;}
  },true);

  // Real user-to-admin support chat using the original Sharika message cards.
  let supportPoll=null;
  let supportBusy=false;
  let activePrivateId=null;
  let canSendPrivate=false;
  const safeMessageHTML=value=>String(value??'').replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function loadSupportMessages(){
    const container=document.getElementById('tb');
    if(!container||!session)return;
    const data=await api('GET','/support/messages');
    container.textContent='';
    for(const message of data.messages||[]){
      const bubble=document.createElement('div');
      bubble.className='bub '+(message.sender_role==='user'?'me':'th');
      bubble.textContent=message.body;
      container.appendChild(bubble);
    }
    container.scrollTop=container.scrollHeight;
  }
  async function openSupportThread(){
    activePrivateId=null;canSendPrivate=false;
    const restoredSend=document.getElementById('ts');if(restoredSend)restoredSend.disabled=false;
    if(!session){window.showAuth('welcome');return;}
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='🎧 Customer service';
    const container=document.getElementById('tb');
    container.textContent='Loading support messages…';
    try{await loadSupportMessages();}
    catch(error){container.textContent='Messages unavailable: '+errText(error);}
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on'))return;
      loadSupportMessages().catch(()=>{});
    },15000);
  }
  async function loadPrivateMessages(publicId){
    const data=await api('GET','/messages/'+encodeURIComponent(publicId));
    const container=document.getElementById('tb');
    if(!container)return;
    container.textContent='';
    for(const m of data.messages||[]){
      const bubble=document.createElement('div');
      bubble.className='bub '+(m.from_me?'me':'th');
      bubble.textContent=m.body;
      container.appendChild(bubble);
    }
    const status=await api('GET','/users/'+encodeURIComponent(publicId)+'/follow');
    canSendPrivate=!!status.mutual;
    const hint=document.createElement('div');
    hint.className='bub th';
    hint.textContent=canSendPrivate?'Both users follow each other. Chat enabled.':
      status.following?'You follow this user. Waiting for them to follow back.':
      'Follow this user to request a private conversation.';
    container.appendChild(hint);
    const followButton=document.createElement('button');
    followButton.type='button';
    followButton.className='btn';
    followButton.textContent=status.following?'Unfollow':'Follow';
    followButton.onclick=async()=>{
      followButton.disabled=true;
      try{
        await api(status.following?'DELETE':'PUT','/users/'+encodeURIComponent(publicId)+'/follow');
        await loadPrivateMessages(publicId);
        window.renderMsg();
      }catch(error){toast('Follow failed: '+errText(error));followButton.disabled=false;}
    };
    container.appendChild(followButton);
    const sendButton=document.getElementById('ts');
    if(sendButton)sendButton.disabled=!canSendPrivate;
    container.scrollTop=container.scrollHeight;
  }
  async function openPrivateThread(publicId,name){
    if(!session){window.showAuth('welcome');return;}
    if(!/^[0-9]{8}$/.test(String(publicId))){toast('Invalid 8-digit user ID');return;}
    activePrivateId=String(publicId);canSendPrivate=false;
    const guardedSend=document.getElementById('ts');if(guardedSend)guardedSend.disabled=true;
    document.getElementById('th')?.classList.add('on');
    document.getElementById('thn').textContent='💬 '+name+' · '+publicId;
    document.getElementById('tb').textContent='Loading conversation…';
    try{await loadPrivateMessages(activePrivateId);}
    catch(error){document.getElementById('tb').textContent=errText(error);}
    if(supportPoll)clearInterval(supportPoll);
    supportPoll=setInterval(()=>{
      if(!session||!document.getElementById('th')?.classList.contains('on'))return;
      loadPrivateMessages(activePrivateId).catch(()=>{});
    },15000);
  }
  window.renderMsg=async function(){
    const view=document.getElementById('ml');
    if(!view)return;
    const demoBadge=document.querySelector('.ni[data-v="msg"] em');
    if(demoBadge)demoBadge.style.display='none';
    if(!session){view.innerHTML='<div class="empty">Sign in to view your conversations.</div>';return;}
    view.innerHTML='<div class="chatrow" id="verified-support-chat">'+
      '<div class="av">🎧</div><div><b>Customer service</b>'+
      '<small>Verified Sharika support conversation</small></div><time>›</time></div>'+
      '<div class="row"><input class="field" id="find-user-id" inputmode="numeric" '+
      'maxlength="8" placeholder="Enter 8-digit user ID" aria-label="Find user by ID">'+
      '<button class="btn" type="button" id="find-user-button">Find</button></div>'+
      '<div id="real-inbox">Loading messages…</div>';
    document.getElementById('verified-support-chat').onclick=openSupportThread;
    const find=async()=>{
      const value=document.getElementById('find-user-id').value.trim();
      if(!/^[0-9]{8}$/.test(value)){toast('Enter an 8-digit user ID');return;}
      try{
        const user=await api('GET','/users/'+encodeURIComponent(value));
        await openPrivateThread(value,user.name);
      }catch(error){toast('User unavailable: '+errText(error));}
    };
    document.getElementById('find-user-button').onclick=find;
    document.getElementById('find-user-id').onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();find();}
    };
    const list=document.getElementById('real-inbox');
    try{
      const [inbox,follows]=await Promise.all([
        api('GET','/messages'),api('GET','/follows')
      ]);
      const following=follows.following||[],followers=follows.followers||[];
      const known=new Set(following.map(f=>f.public_id));
      const conv=inbox.conversations||[];
      const byId=new Set(conv.map(c=>c.public_id));
      const rows=conv.map(c=>'<div class="chatrow" data-private-id="'+safeMessageHTML(c.public_id)+
        '" data-private-name="'+safeMessageHTML(c.name)+'"><div class="av">💬</div><div><b>'+
        safeMessageHTML(c.name)+'</b><small>'+safeMessageHTML(c.last_body||'')+
        '</small></div><time>'+safeMessageHTML(c.public_id)+'</time></div>');
      for(const f of following){
        if(byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">👤</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>'+(f.follows_me?'Mutual follow · Chat ready':
          'Following · Waiting for follow back')+'</small></div><time>'+
          safeMessageHTML(f.public_id)+'</time></div>');
      }
      for(const f of followers){
        if(known.has(f.public_id)||byId.has(f.public_id))continue;
        rows.push('<div class="chatrow" data-private-id="'+safeMessageHTML(f.public_id)+
          '" data-private-name="'+safeMessageHTML(f.name)+'"><div class="av">➕</div><div><b>'+
          safeMessageHTML(f.name)+'</b><small>Follows you · Follow back to chat</small></div><time>'+
          safeMessageHTML(f.public_id)+'</time></div>');
      }
      list.innerHTML=rows.length?rows.join(''):'<div class="empty">No private conversations yet.</div>';
      list.onclick=e=>{
        const row=e.target.closest('.chatrow[data-private-id]');
        if(row)openPrivateThread(row.dataset.privateId,row.dataset.privateName);
      };
    }catch(error){list.textContent='Messages unavailable: '+errText(error);}
  };
  const supportSendButton=document.getElementById('ts');
  const supportInput=document.getElementById('ti');
  async function sendSupportMessage(){
    if(!session){window.showAuth('welcome');return;}
    if(supportBusy)return;
    const body=supportInput?.value?.trim()||'';
    if(!body)return;
    if(body.length>1000){toast('Message is too long');return;}
    supportBusy=true;
    if(supportSendButton)supportSendButton.disabled=true;
    try{
      const request_id='usr:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
      if(activePrivateId){
        if(!canSendPrivate)throw new Error('mutual_follow_required');
        await api('POST','/messages/'+encodeURIComponent(activePrivateId),{body,request_id});
        supportInput.value='';
        await loadPrivateMessages(activePrivateId);
      }else{
        await api('POST','/support/messages',{body,request_id});
        supportInput.value='';
        await loadSupportMessages();
      }
    }catch(error){toast('Message not sent: '+errText(error));}
    finally{supportBusy=false;if(supportSendButton)supportSendButton.disabled=!!activePrivateId&&!canSendPrivate;}
  }
  if(supportSendButton)supportSendButton.onclick=sendSupportMessage;
  if(supportInput)supportInput.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();sendSupportMessage();}
  };
  const supportBackButton=document.getElementById('thb');
  if(supportBackButton)supportBackButton.onclick=()=>{
    document.getElementById('th')?.classList.remove('on');
    if(supportPoll){clearInterval(supportPoll);supportPoll=null;}
    activePrivateId=null;canSendPrivate=false;
    if(supportSendButton)supportSendButton.disabled=false;
    window.renderMsg();
  };
  // The supplied HTML contains a simulated weekly podium. Never display it
  // as real winners while this staging app uses verified server data.
  window.showWeekly=function(done){if(typeof done==='function')done();};
  let rankingRequest=0;
  window.renderRank=async function(){
    const view=document.getElementById('rb');
    if(!view)return;
    const rankView=document.getElementById('v-rank');
    if(rankView&&!document.getElementById('wgb')){
      const weeklyButton=document.createElement('button');
      weeklyButton.id='wgb';
      weeklyButton.textContent='🏆';
      weeklyButton.title='Verified weekly leaders';
      weeklyButton.onclick=()=>window.box();
      rankView.appendChild(weeklyButton);
    }
    const requestNo=++rankingRequest;
    const periods=['daily','weekly','monthly'];
    const kinds={0:'recharge',1:'rich',2:'charm',3:'room'};
    const period=periods[window.rper]||'weekly';
    const kind=kinds[window.rtab];
    view.innerHTML='<div class="empty">Loading verified rankings…</div>';
    if(!kind){
      view.innerHTML='<div class="empty">This ranking has no verified server results yet.</div>';
      return;
    }
    if(!session){
      view.innerHTML='<div class="empty">Sign in to see verified rankings.</div>';
      return;
    }
    try{
      const data=await api('GET','/rankings?period='+period+'&kind='+kind);
      if(requestNo!==rankingRequest)return;
      const leaders=Array.isArray(data.leaders)?data.leaders:[];
      view.textContent='';
      if(!leaders.length){
        view.innerHTML='<div class="empty">No settled gifts recorded in this period yet.</div>';
        return;
      }
      const info=document.createElement('div');
      info.className='empty';
      info.textContent=kind==='recharge'?'Approved recharge coins · verified server ranking':
        kind==='rich'?'Gift coins sent · verified server ranking':
        kind==='charm'?'Gift coins received · verified server ranking':
        'Gift coins sent in each room · verified server ranking';
      view.appendChild(info);
      for(const leader of leaders){
        const row=document.createElement('div');
        row.className='rr'+(leader.public_id&&leader.public_id===profile?.public_id?' me':'');
        row.innerHTML='<b class="n"></b><div class="ra"></div>'+
          '<div class="rn"><b></b><span class="idl"><i class="idb">ID</i>'+
          '<span class="sid"></span></span></div>'+
          '<div class="rv"><i class="cn"></i><span class="amt"></span></div>';
        row.querySelector('.n').textContent=String(leader.rank);
        const avatar=row.querySelector('.ra');
        if(kind==='room')avatar.textContent=leader.emoji||'🎙️';
        else if(leader.pic){
          const img=document.createElement('img');
          img.src=leader.pic;img.alt='';
          img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';
          avatar.appendChild(img);
        }else avatar.textContent='👤';
        row.querySelector('.rn b').textContent=leader.name||'User';
        row.querySelector('.sid').textContent=kind==='room'?leader.room_id:leader.public_id;
        row.querySelector('.amt').textContent=Number(leader.total||0).toLocaleString('en-US');
        view.appendChild(row);
      }
    }catch(error){
      if(requestNo===rankingRequest)view.textContent='Rankings unavailable: '+errText(error);
    }
  };
  // Each uploaded original gets its own compact card. The uploaded HTML layouts are retained, but their local finance logic is
  // removed. A strict source-checked bridge calls only authenticated API routes.
  // Never accept wallet amounts or winner results from child messages.
  const originalGameCards=[
    {id:'sovera-food',name:'Sovera Food Wheel',tag:'🎡 Classic',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/sovera-food-wheel.html'},
    {id:'night-food',name:'Night Food Wheel',tag:'🌙 Night',
      image:'file:///android_asset/food-wheel-original-card.png',
      page:'file:///android_asset/original-games/night-food-wheel.html'},
    {id:'jackpot-fruit',name:'Jackpot Fruit',tag:'🎰 Jackpot',
      image:'file:///android_asset/jackpot-fruit-original-card.png',
      page:'file:///android_asset/original-games/jackpot-fruit.html'}
  ];
  function showGameCard(doc,insideRoom,showToast){
    if(!session){window.showAuth('welcome');return;}
    const sheet=doc.getElementById(insideRoom?'sheet':'sh');
    const overlay=doc.getElementById(insideRoom?'bg':'shb');
    if(!sheet||!overlay){showToast('Game menu unavailable');return;}
    function catalog(){
      sheet.innerHTML='<div class="grab"></div><h3>🎮 Original Games</h3>'+
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'+
        'gap:10px;padding:8px 1px 16px;max-height:70vh;overflow:auto" id="sh-original-grid"></div>'+
        '<p style="font-size:12px;opacity:.8;text-align:center;margin:3px 0">'+
        'Original graphics · live virtual-coin server rounds</p>';
      const grid=sheet.querySelector('#sh-original-grid');
      originalGameCards.forEach(item=>{
        const card=doc.createElement('button');
        card.type='button';
        card.setAttribute('aria-label','View '+item.name);
        card.style.cssText='display:flex;flex-direction:column;align-items:stretch;'+
          'padding:6px;min-width:0;border:1px solid #e9ba50;border-radius:14px;'+
          'background:linear-gradient(150deg,#381760,#130b32);color:#fff;'+
          'box-shadow:0 5px 12px #0006;text-align:left;cursor:pointer';
        const img=doc.createElement('img');
        img.src=item.image;
        img.alt=item.name;
        img.style.cssText='width:100%;aspect-ratio:3/2;object-fit:cover;'+
          'border-radius:10px;display:block';
        if(item.id==='night-food')img.style.filter='hue-rotate(24deg) brightness(.72)';
        const title=doc.createElement('b');
        title.textContent=item.name;
        title.style.cssText='font-size:13px;line-height:1.3;padding:7px 2px 1px';
        const tag=doc.createElement('span');
        tag.textContent=item.tag;
        tag.style.cssText='color:#fbbf24;font-size:11px;padding:0 2px 4px';
        card.append(img,title,tag);
        card.onclick=()=>preview(item);
        grid.appendChild(card);
      });
    }
    let currentGameFrame=null;
    const view=doc.defaultView||window;
    function preview(item){
      currentGameFrame=null;
      sheet.innerHTML='<div class="grab"></div>'+
        '<button id="sh-original-back" type="button" '+
        'style="padding:8px 14px;border:1px solid #d4af37;border-radius:10px;'+
        'background:#351164;color:#fff">← All games</button>'+
        '<h3 style="margin:8px 0"></h3>'+
        '<div id="sh-original-host" style="width:100%;height:min(74vh,750px);'+
        'min-height:380px;border:1px solid #a56dff;border-radius:12px;'+
        'overflow:hidden;background:#100424"></div>';
      sheet.querySelector('h3').textContent=item.name;
      sheet.querySelector('#sh-original-back').onclick=()=>{currentGameFrame=null;catalog()};
      const gameFrame=doc.createElement('iframe');
      gameFrame.src=item.page;
      gameFrame.setAttribute('title',item.name);
      gameFrame.style.cssText='width:100%;height:100%;border:0;display:block';
      gameFrame.setAttribute('referrerpolicy','no-referrer');
      sheet.querySelector('#sh-original-host').appendChild(gameFrame);
      currentGameFrame={element:gameFrame,item};
    }
    // Child frame has no Firebase session, no native bridge, no wallet setter.
    // Only the active exact iframe can request one of these fixed operations.
    view.addEventListener('message',async function onOriginalGameMessage(event){
      const current=currentGameFrame;
      if(!current||event.source!==current.element.contentWindow||!session)return;
      const data=event.data;
      if(!data||typeof data!=='object')return;
      if(data.type==='sharika:original-exit'){currentGameFrame=null;catalog();return;}
      if(data.type!=='sharika:original-request')return;
      const permitted=['state','history','stats','rankings','bet'];
      if(data.game!==current.item.id||!permitted.includes(data.action)||
         !Number.isSafeInteger(data.id)||data.id<1)return;
      const method=data.action==='bet'?'POST':'GET';
      if(data.method!==method)return;
      const target=current.element.contentWindow;
      if(!target)return;
      try{
        const result=await api(method,'/original-games/'+current.item.id+'/'+data.action,
          data.action==='bet'?data.body:undefined);
        // If the user changed games mid-request, do not send any data to it.
        if(!session||currentGameFrame!==current)return;
        target.postMessage({type:'sharika:original-response',id:data.id,ok:true,value:result},'*');
        if(data.action==='bet')reloadWallet().catch(()=>{});
      }catch(error){
        if(!session||currentGameFrame!==current)return;
        target.postMessage({type:'sharika:original-response',id:data.id,ok:false,error:errText(error)},'*');
      }
    });
    catalog();
    overlay.classList.add('on');
  }
  const gamesShortcut=document.getElementById('qg');
  if(gamesShortcut)gamesShortcut.onclick=()=>showGameCard(document,false,toast);
  // The original reward button used a fake #128 rank and local coin credit.
  // Show verified weekly leaders instead; no claim or coin-grant control.
  window.box=function() {
    if(!session){window.showAuth('welcome');return;}
    window.openSheet('<h3>🏆 Verified Weekly Leaders</h3>'+
      '<div class="empty">Results are based on completed server records, not demo users.</div>'+
      '<div id="sh-week-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0"></div>'+
      '<div id="sh-week-list" aria-live="polite"></div>'+
      '<p style="font-size:12px;opacity:.75;text-align:center;margin:14px 3px">'+
      'Weekly coin rewards and Couple ranking are not enabled yet.</p>');
    const tabs=document.getElementById('sh-week-tabs');
    const list=document.getElementById('sh-week-list');
    if(!tabs||!list)return;
    const options=[
      {kind:'recharge',title:'Top Recharge'},
      {kind:'charm',title:'Top Gift'},
      {kind:'room',title:'Top Room'}
    ];
    let requestNo=0;
    const buttons=new Map();
    async function select(kind) {
      const selected=++requestNo;
      for(const [key,button] of buttons)
        button.style.opacity=key===kind?'1':'.55';
      list.textContent='Loading verified results…';
      try {
        const data=await api('GET','/rankings?period=weekly&kind='+kind);
        if(requestNo!==selected||!list.isConnected||!session)return;
        list.textContent='';
        const leaders=Array.isArray(data.leaders)?data.leaders.slice(0,10):[];
        if(!leaders.length){
          list.textContent='No verified results for this week yet.';
          return;
        }
        for(const item of leaders) {
          const row=document.createElement('div');
          row.className='wrw';
          const place=document.createElement('span');
          place.className='m';
          place.textContent=['🥇','🥈','🥉'][item.rank-1]||'🏅';
          const title=document.createElement('b');
          title.textContent='#'+item.rank+' '+(item.name||'User')+
            ' · ID '+(kind==='room'?item.room_id:item.public_id);
          const amount=document.createElement('em');
          amount.textContent='🪙 '+Number(item.total||0).toLocaleString('en-US');
          row.append(place,title,amount);
          list.appendChild(row);
        }
      }catch(error){
        if(requestNo===selected&&list.isConnected)
          list.textContent='Unable to load verified rankings: '+errText(error);
      }
    }
    for(const option of options){
      const button=document.createElement('button');
      button.type='button';
      button.textContent=option.title;
      button.style.cssText='padding:9px 10px;border-radius:12px;'+
        'border:1px solid #d4af37;background:#351164;color:#fff;font-weight:700';
      button.onclick=()=>select(option.kind);
      tabs.appendChild(button);
      buttons.set(option.kind,button);
    }
    select('recharge');
  };
  const originalLogout=window.logout;
  window.logout=function(){
    if(window.cur)window.leaveRoom();
    if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
    session=null;profile=null;balance={coins:0,dia:0,xp:0};
    native('signOut').catch(()=>{});
    cleanLocalFakeState();
    originalLogout();
  };
  window.SharikaServer={api,reloadWallet,reloadRooms,connected:()=>!!session,voiceProvider:()=>voiceBackend};

  async function restore(){
    cleanLocalFakeState();
    try{
      const account=await native('session');
      if(!account.signedIn || !account.emailVerified) {
        window.showAuth('welcome');
        if(account.signedIn)toast('Verify your email, then sign in');
        return;
      }
      const local=await authenticated(account);
      window.A=Object.assign({
        name:'Me',pic:null,myRoom:null,claim:{d:'',streak:0},
        st:{},sw:{},rw:{},fol:[]
      },local.p);
      if(typeof window.fixA==='function')window.fixA();
      try{localStorage.setItem('vr_sess',local.key);}catch(_){}
      window.saveA();
      window.hideAuth();
      window.refresh();
      window.renderRooms();
      window.go('home');
    }catch(error){
      window.showAuth('welcome');
      toast('Sign-in needed: '+errText(error));
    }
  }
  restore();
})();
