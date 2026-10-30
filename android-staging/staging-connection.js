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
  let busyRooms = false, framePoll = null, giftPoll = null;
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
  async function connectVoice(roomId) {
    const config=await api('GET','/rooms/'+roomId+'/voice/config');
    await disconnectVoice();
    if(config.provider==='cloudflare_sfu') {
      voiceBackend='cloudflare_sfu';
      return connectSfu(roomId,!!config.publish);
    }
    if(config.provider!=='livekit')throw new Error('Voice provider unavailable');
    // Keep the isolated LiveKit fallback only when explicitly configured.
    const info=await api('POST','/rooms/'+roomId+'/voice-token',{});
    const sdk=await voiceSdk();
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
    await room.connect(info.url,info.token);
    voiceRoom=room;voiceRoomId=roomId;
    try{await room.startAudio();}catch(_){}
    if(info.publish)await room.localParticipant.setMicrophoneEnabled(true);
    return {publishing:!!info.publish};
  }
  async function toggleVoice() {
    if(sfuState) {
      const track=sfuState.media?.getAudioTracks()[0];
      if(!track)throw new Error('Take an available mic seat first');
      track.enabled=!track.enabled;
      return track.enabled;
    }
    if(!voiceRoom || !voiceRoomId)throw new Error('Voice connection is not available');
    const currently=voiceRoom.localParticipant.isMicrophoneEnabled;
    await voiceRoom.localParticipant.setMicrophoneEnabled(!currently);
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
        '<div id="stage-profile-error" style="color:#ffb4b4;font-size:13px"></div>' +
        '<button type="submit" style="width:100%;padding:15px;border:0;border-radius:14px;background:#8e72f6;color:#fff;font-weight:700">Create staging profile</button>' +
        '<button type="button" id="stage-profile-cancel" style="width:100%;padding:13px;border:0;background:transparent;color:#ddd">Cancel</button></form>';
      document.body.appendChild(layer);
      const name = layer.querySelector('[name="name"]');
      name.value = account.displayName || '';
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
            country:form.elements.country.value.trim()
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
        const saved = await api('POST','/me',{
          name:cached.name, birthdate:cached.dob, country:cached.country || ''
        });
        try { localStorage.removeItem(META_KEY); } catch (_) {}
        return saved;
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

  window.API.signup = async function (form) {
    if (!form.key || !form.key.includes('@'))
      return { ok:false, msg:'Use an email address. Phone OTP is not enabled yet.' };
    if (String(form.pw || '').length < 12)
      return { ok:false, msg:'Use at least 12 characters for your password.' };
    try {
      const result = await native('emailSignUp', {email:form.key.trim(), password:form.pw});
      try {
        localStorage.setItem(META_KEY, JSON.stringify({
          email:form.key.trim(), name:form.name, dob:form.dob, country:form.country
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
        id:r.id,name:r.name,emoji:r.emoji || '🎙️',n:0,host:'Room owner',
        tag:'Voice Room',mics:[],c:COLORS[i%COLORS.length],
        th:r.theme || 'mid',owner_id:r.owner_id,seat_count:r.seat_count
      }));
      window.A.myRoom = own ? {
        id:own.id,name:own.name,emoji:own.emoji,th:own.theme,
        c:COLORS[0],owner_id:own.owner_id,seat_count:own.seat_count
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
    const slots = Array.from({length: Math.max(2,Number(room.seat_count||12)+1)},
      (_,i)=>({empty:1,i}));
    slots[0]={n:owner.name,e:'👑',i:0,user_id:room.owner_id,public_id:room.id,muted:false,talk:false};
    const audience=[];
    for(const member of data.members || []) {
      const user=member.sharika_users;
      if(!user || member.user_id===room.owner_id) continue;
      if(Number.isInteger(member.seat_no) && member.seat_no>0 && member.seat_no<slots.length)
        slots[member.seat_no]={
          n:user.name,e:'👤',i:member.seat_no,user_id:member.user_id,public_id:user.public_id,
          muted:!!member.muted,talk:false
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
    frame.__luckyOff=true;
    let availableGiftIds=[];
    let giftBusy=false;
    let lastGiftEventId=null;
    // Load only the real gift catalog approved in D1 by the admin panel.
    // Keep the existing original Sharika gift box and its original artwork.
    const giftButton=frame.$ && frame.$('bGift');
    const originalGiftOpen=giftButton && giftButton.onclick;
    if(giftButton)giftButton.onclick=async ()=>{
      try{
        const data=await api('GET','/gifts');
        const gifts=(data.gifts||[]).filter(g=>g.tab===0||g.tab===1);
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
        frame.gtab=gifts.some(g=>g.tab===0)?0:1;
        frame.gsel=Math.max(0,gifts.findIndex(g=>g.tab===frame.gtab));
        frame.G=gifts.map(g=>[htmlSafe(g.emoji||'🎁'),Number(g.price_coins),
          htmlSafe(g.name),Number(g.tab),imageSafe(g.image_url)]);
        if(typeof originalGiftOpen==='function')originalGiftOpen.call(giftButton);
        else frame.toast('Gift box unavailable');
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
      for(const event of events){
        if(event.id<=lastGiftEventId||event.sender_id===profile?.public_id)continue;
        const seat=(frame.seats||[]).find(s=>s?.public_id===event.recipient_id);
        if(seat && typeof frame.fly==='function')
          frame.fly(event.emoji,seat.i,0,event.price_coins);
      }
      lastGiftEventId=Math.max(lastGiftEventId,latest);
    }
    frame.act=async function(action,seat) {
      try {
        if(action==='take' && seat>0) {
          await api('PUT','/rooms/'+room.id+'/seat',{seat_no:seat});
          frame.close(); await syncFrame(room,frame);
          const state=await connectVoice(room.id);
          frame.toast(state.publishing?'Microphone enabled':'Listening to room');
        } else if(action==='down') {
          await api('PUT','/rooms/'+room.id+'/seat',{seat_no:null});
          frame.close(); await syncFrame(room,frame);
          await connectVoice(room.id);
          frame.toast('Seat released; listening only');
        } else frame.toast('Moderation requires verified server permissions');
      } catch (error) { frame.toast(errText(error)); }
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
        const data=await api('PATCH','/rooms/'+room.id,{name,seat_count:newSeatCount});
        room.name=data.room.name;
        room.seat_count=data.room.seat_count;
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
    const mic=frame.$ && frame.$('mic');
    if(mic) mic.onclick=async ()=>{
      try {
        const enabled=await toggleVoice();
        mic.textContent=enabled?'🎤':'🔇';
        mic.classList.toggle('off',!enabled);
        frame.toast(enabled?'Microphone enabled':'Microphone muted');
      } catch(error) {frame.toast(errText(error));}
    };
    const pendingRoomButtons = {
      bMsg:'Private messaging is not on the staging server yet',
      bOwn:'Owner moderation is not on the staging server yet',
    };
    for (const [buttonId, reason] of Object.entries(pendingRoomButtons)) {
      const control = frame.$ && frame.$(buttonId);
      if (control) control.onclick=()=>frame.toast(reason);
    }
    const roomGameButton=frame.$ && frame.$('bGame');
    if(roomGameButton)roomGameButton.onclick=()=>showGameCard(frame.document,true,frame.toast);
    const rewards=frame.$ && frame.$('rrpill');
    if(rewards) rewards.onclick=()=>frame.toast('Weekly room rewards are not available yet');
    await syncFrame(room,frame);
    try {
      const voice=await connectVoice(room.id);
      frame.toast(voice.publishing?'Voice connected, microphone on':'Listening to room');
    } catch(error) {
      frame.toast('Voice pending: '+errText(error));
    }
    if(framePoll) clearInterval(framePoll);
    framePoll=setInterval(()=>{if(window.cur?.id===room.id)syncFrame(room,frame).catch(()=>{});},15000);
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
  }
  const originalOpenRoom=window.openRoom;
  window.openRoom=async function(room) {
    if(!session){ window.showAuth('welcome'); return; }
    try {
      await api('POST','/rooms/'+room.id+'/join',{});
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
    disconnectVoice().catch(()=>{});
    if(current && session)api('POST','/rooms/'+current.id+'/leave',{}).catch(()=>{});
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
  // Financial writes stay locked except verified exchange and support requests.
  document.addEventListener('click', async event => {
    const button=event.target.closest('button');
    if(!button) return;
    const id=button.id;
    if(!['cl','pc','ec','cm','rcs','rcl2'].includes(id)) return;
    if(id==='ec' && !document.querySelector('#sh h3')?.textContent?.includes('Exchange')) return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!session){window.showAuth('welcome');return;}
    if(id==='cl'){toast('Daily rewards require verified server-side claim tracking');return;}
    if(id==='rcl2'){toast('No verified coin sellers have been approved yet');return;}
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
    const requestNo=++rankingRequest;
    const periods=['daily','weekly','monthly'];
    const kinds={1:'rich',2:'charm',3:'room'};
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
      info.textContent=kind==='rich'?'Gift coins sent · verified server ranking':
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
  // Food Wheel is a real packaged game-selection card, not playable betting.
  // It uses the exact user-supplied artwork and preserves both original sheets.
  let gameViewTimer=null;
  const announcedGameResults=new Set();
  function showGameCard(doc,insideRoom,showToast){
    if(!session){window.showAuth('welcome');return;}
    if(gameViewTimer){clearInterval(gameViewTimer);gameViewTimer=null;}
    const sheet=doc.getElementById(insideRoom?'sheet':'sh');
    const overlay=doc.getElementById(insideRoom?'bg':'shb');
    if(!sheet||!overlay){showToast('Game menu unavailable');return;}
    sheet.innerHTML='<div class="grab"></div><h3>🎮 Games</h3>'+
      '<div style="max-height:72vh;overflow-y:auto;padding-bottom:16px">'+
      '<button id="sharika-food-wheel-card" type="button" aria-label="Open Food Wheel" '+
      'style="display:block;width:100%;padding:0;border:0;background:transparent;cursor:pointer">'+
      '<img src="file:///android_asset/food-wheel-card.jpg" alt="Food Wheel game" '+
      'style="display:block;width:100%;height:auto;border-radius:16px"></button>'+
      '<button id="sharika-jackpot-card" type="button" '+
      'style="width:100%;margin-top:12px;padding:16px;border:2px solid #fbbf24;'+
      'border-radius:16px;background:linear-gradient(110deg,#310061,#8f006c,#ff7600);'+
      'color:#fff;font-size:19px;font-weight:bold">🍒 🍋 🍇  JACKPOT FRUIT  🍉 🍓 🍊</button>'+
      '<div id="sharika-game-stage" style="padding-top:10px"></div></div>';
    overlay.classList.add('on');
    const stage=sheet.querySelector('#sharika-game-stage');
    let active=null,gameState=null,chosen=0,refreshing=false,submitting=false;
    let seenVisualResult='',wheelRotation=0;
    function display(state){
      gameState=state;
      const resultEl=stage.querySelector('#sg-result');
      const statusEl=stage.querySelector('#sg-status');
      const coinsEl=stage.querySelector('#sg-coins');
      const submit=stage.querySelector('#sg-bet');
      if(!statusEl||!submit)return;
      const seconds=Math.max(0,Math.ceil(((state.phase==='betting'
        ?state.round.bet_closes_ms:state.round.closes_ms)-state.server_time)/1000));
      statusEl.textContent=(state.phase==='betting'?'Betting open':'Waiting for result')+
        ' · '+seconds+'s · Round '+state.round.round_no;
      coinsEl.textContent=Number(state.coins||0).toLocaleString('en-US');
      const bet=state.my_bet;
      submit.disabled=state.phase!=='betting'||!!bet||submitting;
      submit.textContent=bet?'Bet placed ✓':'Place server-verified bet';
      let result='All players share the same server result.';
      if(state.previous_result){
        const p=state.previous_result,out=p.outcome;
        result=active==='food-wheel'?'Previous: '+out.symbol+' · sector '+(out.sector+1):
          'Previous: '+out.reels.join(' ')+' · '+(out.jackpot?'JACKPOT':'No jackpot');
        const mine=state.previous_bet;
        if(mine)result+=' · Your payout: '+Number(mine.payout||0).toLocaleString('en-US')+' coins';
      }
      if(bet)result+=' · Your current bet: '+Number(bet.stake).toLocaleString('en-US')+' coins';
      resultEl.textContent=result;
      // Reveal only the confirmed server outcome. Never fabricate winners.
      const previous=state.previous_result;
      if(previous){
        const revealKey=active+':'+previous.round_no;
        if(revealKey!==seenVisualResult){
          seenVisualResult=revealKey;
          if(active==='food-wheel'){
            const wheel=stage.querySelector('#sg-wheel-rotor');
            if(wheel && Number.isInteger(previous.outcome?.sector)){
              const target=340-previous.outcome.sector*40;
              const extra=(target-(wheelRotation%360)+360)%360;
              wheelRotation+=1800+extra;
              wheel.style.transition='transform 2600ms cubic-bezier(.12,.8,.12,1)';
              wheel.style.transform='rotate('+wheelRotation+'deg)';
            }
          }else{
            const reels=stage.querySelectorAll('#sg-fruit-reels .sg-reel');
            const results=previous.outcome?.reels||[];
            reels.forEach((reel,i)=>{
              reel.textContent=results[i]||'❔';
              reel.style.animation='none';
              void reel.offsetWidth;
              reel.style.animation='sg-reveal .7s ease-out both';
              reel.style.animationDelay=(i*180)+'ms';
            });
          }
        }
      }
    }
    async function refresh(){
      if(refreshing||!active)return;
      if(!overlay.classList.contains('on')){if(gameViewTimer)clearInterval(gameViewTimer);gameViewTimer=null;return;}
      refreshing=true;
      try{
        const requestedGame=active;
        const data=await api('GET','/games/'+requestedGame+'/state');
        if(!overlay.classList.contains('on')||requestedGame!==active)return;
        display(data);
        const settled=data.previous_bet;
        if(settled?.status==='settled'){
          const proofKey=requestedGame+':'+settled.id;
          if(!announcedGameResults.has(proofKey)){
            announcedGameResults.add(proofKey);
            await reloadWallet();
            if(settled.payout>0){
              showToast('Verified win: '+Number(settled.payout).toLocaleString('en-US')+' coins');
              if(window.SharikaWinBanner?.show){
                window.SharikaWinBanner.show({name:profile?.name||'Player',
                  game:requestedGame==='food-wheel'?'Food Wheel':'Jackpot Fruit',
                  amount:settled.payout});
              }
            }
          }
        }
      }catch(error){
        const status=stage.querySelector('#sg-status');
        if(status)status.textContent='Game server: '+errText(error);
      }finally{refreshing=false;}
    }
    function openGame(game){
      active=game;chosen=0;gameState=null;seenVisualResult='';wheelRotation=0;
      const names=game==='food-wheel'
        ?['🍅','🦐','🐟','🍗','🥩','🍕','🥬','🥕','🌽']:[];
      const wheelVisual=names.length
        ?'<div style="position:relative;width:238px;height:238px;margin:16px auto 20px">'+
          '<div id="sg-wheel-rotor" style="position:relative;width:100%;height:100%;box-sizing:border-box;'+
            'border:9px solid #ffca36;border-radius:50%;box-shadow:0 0 0 4px #8d4c0e,0 0 24px #fbbf2488;'+
            'background:conic-gradient(#16a34a 0 40deg,#2563eb 40deg 80deg,#ce2665 80deg 120deg,'+
            '#854dff 120deg 160deg,#f97316 160deg 200deg,#eab308 200deg 240deg,'+
            '#15803d 240deg 280deg,#0891b2 280deg 320deg,#7c3aed 320deg 360deg)">'+
            names.map((symbol,i)=>'<span style="position:absolute;left:50%;top:50%;font-size:26px;'+
              'transform:translate(-50%,-50%) rotate('+(i*40+20)+'deg) translateY(-78px) '+
              'rotate(-'+(i*40+20)+'deg)">'+symbol+'</span>').join('')+
            '<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'+
              'border:4px solid #fcd34d;border-radius:50%;background:#5b21b6;'+
              'padding:6px;font-size:22px">⭐</span></div>'+
            '<div aria-label="Winning pointer" style="position:absolute;left:calc(50% - 13px);top:-15px;'+
              'width:0;height:0;border-left:13px solid transparent;border-right:13px solid transparent;'+
              'border-top:26px solid #fbbf24;filter:drop-shadow(0 2px 2px #281124)"></div></div>'
        :'<style>@keyframes sg-reveal{0%{transform:translateY(-24px) scale(.7);opacity:.35}'+
          '75%{transform:translateY(5px) scale(1.1);opacity:1}100%{transform:none;opacity:1}}</style>'+
          '<div id="sg-fruit-reels" style="display:flex;justify-content:center;gap:10px;margin:16px auto">'+
          '<span class="sg-reel" style="font-size:48px;background:#451c7a;border:3px solid #fbbf24;'+
          'border-radius:15px;padding:8px">❔</span>'+
          '<span class="sg-reel" style="font-size:48px;background:#451c7a;border:3px solid #fbbf24;'+
          'border-radius:15px;padding:8px">❔</span>'+
          '<span class="sg-reel" style="font-size:48px;background:#451c7a;border:3px solid #fbbf24;'+
          'border-radius:15px;padding:8px">❔</span></div>';
      stage.innerHTML='<h3 style="margin:12px 0">'+
        (game==='food-wheel'?'🎡 Food Wheel':'🎰 Jackpot Fruit')+'</h3>'+
        wheelVisual+
        '<div class="empty" id="sg-status">Connecting to server…</div>'+
        (names.length?'<div id="sg-choices" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">'+
          names.map((name,index)=>'<button type="button" data-game-pick="'+index+
            '" style="padding:9px 0;background:#32105a;border:2px solid #7253aa;'+
            'border-radius:12px;font-size:24px">'+name+'</button>').join('')+'</div>':
          '<div style="font-size:36px;text-align:center;margin:14px">🍒 🍋 🍇</div>')+
        '<div class="empty" style="padding:8px">'+
        (game==='food-wheel'?'9 equal sectors · correct pick pays 9×':
         '3 matching fruits pay 36× · otherwise zero')+
        ' · One bet per round · virtual coins only</div>'+
        '<div style="display:flex;gap:8px;align-items:center;margin:10px 0">'+
        '<input id="sg-stake" type="number" min="1" step="1" value="100" '+
        'placeholder="Coins" style="min-width:0;flex:1;padding:10px;border-radius:10px">'+
        '<span style="font-size:12px">Balance: <b id="sg-coins">—</b></span></div>'+
        '<button id="sg-bet" class="btn" type="button" disabled '+
        'style="width:100%;padding:12px;border-radius:12px">Connecting…</button>'+
        '<div class="empty" id="sg-result" style="padding:12px 4px"></div>';
      const choices=stage.querySelector('#sg-choices');
      if(choices){
        function paint(){choices.querySelectorAll('button').forEach((b,i)=>{
          b.style.borderColor=i===chosen?'#fbbf24':'#7253aa';
          b.style.background=i===chosen?'#7e22ce':'#32105a';
        });}
        choices.onclick=e=>{const button=e.target.closest('button[data-game-pick]');
          if(button){chosen=Number(button.dataset.gamePick);paint();}};
        paint();
      }
      const betButton=stage.querySelector('#sg-bet');
      betButton.onclick=async()=>{
        if(submitting||!gameState||gameState.phase!=='betting'||gameState.my_bet)return;
        const raw=stage.querySelector('#sg-stake')?.value||'';
        const stake=Number(raw);
        if(!Number.isSafeInteger(stake)||stake<1||stake>Number(gameState.coins)){
          showToast('Enter a whole-coin bet within your wallet balance');return;
        }
        submitting=true;betButton.disabled=true;
        try{
          const request_id='game:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
          const body={round_no:gameState.round.round_no,stake,request_id};
          if(active==='food-wheel')body.pick=chosen;
          const accepted=await api('POST','/games/'+active+'/bet',body);
          if(gameState)gameState.my_bet=accepted.bet;
          showToast('Bet accepted and coins debited by server');
          await reloadWallet();
          await refresh();
        }catch(error){showToast('Bet not placed: '+errText(error));}
        finally{submitting=false;if(gameState)display(gameState);}
      };
      if(gameViewTimer)clearInterval(gameViewTimer);
      refresh();
      gameViewTimer=setInterval(refresh,1600);
      stage.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
    sheet.querySelector('#sharika-food-wheel-card')?.addEventListener('click',()=>openGame('food-wheel'));
    sheet.querySelector('#sharika-jackpot-card')?.addEventListener('click',()=>openGame('jackpot-fruit'));
  }
  const gamesShortcut=document.getElementById('qg');
  if(gamesShortcut)gamesShortcut.onclick=()=>showGameCard(document,false,toast);
  window.box=function() {
    window.openSheet('<h3>🏆 Weekly rewards</h3><div class="empty">Rewards are not enabled on the staging server.</div>');
  };
  const originalLogout=window.logout;
  window.logout=function(){
    if(window.cur)window.leaveRoom();
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
