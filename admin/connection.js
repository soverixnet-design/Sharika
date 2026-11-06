/* Sharika Cloudflare D1 staging admin connector.
 * Preserves the supplied 3D admin layout. Firebase verifies identity;
 * Cloudflare D1 checks the explicit admin role on EVERY request.
 * Only verified Super Admin user-status and gift catalog edits are enabled.
 * No money, betting, or live voice modifications.
 */
(function () {
  'use strict';
  const API = window.location.origin;
  const FIREBASE_KEY = "AIzaSyAuKw-SVccI_bN4GSC6tOEC1yUm6lkBxQA";
  const SESSION_KEY = 'sharika_admin_firebase_staging_v1';
  const FIREBASE_PROJECT='sharika-voice-chat-app';
  const STAFF_SCOPES={
    view_users:'View users',view_rooms:'View rooms',
    view_sellers:'View seller records',view_ledger:'View wallet ledger',
    support_reply:'Support inbox and reply',coin_recharge:'Credit user coins'
  };
  const NAV_ALL=(window.NAV||[]).slice();
  if(!NAV_ALL.some(item=>item[0]==='cosmetics')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='gifts');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['cosmetics','✨','Frames, Entry & Name Tags']);
  }
  if(!NAV_ALL.some(item=>item[0]==='luckyBox')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='lucky');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['luckyBox','🎁','Free Lucky Box · 2 Hours']);
  }
  if(!NAV_ALL.some(item=>item[0]==='premium')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='cosmetics');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['premium','👑','VIP / SVIP / Noble']);
  }
  if(!NAV_ALL.some(item=>item[0]==='bonds')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='premium');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['bonds','💞','CP Ranking, Rewards & Gifts']);
  }
  if(!NAV_ALL.some(item=>item[0]==='specialIds')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='premium');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['specialIds','💎','Special IDs']);
  }
  if(!NAV_ALL.some(item=>item[0]==='opening')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='rank');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['opening','🏆','7 Day Opening Screen']);
  }
  if(!NAV_ALL.some(item=>item[0]==='profileDesigner')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='specialIds');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['profileDesigner','🖼️','Live Profile Designer']);
  }
  // Retire the Family navigation without deleting any historic Family data.
  const historicFamilyIndex=NAV_ALL.findIndex(item=>item[0]==='family');
  if(historicFamilyIndex>=0)NAV_ALL.splice(historicFamilyIndex,1);
  if(!NAV_ALL.some(item=>item[0]==='agency')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='events');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['agency','👑','BD · Agency · Host']);
  }
  if(!NAV_ALL.some(item=>item[0]==='musicLibrary')){
    const idx=NAV_ALL.findIndex(item=>item[0]==='rooms');
    NAV_ALL.splice(idx<0?NAV_ALL.length:idx+1,0,
      ['musicLibrary','🎵','Room Music Library']);
  }
  const allowedStaffPage={
    dash:null,users:'view_users',rooms:'view_rooms',sellers:'view_sellers',
    ledger:'view_ledger',support:'support_reply',rech:'coin_recharge'
  };
  let pendingAdminCredit=null;
  let session = null;
  let role = null;
  let identity = null;
  const byId = id => document.getElementById(id);
  const esc = input => String(input == null ? '' : input).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const card = (title, body) => '<div class="card"><h3>'+esc(title)+'</h3><p class="n">'+esc(body)+'</p></div>';
  function note(message) { if (window.toast) window.toast(message); }
  function save(next) {
    session = next;
    if (next) sessionStorage.setItem(SESSION_KEY,JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  }
  try {
    const cached = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (cached && cached.idToken && cached.refreshToken) session = cached;
  } catch (_) { save(null); }
  async function firebase(path, body, form) {
    const response = await fetch('https://'+(form ? 'securetoken' : 'identitytoolkit')+
      '.googleapis.com/v1/'+path+'?key='+encodeURIComponent(FIREBASE_KEY), {
        method:'POST', headers:{'content-type':form ? 'application/x-www-form-urlencoded' : 'application/json'},
        body:form ? new URLSearchParams(body).toString() : JSON.stringify(body)
      });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error?.message || 'Firebase sign-in unavailable');
    return data;
  }
  async function idToken() {
    if (!session) throw new Error('Sign in first');
    if (session.expiresAt > Date.now() + 90_000) return session.idToken;
    const data = await firebase('token', {grant_type:'refresh_token',
      refresh_token:session.refreshToken}, true);
    save({ idToken:data.id_token,refreshToken:data.refresh_token,
      expiresAt:Date.now()+Math.max(300,Number(data.expires_in || 3600))*1000,
      email:session.email });
    return session.idToken;
  }
  async function api(method, path, body) {
    const jwt = await idToken();
    const response = await fetch(API+'/api/v1/admin/'+path,{
      method, headers:{authorization:'Bearer '+jwt,accept:'application/json',
        ...(body === undefined ? {} : {'content-type':'application/json'})},
      body:body === undefined ? undefined : JSON.stringify(body),
      cache:'no-store'
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'Admin service unavailable');
    return data;
  }
  function mediaStudio(prefix){
    return '<div class="card"><h3>🎬 Media Studio · Video, Frame, Entry & Sound</h3>'+
      '<p class="n">Upload your own licensed MP4/WebM video, PNG/JPEG/WebP image or MP3/M4A/OGG sound (25 MB maximum). '+
      'Choose an optional destination or copy the HTTPS link into any catalogue item. '+
      'Videos may contain their own music.</p>'+
      '<div class="row"><input class="field" type="file" id="'+prefix+'-file" '+
      'accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg">'+
      '<select class="field" id="'+prefix+'-target" aria-label="Apply uploaded media to"></select>'+
      '<button type="button" class="btn s" id="'+prefix+'-upload">Upload Media</button></div>'+
      '<div id="'+prefix+'-preview" style="margin:10px 0;max-width:350px"></div>'+
      '<label>Uploaded HTTPS media URL<input class="field" id="'+prefix+'-result" '+
      'readonly aria-label="Uploaded media URL"></label>'+
      '<button class="btn s" type="button" id="'+prefix+'-copy">Copy URL</button>'+
      '<p class="n" id="'+prefix+'-status" role="status"></p></div>';
  }
  function wireMediaStudio(prefix,targets){
    const file=byId(prefix+'-file'),preview=byId(prefix+'-preview');
    const select=byId(prefix+'-target'),result=byId(prefix+'-result');
    const status=byId(prefix+'-status'),button=byId(prefix+'-upload');
    if(!file)return;
    select.innerHTML='<option value="">Copy link only</option>'+targets.map(([id,label])=>
      '<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
    let localUrl='';
    file.onchange=()=>{
      if(localUrl)URL.revokeObjectURL(localUrl);
      preview.replaceChildren();status.textContent='';
      const item=file.files?.[0];if(!item)return;
      localUrl=URL.createObjectURL(item);
      const kind=item.type.split('/')[0];
      const player=document.createElement(kind==='image'?'img':kind==='audio'?'audio':'video');
      player.src=localUrl;player.style.maxWidth='100%';
      if(kind==='image')player.alt='Media preview';
      else{player.controls=true;player.preload='metadata';if(kind==='video')player.playsInline=true;}
      preview.appendChild(player);
      status.textContent=item.name+' · '+(item.size/1024/1024).toFixed(2)+' MB';
    };
    button.onclick=async()=>{
      const item=file.files?.[0],category=item?.type?.split('/')[0];
      if(!item||!['image','video','audio'].includes(category)||item.size>25*1024*1024){
        status.textContent='Choose a supported media file under 25 MB.';return;
      }
      button.disabled=true;status.textContent='Uploading media securely…';
      try{
        const jwt=await idToken();
        const response=await fetch(API+'/api/v1/admin/media/upload',{
          method:'POST',headers:{authorization:'Bearer '+jwt,
            'content-type':item.type,'x-sharika-media-category':category,
            'x-sharika-media-size':String(item.size)},
          body:item,cache:'no-store'
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Upload unavailable');
        result.value=data.url;
        const destination=byId(select.value);
        if(destination){destination.value=data.url;destination.dispatchEvent(new Event('change'));}
        status.textContent='Uploaded ✓ '+(destination?'URL applied to the selected form; save the item next.':'Copy the URL into an item and save.');
      }catch(error){status.textContent='Upload failed: '+error.message;}
      finally{button.disabled=false;}
    };
    byId(prefix+'-copy').onclick=async()=>{
      if(!result.value)return;
      try{await navigator.clipboard.writeText(result.value);status.textContent='URL copied ✓';}
      catch(_){result.focus();result.select();status.textContent='Select and copy the URL.';}
    };
  }
  async function verifyAdmin() {
    const status = await api('GET','status');
    if (!['super','support','finance','staff'].includes(status.role))
      throw new Error('Admin role not assigned');
    role = status.role;
    identity = status;
    window.NAV=role==='staff'?NAV_ALL.filter(item=>
      !item[0]||Object.prototype.hasOwnProperty.call(allowedStaffPage,item[0])&&
      (!allowedStaffPage[item[0]]||status.permissions?.includes(allowedStaffPage[item[0]]))
    ):(role==='super'?NAV_ALL.slice():NAV_ALL.filter(item=>
      !['specialIds','musicLibrary'].includes(item[0])&&
      (role==='finance'||item[0]!=='family')));
    window.ME = session.email || status.name || 'Administrator';
    return status;
  }

  // Direct Google Identity Services token flow avoids the Firebase popup helper.
  // The returned OAuth access token is exchanged immediately for a Firebase
  // ID/refresh token. It is never saved or sent to our own backend.
  const GOOGLE_WEB_CLIENT_ID = "847262470616-qgorfnp05kl5qj8npldgo7gdop2kho6o.apps.googleusercontent.com";
  let googleClientPromise = null;
  let googlePending = null;
  function googleClient() {
    if (!googleClientPromise) googleClientPromise = new Promise((resolve,reject) => {
      function setup() {
        try {
          const oauth = window.google?.accounts?.oauth2;
          if (!oauth) throw new Error('Google sign-in library unavailable');
          resolve(oauth.initTokenClient({
            client_id: GOOGLE_WEB_CLIENT_ID,
            scope: 'openid email profile',
            callback: response => { if (googlePending) googlePending(response); },
            error_callback: error => {
              if (googlePending) googlePending({error:error?.type || 'google_popup_error'});
            }
          }));
        } catch (error) {reject(error);}
      }
      if (window.google?.accounts?.oauth2) {setup();return;}
      const script = document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.onload=setup;
      script.onerror=()=>reject(new Error('Google sign-in library could not load'));
      document.head.appendChild(script);
    });
    return googleClientPromise;
  }
  // On Android Chrome, use Firebase's established popup handler. It does not
  // require this Cloudflare Worker origin to be added to the Google JS client.
  let firebasePopupPromise=null;
  function firebasePopupSdk() {
    if (!firebasePopupPromise) firebasePopupPromise=Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js')
    ]).then(async ([appModule,authModule])=>{
      let app;
      try {app=appModule.getApp('sharika-staging-admin');}
      catch(_) {app=appModule.initializeApp({
        apiKey:FIREBASE_KEY,
        authDomain:'sharika-voice-chat-app.firebaseapp.com',
        projectId:'sharika-voice-chat-app'
      },'sharika-staging-admin');}
      const auth=authModule.getAuth(app);
      await authModule.setPersistence(auth,authModule.browserSessionPersistence);
      auth.useDeviceLanguage();
      return {auth,authModule};
    });
    return firebasePopupPromise;
  }
  function googleError(error) {
    const message=String(error?.message || error?.error || 'Google sign-in failed');
    if (message.includes('origin_mismatch') || message.includes('Not a valid origin'))
      return 'Google OAuth Web client must allow this JavaScript origin: '+window.location.origin;
    if (message.includes('popup_closed') || message.includes('popup_failed_to_open'))
      return 'Google sign-in popup closed or blocked. Allow popups and try again.';
    if (message.includes('access_denied'))
      return 'Google sign-in was cancelled. Please choose your Sharika Google account.';
    if (message.includes('EMAIL_EXISTS'))
      return 'This email already has another sign-in provider. Ask an administrator to link it securely.';
    return message;
  }
  // Override the original demo login before anybody can enter the shell.
  const originalLogin = window.login;
  window.login = function () {
    role = null; identity = null;
    originalLogin();
    try { localStorage.removeItem('aa'); } catch (_) {}
    const email = byId('em'), password = byId('pw'), button = byId('go');
    const code = byId('tf');
    if (code) { code.disabled=true;code.value='';code.placeholder='Role checked securely by server'; }
    const p = document.querySelector('#lf p:last-child');
    if (p) p.textContent='Use a verified Sharika Firebase account with an assigned admin role. No demo password is accepted.';
    if (!button || !email || !password) return;
    const googleButton = document.createElement('button');
    googleButton.type = 'button';
    googleButton.id = 'google-signin';
    googleButton.className = 'btn o';
    googleButton.style.cssText = 'width:100%;margin-top:12px;min-height:48px';
    googleButton.textContent = 'Continue with Google';
    googleButton.disabled = true;
    button.insertAdjacentElement('afterend', googleButton);
    const googleHelp = document.createElement('p');
    googleHelp.style.cssText = 'margin:9px 0 0;font-size:12px;opacity:.8';
    googleHelp.textContent = 'Use the same Google account as your Sharika Android app. No extra password.';
    googleButton.insertAdjacentElement('afterend', googleHelp);
    let readyClient = null;
    let readyPopupSdk = null;
    const useChromePopup = /Android/i.test(navigator.userAgent) &&
      /Chrome\//i.test(navigator.userAgent) && !/EdgA|OPR/i.test(navigator.userAgent);
    function initializeGIS() {
      googleClient().then(client => {
        readyClient=client;
        if (googleButton.isConnected) googleButton.disabled=false;
      }).catch(error => {
        if (googleButton.isConnected) {
          googleButton.textContent='Google sign-in unavailable';
          const label=byId('le');
          if(label) label.textContent=googleError(error);
        }
      });
    }
    if (useChromePopup) {
      firebasePopupSdk().then(sdk=>{
        readyPopupSdk=sdk;
        if (googleButton.isConnected) googleButton.disabled=false;
      }).catch(()=>initializeGIS());
    } else initializeGIS();
    googleButton.onclick=function () {
      if (readyPopupSdk) {
        googleButton.disabled=true;
        const label=byId('le');
        if (label) label.textContent='Opening Google sign-in…';
        const provider=new readyPopupSdk.authModule.GoogleAuthProvider();
        provider.setCustomParameters({prompt:'select_account'});
        let operation;
        try {
          // Invoke popup synchronously in the user's click gesture.
          operation=readyPopupSdk.authModule.signInWithPopup(readyPopupSdk.auth,provider);
        } catch(error) {operation=Promise.reject(error);}
        Promise.resolve(operation).then(async signed=>{
          const jwt=await signed.user.getIdToken();
          const refresh=signed.user.refreshToken;
          if (!jwt || !refresh) throw new Error('Firebase did not establish a session');
          save({idToken:jwt,refreshToken:refresh,
            expiresAt:Date.now()+50*60*1000,email:signed.user.email || ''});
          await verifyAdmin();
          window.V='dash';window.shell();
        }).catch(async error=>{
          save(null);role=null;identity=null;
          await readyPopupSdk.authModule.signOut(readyPopupSdk.auth).catch(()=>{});
          const errorLabel=byId('le');
          if (errorLabel) errorLabel.textContent=googleError(error);
        }).finally(()=>{
          if (googleButton.isConnected) googleButton.disabled=false;
        });
        return;
      }
      // Google requires requestAccessToken to be called directly from a click.
      if (!readyClient || googlePending) return;
      googleButton.disabled=true;
      const label=byId('le');
      if (label) label.textContent='Choose your Google account…';
      const timeout=setTimeout(() => {
        if (googlePending === onGoogleResponse) {
          googlePending=null;
          if (googleButton.isConnected) googleButton.disabled=false;
          const status=byId('le');
          if(status) status.textContent='Google sign-in timed out. Please try again.';
        }
      },120000);
      async function onGoogleResponse(response) {
        if (googlePending !== onGoogleResponse) return;
        googlePending=null;
        clearTimeout(timeout);
        try {
          if (response?.error || !response?.access_token)
            throw new Error(response?.error || 'Google did not return a sign-in token');
          const data=await firebase('accounts:signInWithIdp',{
            requestUri:window.location.origin+'/admin/',
            postBody:new URLSearchParams({
              access_token:response.access_token,providerId:'google.com'
            }).toString(),
            returnSecureToken:true
          },false);
          if (!data.idToken || !data.refreshToken)
            throw new Error('Firebase did not establish a session');
          save({idToken:data.idToken,refreshToken:data.refreshToken,
            expiresAt:Date.now()+Math.max(300,Number(data.expiresIn || 3600))*1000,
            email:data.email || ''});
          await verifyAdmin();
          window.V='dash';
          window.shell();
        } catch (error) {
          save(null);role=null;identity=null;
          const errorLabel=byId('le');
          if (errorLabel) errorLabel.textContent=googleError(error);
        } finally {
          if (googleButton.isConnected) googleButton.disabled=false;
        }
      }
      googlePending=onGoogleResponse;
      try { readyClient.requestAccessToken({prompt:'select_account'}); }
      catch(error) {
        googlePending=null;
        clearTimeout(timeout);
        googleButton.disabled=false;
        if (label) label.textContent=googleError(error);
      }
    };
    async function submit() {
      if (!email.value.trim() || !password.value) { byId('le').textContent='Email and password required';return; }
      button.disabled=true;
      byId('le').textContent='Verifying Firebase and admin permission…';
      try {
        const data=await firebase('accounts:signInWithPassword',{
          email:email.value.trim(),password:password.value,returnSecureToken:true
        }, false);
        password.value='';
        save({idToken:data.idToken,refreshToken:data.refreshToken,
          expiresAt:Date.now()+Math.max(300,Number(data.expiresIn || 3600))*1000,
          email:data.email || email.value.trim()});
        await verifyAdmin();
        window.V='dash';
        window.shell();
      } catch(error) {
        save(null);role=null;identity=null;
        byId('le').textContent=error.message || 'Access denied';
      } finally {button.disabled=false;}
    }
    button.onclick=submit;
    for (const field of [email,password]) field.onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();submit();}
    };
  };
  const originalShell = window.shell;
  window.shell = function () {
    if (!session || !role) { window.login(); return; }
    originalShell();
    const who = document.querySelector('.top .who');
    if (who) who.innerHTML='Verified as<br><b>'+esc(window.ME)+'</b> · '+esc(role)+' (staging)';
    const exit = byId('lo');
    if (exit) exit.onclick=()=>{save(null);role=null;identity=null;window.login();};
  };

  // Replace the demo localStorage data. Never treat template rows as actual users.
  window.D.users=[];window.D.rc=[];window.D.audit=[];
  const P=window.P;
  const unavailable=label=>()=>{byId('pg').innerHTML=card(label,
    'This feature is locked until the server validates its permissions and transactions. No simulated changes are made.');};
  for(const name of Object.keys(P)) P[name]=unavailable(name);

  P.mod=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>🚩 Verified user and room reports</h3>'+
      '<p class="n">Reports from signed-in Sharika users are stored in the Support Inbox. '+
      'Moderators can review them here. Account blocks require Super Admin permission.</p>'+
      '<div class="row" id="sh-mod-shortcuts"></div>'+
      '<div id="sh-mod-reports">Loading reported issues…</div></div>';
    const controls=byId('sh-mod-shortcuts');
    for(const [label,page] of [
      ['Open Support Inbox','support'],['Review Rooms','rooms'],['Find User','users']
    ]){
      const button=document.createElement('button');
      button.type='button';button.className='btn';
      button.textContent=label;
      button.onclick=()=>{window.V=page;window.shell();};
      controls?.appendChild(button);
    }
    const list=byId('sh-mod-reports');
    if(!list)return;
    try{
      const data=await api('GET','reports');
      if(!list.isConnected)return;
      list.textContent='';
      const reports=Array.isArray(data.reports)?data.reports:[];
      if(!reports.length){
        list.textContent='No verified reports submitted yet.';
        return;
      }
      for(const report of reports){
        const item=document.createElement('div');
        item.className='card';
        const header=document.createElement('b');
        header.textContent='Report #'+report.id+' · From ID '+
          String(report.reporter_public_id||'Unknown');
        const when=document.createElement('small');
        when.style.cssText='display:block;margin:5px 0;opacity:.7';
        when.textContent=String(report.created_at||'');
        const details=document.createElement('p');
        details.style.whiteSpace='pre-wrap';
        details.textContent=String(report.body||'');
        const open=document.createElement('button');
        open.type='button';open.className='btn';
        open.textContent='Review in Support Inbox';
        open.onclick=()=>{window.V='support';window.shell();};
        item.append(header,when,details,open);
        list.appendChild(item);
      }
    }catch(error){
      if(list.isConnected)
        list.textContent='Report review unavailable: '+error.message;
    }
  };

  P.dash=async function () {
    const root=byId('pg');root.innerHTML=card('Dashboard','Loading verified totals…');
    try {
      const data=await api('GET','dashboard');
      const metrics=[['Registered users',data.users],['Rooms',data.rooms],
        ['Active gifts',data.active_gifts],['Ledger entries',data.ledger_entries],
        ['Online now',data.online_users==null?'Not tracked':data.online_users],
        ['Live rooms',data.live_rooms==null?'Not tracked':data.live_rooms]];
      if (data.coins_total!=null) {
        metrics.push(['Wallet coins (total)',fmt(data.coins_total)]);
        metrics.push(['Wallet diamonds (total)',fmt(data.diamonds_total)]);
      }
      root.innerHTML='<div class="kp">'+metrics.map(x=>
        '<div class="k"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>'
      ).join('')+'</div>'+card('Verified staging data',
        'These counts come from the same D1 database used by the Android app. The panel is read-only.');
    } catch (error) { root.innerHTML=card('Dashboard unavailable',error.message); }
  };

  // Option 2: real verified Neon Special ID management with a live profile preview.
  const sidStyle=document.createElement('style');
  sidStyle.textContent=`
    .sid-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(285px,.8fr);gap:18px}
    .sid-preview,.sid-editor{border:1px solid rgba(149,92,255,.45);border-radius:22px;
      background:#120d2b;padding:22px;min-width:0}
    .sid-preview{background:radial-gradient(circle at 30% 8%,#283e92 0,#170e43 45%,#100a28 100%);
      box-shadow:inset 0 0 42px #342074}
    .sid-eyebrow{color:#c7b8ff;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
    .sid-face{width:128px;height:128px;border-radius:50%;margin:30px auto 12px;
      border:4px solid #8a78ff;box-shadow:0 0 0 5px #221653,0 0 28px #595cff;
      display:grid;place-items:center;background:#291e57;overflow:hidden;font-size:40px;font-weight:900}
    .sid-face img{width:100%;height:100%;object-fit:cover}
    .sid-name{text-align:center;font-size:30px;font-weight:800;color:white}
    .sid-plate{max-width:430px;margin:18px auto 8px;padding:16px 20px;border:2px solid #ac78ff;
      border-radius:18px;background:linear-gradient(90deg,#341058,#5725ae,#1647ba);
      box-shadow:0 0 20px #7f45ff,inset 0 0 24px #6c45cb;text-align:center}
    .sid-plate small{display:block;letter-spacing:.18em;color:#d8c6ff;font-size:12px}
    @keyframes sid-red-gold{0%,100%{color:#ff3650;text-shadow:0 0 8px #ff2f45,0 0 18px #9e0e34}
      50%{color:#ffd071;text-shadow:0 0 9px #ff762d,0 0 22px #f83857}}
    .sid-plate{border-color:#ff7668;background:linear-gradient(90deg,#44091c,#8b1739,#480d29)}
    .sid-plate strong{font-size:clamp(30px,4vw,55px);line-height:1.25;color:#ff3650;
      font-weight:1000;letter-spacing:.065em;overflow-wrap:anywhere;
      font-variant-numeric:tabular-nums;animation:sid-red-gold 2.8s ease-in-out infinite}
    .sid-seat-id{font-size:16px;font-weight:1000;animation:sid-red-gold 2.8s ease-in-out infinite}
    @media(prefers-reduced-motion:reduce){.sid-plate strong,.sid-seat-id{animation:none;color:#ff3650}}
    .sid-caption{text-align:center;color:#b5a7dc;font-size:12px;margin-top:12px}
    .sid-room{display:flex;gap:13px;align-items:center;margin-top:28px;border-top:1px solid #514181;
      padding-top:20px}
    .sid-seat{min-width:64px;display:grid;justify-items:center;gap:4px;color:#ddc7ff;font-size:12px}
    .sid-seat-ring{height:54px;width:54px;border-radius:50%;border:2px solid #a175ff;
      background:#231945;box-shadow:0 0 13px #6f4bcb;display:grid;place-items:center;overflow:hidden}
    .sid-seat-ring img{width:100%;height:100%;object-fit:cover}
    .sid-editor label{color:#d9d1ff;font-size:13px;font-weight:700}
    .sid-editor input,.sid-editor select{background:#0e102f;border:1px solid #574384;
      color:white;border-radius:12px;margin:7px 0 13px}
    .sid-editor input:focus,.sid-editor select:focus{border-color:#2adfff}
    .sid-edit-title{font-size:25px;font-weight:800;margin-bottom:8px}
    .sid-hint,.sid-status{color:#aeb1d5;font-size:13px;line-height:1.5}
    .sid-status{min-height:24px;margin:8px 0}
    .sid-action{border:0;border-radius:13px;padding:13px 18px;font-weight:800;color:white;
      background:linear-gradient(100deg,#bf39f4,#5a65ff,#19cce0);width:100%}
    .sid-action:disabled{opacity:.43;cursor:not-allowed}
    .sid-ghost{background:transparent;border:1px solid #8159cd;padding:11px;
      border-radius:12px;color:#d5c8ff;width:100%;margin:3px 0 10px}
    .sid-list{margin-top:18px;display:flex;gap:9px;flex-wrap:wrap}
    .sid-person{border:1px solid #423568;background:#1d173e;padding:8px 12px;
      border-radius:12px;color:#ece7ff;text-align:left}
    .sid-person[aria-pressed="true"]{border-color:#15cde7;box-shadow:0 0 0 1px #15cde7}
    .sid-special-label{font-size:10px;color:#c5a9ff}
    @media(max-width:1000px){.sid-layout{grid-template-columns:1fr}.sid-preview,.sid-editor{padding:16px}}
  `;
  document.head.appendChild(sidStyle);
  P.specialIds=async function(){
    const root=byId('pg');
    if(role!=='super'){root.innerHTML=card('Special IDs','Super Admin permission required.');return;}
    root.innerHTML='<div class="card"><h3>Find verified member</h3><div class="row">'+
      '<input id="sid-search" placeholder="Account ID, Special ID or name" autocomplete="off">'+
      '<button class="btn s" id="sid-find">Search</button></div>'+
      '<div class="sid-hint" id="sid-list-note">Loading verified members…</div>'+
      '<div class="sid-list" id="sid-list"></div></div>'+
      '<div class="sid-layout"><section class="sid-preview" aria-label="Public profile preview">'+
      '<div class="sid-eyebrow">Public Profile Preview</div>'+
      '<div id="sid-avatar" class="sid-face">?</div>'+
      '<div id="sid-name" class="sid-name">Select a member</div>'+
      '<div class="sid-plate"><small>SPECIAL ID</small><strong id="sid-plate">—</strong></div>'+
      '<p class="sid-caption">Animated bold red ID on profiles; room seats keep names and SVIP badges</p>'+
      '<div class="sid-room"><div class="sid-seat"><div class="sid-seat-ring" id="sid-seat-face">?</div>'+
      '<span id="sid-seat-id" class="sid-seat-id">—</span></div>'+
      '<div class="sid-hint">Room seat preview · permanent account remains unchanged</div></div>'+
      '</section><section class="sid-editor"><h2 class="sid-edit-title">Assign Special ID</h2>'+
      '<p class="sid-hint">Only verified Sharika accounts can receive a unique ID.</p>'+
      '<label for="sid-account">Permanent Account ID</label>'+
      '<input id="sid-account" readonly placeholder="Select a verified member">'+
      '<label for="sid-value">Special ID (1–10 digits)</label>'+
      '<input id="sid-value" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="777777">'+
      '<label for="sid-days">Duration</label><select id="sid-days">'+
      '<option value="30">30 days</option><option value="7">7 days</option>'+
      '<option value="90">90 days</option><option value="">Permanent</option></select>'+
      '<label>Frame</label><input readonly value="Animated Red–Gold">'+
      '<button type="button" class="sid-ghost" id="sid-check">Check availability</button>'+
      '<button type="button" class="sid-action" id="sid-save" disabled>Save Special ID</button>'+
      '<p class="sid-status" id="sid-status" role="status"></p>'+
      '<button type="button" class="sid-ghost" id="sid-revoke" disabled>Revoke Special ID</button>'+
      '</section></div>';
    let people=[],selected=null;
    const input=byId('sid-search'),list=byId('sid-list'),status=byId('sid-status');
    const value=byId('sid-value'),save=byId('sid-save'),revoke=byId('sid-revoke');
    const faceHtml=user=>{
      const pic=typeof user?.pic==='string'&&/^https:\/\//.test(user.pic)?user.pic:'';
      return pic?'<img src="'+esc(pic)+'" alt="">':esc((user?.name||'?').slice(0,1).toUpperCase());
    };
    function preview(){
      const display=value.value.trim()||selected?.special_id||'—';
      byId('sid-name').textContent=selected?.name||'Select a member';
      byId('sid-account').value=selected?.public_id||'';
      byId('sid-avatar').innerHTML=faceHtml(selected);
      byId('sid-seat-face').innerHTML=faceHtml(selected);
      byId('sid-plate').textContent=display;
      byId('sid-seat-id').textContent=display;
      save.disabled=!selected||selected.status!=='active'||!/^[0-9]{1,10}$/.test(value.value.trim());
      revoke.disabled=!selected||!selected.special_id;
    }
    async function search(){
      list.replaceChildren();byId('sid-list-note').textContent='Loading verified members…';
      try{
        const data=await api('GET','special-ids?q='+encodeURIComponent(input.value.trim()));
        if(!list.isConnected)return;
        people=Array.isArray(data.users)?data.users:[];
        byId('sid-list-note').textContent=people.length?
          'Select the account that will own this Special ID.':'No verified members found.';
        for(const person of people){
          const button=document.createElement('button');button.type='button';
          button.className='sid-person';button.dataset.id=person.public_id;
          button.setAttribute('aria-pressed',String(selected?.public_id===person.public_id));
          button.textContent=person.name+' · '+person.public_id+
            (person.special_id?' · ★ '+person.special_id:'');
          button.onclick=()=>{
            selected=person;value.value=person.special_id||'';
            status.textContent='';
            for(const b of list.children)b.setAttribute('aria-pressed',
              String(b===button));
            preview();
          };
          list.appendChild(button);
        }
      }catch(error){byId('sid-list-note').textContent='Search unavailable: '+error.message;}
    }
    byId('sid-find').onclick=search;
    let timer;input.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,300);};
    value.oninput=()=>{status.textContent='';preview();};
    byId('sid-check').onclick=async()=>{
      const proposed=value.value.trim();
      if(!/^[0-9]{1,10}$/.test(proposed)){status.textContent='Use 1–10 numeric digits.';return;}
      try{
        const response=await api('GET','special-ids/availability?value='+encodeURIComponent(proposed));
        status.textContent=response.available?'Available ✓':
          selected?.special_id===proposed?'Assigned to this member.':'This ID is reserved.';
      }catch(error){status.textContent='Availability check failed: '+error.message;}
    };
    save.onclick=async()=>{
      if(save.disabled||!selected)return;
      const specialId=value.value.trim(),accountId=selected.public_id;
      if(!window.confirm('Assign Special ID '+specialId+' to '+accountId+'?'))return;
      save.disabled=true;status.textContent='Saving on Sharika server…';
      try{
        const days=byId('sid-days').value;
        const result=await api('POST','special-ids',{
          public_id:accountId,special_id:specialId,
          duration_days:days===''?null:Number(days),frame:'neon'
        });
        selected.special_id=result.special_id;selected.frame='neon';
        selected.expires_at=result.expires_at;
        status.textContent='Saved ✓ The public profile will show '+result.special_id;
        note('Special ID assigned successfully');
        await search();preview();
      }catch(error){status.textContent='Not saved: '+error.message;preview();}
    };
    revoke.onclick=async()=>{
      if(!selected?.special_id)return;
      const accountId=selected.public_id;
      if(!window.confirm('Revoke Special ID from account '+accountId+'?'))return;
      revoke.disabled=true;
      try{
        await api('PATCH','special-ids/'+accountId+'/revoke',{});
        selected.special_id=null;selected.expires_at=null;value.value='';
        status.textContent='Revoked. Permanent Account ID is unchanged.';
        await search();preview();
      }catch(error){status.textContent='Revoke failed: '+error.message;preview();}
    };
    preview();await search();
  };

  P.users=async function () {
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>Verified users</h3><div class="row">'+
      '<input id="q" placeholder="Search by ID or name" aria-label="Search users"></div>'+
      '<div id="ul">Loading…</div></div>';
    const list=byId('ul'),input=byId('q');
    async function refresh() {
      list.textContent='Loading verified users…';
      try {
        const data=await api('GET','users'+(input.value.trim()?'?q='+encodeURIComponent(input.value.trim()):''));
        const users=data.users||[];
        list.innerHTML=window.T(['User ID','Name','Country','Sent Lv.','Coins','Diamonds','Status','Admin action'],
          users.map(u=>{
            const action=role==='super'&&u.public_id!==identity?.public_id&&u.status!=='deleted'?
              '<button type="button" class="btn s" data-status-id="'+esc(u.public_id)+
              '" data-current-status="'+esc(u.status)+'">'+
              (u.status==='active'?'Block':'Unblock')+'</button>':'—';
            return [esc(u.public_id),esc(u.name),esc(u.country),fmt(u.wealth_level),
              fmt(u.coins),fmt(u.diamonds),esc(u.status),action];
          }));
      }catch(error){list.textContent=error.message;}
    }
    list.onclick=async e=>{
      const button=e.target.closest('button[data-status-id]');
      if(!button||button.disabled)return;
      const publicId=button.dataset.statusId;
      const next=button.dataset.currentStatus==='active'?'blocked':'active';
      const reason=window.prompt('Reason for '+(next==='blocked'?'blocking':'unblocking')+' user '+publicId+':');
      if(reason===null)return;
      if(reason.trim().length<3){note('Please enter a reason (3 or more characters).');return;}
      if(!window.confirm('Confirm '+next+' for user '+publicId+'?'))return;
      button.disabled=true;
      try{
        await api('PATCH','users/'+encodeURIComponent(publicId)+'/status',{status:next,reason:reason.trim()});
        note('User '+publicId+' is now '+next);
        await refresh();
      }catch(error){note('Could not update: '+error.message);button.disabled=false;}
    };
    let timer;
    input.oninput=()=>{clearTimeout(timer);timer=setTimeout(refresh,250);};
    await refresh();
  };
  P.rooms=async function () {
    const root=byId('pg');root.innerHTML=card('Rooms','Loading verified room and live presence…');
    try{
      const data=await api('GET','rooms');
      const tracked=data.live_presence_tracked===true;
      root.innerHTML='<div class="card"><h3>Verified rooms and active visitors</h3>'+
        '<p class="n">'+(tracked?
          'Live visitor counts include authenticated activity seen in the last 90 seconds.':
          'Live activity service is temporarily unavailable; saved members are not online counts.')+
        '</p><button class="btn" type="button" id="room-refresh">Refresh live counts</button>'+
        window.T(['Room ID','Name','Owner ID','Online (90s)','Saved members','Seats','Inspect'],
        (data.rooms||[]).map(r=>[
          esc(r.id),esc(r.name),esc(r.owner_public_id||''),
          r.online_count==null?'Untracked':fmt(r.online_count),
          fmt(r.members),fmt(r.seat_count),
          '<button type="button" class="btn s" data-room-id="'+esc(r.id)+'">Members</button>'
        ]))+'<div id="room-members-detail"></div></div>';
      root.onclick=async e=>{
        if(e.target.closest('#room-refresh')){await P.rooms();return;}
        const button=e.target.closest('button[data-room-id]');
        if(!button||button.disabled)return;
        button.disabled=true;
        const detail=byId('room-members-detail');
        detail.textContent='Loading saved membership…';
        try{
          const info=await api('GET','rooms/'+encodeURIComponent(button.dataset.roomId)+'/members');
          detail.innerHTML='<h3>Members of '+esc(info.room.name)+' ('+esc(info.room.id)+')</h3>'+
            '<p class="n">Saved room membership only; individual online identity is not inferred.</p>'+
            window.T(['User ID','Name','Room role','Seat','Muted','Joined'],
              (info.members||[]).map(m=>[
                esc(m.public_id),esc(m.name),esc(m.role),
                m.seat_no==null?'Audience':fmt(m.seat_no),
                m.muted?'Yes':'No',esc(m.joined_at)
              ]));
        }catch(error){detail.textContent=error.message;}
        finally{button.disabled=false;}
      };
    }catch(error){root.innerHTML=card('Rooms unavailable',error.message);}
  };

  P.musicLibrary=async function(){
    const root=byId('pg');
    root.innerHTML=card('🎵 Room Music Library','Loading Super Admin music catalogue…');
    try{
      const data=await api('GET','music-library');
      const rows=Array.isArray(data.tracks)?data.tracks:[];
      root.innerHTML='<div class="card"><h3>🎵 Room Music Library</h3>'+
        '<p class="n">Add direct HTTPS audio-file links to music you own or are licensed to stream. '+
        'Room Owner and Room Admin can play these songs for every listener. '+
        'No MP3 bytes are uploaded into D1, and listener wallets are not affected.</p>'+
        '<label>Song title<input id="sh-music-title" class="field" maxlength="100" placeholder="Song title"></label>'+
        '<label>Direct HTTPS audio URL<input id="sh-music-url" class="field" type="url" '+
        'placeholder="https://example.com/music/song.mp3"></label>'+
        '<button type="button" id="sh-music-add" class="btn">Add to Music Library</button>'+
        '<div style="margin-top:16px">'+window.T(['ID','Title','Source','Status','Action'],rows.map(track=>[
          fmt(track.id),esc(track.title),
          '<a href="'+esc(track.url)+'" target="_blank" rel="noopener noreferrer">Play / Check</a>',
          track.active?'Active':'Disabled',
          '<button type="button" class="btn s" data-music-id="'+esc(track.id)+'">'+
          (track.active?'Disable':'Enable')+'</button>'
        ]))+'</div></div>';
      byId('sh-music-add').onclick=async()=>{
        const button=byId('sh-music-add');
        const title=byId('sh-music-title').value.trim();
        const url=byId('sh-music-url').value.trim();
        if(!title||!url){note('Enter a title and direct HTTPS MP3 link');return;}
        button.disabled=true;
        try{await api('POST','music-library',{title,url});note('Music Library updated ✓');await P.musicLibrary();}
        catch(error){note('Music not added: '+error.message);button.disabled=false;}
      };
      root.querySelectorAll('[data-music-id]').forEach(button=>{
        button.onclick=async()=>{
          const item=rows.find(row=>String(row.id)===button.dataset.musicId);
          if(!item)return;
          button.disabled=true;
          try{
            await api('PATCH','music-library',{id:Number(item.id),title:item.title,
              url:item.url,active:!item.active});
            note('Music track updated ✓');await P.musicLibrary();
          }catch(error){note('Music update failed: '+error.message);button.disabled=false;}
        };
      });
    }catch(error){root.innerHTML=card('Music Library unavailable',error.message);}
  };

  P.daily=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>🎁 Verified Daily Check-in</h3>'+
      '<p class="n">Rewards are credited once per UTC day to the real wallet and immutable ledger.</p>'+
      '<div id="daily-stats">Loading server totals…</div></div>'+
      '<div class="card"><h3>7-day coin rewards</h3>'+
      '<div class="row" id="daily-config-fields">Loading…</div>'+
      (role==='super'?'<button class="btn s" id="daily-save" type="button">Save reward amounts</button>':'')+
      '<p class="n" id="daily-note">Only Super Admin may edit future rewards (1–1,000 coins per day). Previous claims never change.</p></div>'+
      '<div class="card"><h3>✨ Daily Task Coins</h3>'+
      '<p class="n">Each verified activity can be claimed once per UTC day. Tasks reset every UTC midnight; coin receipts never reset.</p>'+
      '<div class="row" id="daily-task-admin-fields">Loading…</div>'+
      (role==='super'?'<button class="btn s" id="daily-task-save" type="button">Save task coins</button>':'')+
      '<p class="n" id="daily-task-admin-note">Only Super Admin can edit future Follow/Gift task rewards.</p></div>'+
      '<div class="card"><h3>🤝 Verified invites</h3>'+
      '<p class="n">Current rates are shown below. Only future verified grants use updated settings; historical coin and virtual credit receipts remain unchanged.</p>'+
      '<div id="daily-invite-report">Loading verified referrals…</div></div>'+
      '<div class="card"><h3>⚙️ Invitation & virtual-coin conversion settings</h3>'+
      '<p class="n">Super Admin controls new referral rewards and virtual coin conversions. The USD reference is a points conversion rate, not a withdrawal promise.</p>'+
      '<div class="row" id="daily-invite-rules-fields">Loading…</div>'+
      (role==='super'?'<button class="btn s" id="daily-invite-rules-save" type="button">Save all invite rules</button>':'')+
      '<p class="n" id="daily-invite-rules-status"></p></div>'+
      '<div class="card"><h3>🪙 Invite credit approval</h3>'+
      '<p class="n">Approve only verified referrals. Credits convert into virtual Sharika coins. Cash withdrawal, bank details and external payout actions are disabled.</p>'+
      '<div id="daily-invite-cash">Loading pending USD entries…</div></div>';
    const stats=byId('daily-stats'),fields=byId('daily-config-fields'),note=byId('daily-note');
    try{
      const result=await api('GET','daily');
      stats.innerHTML=window.T(['UTC day','Claims today','Coins awarded today'],[
        [esc(result.utc_day),fmt(result.claims_today),fmt(result.coins_awarded_today)]
      ]);
      fields.innerHTML=(result.rewards||[]).map((reward,i)=>
        '<label style="display:inline-grid;gap:5px"><span>Day '+(i+1)+'</span>'+
        '<input type="number" class="field" min="1" max="1000" id="daily-day-'+(i+1)+
        '" value="'+esc(reward)+'" '+(role==='super'?'':'disabled')+'></label>').join('');
      const taskPanel=byId('daily-task-admin-fields');
      const rewards=result.task_rewards||{};
      taskPanel.innerHTML=[['follow','🤝 Follow a friend'],['gift','🎁 Send a gift']]
        .map(([key,title])=>'<label style="display:inline-grid;gap:5px"><span>'+
        title+'</span><input type="number" class="field" min="1" max="1000" '+
        'id="daily-task-'+key+'" value="'+esc(rewards[key]||'')+'" '+
        (role==='super'?'':'disabled')+'></label>').join('')+
        '<p class="n">Task coins paid today: '+fmt(result.task_coins_awarded_today)+
        ' · Claims: '+fmt(result.task_claims_today)+'</p>';
    }catch(error){stats.textContent=error.message;fields.textContent='Rewards unavailable.';return;}
    try{
      const invites=await api('GET','invites');
      const table=window.T(['Inviter ID','New user ID','Joined'],(invites.referrals||[]).map(r=>[
        esc(r.inviter_public_id),esc(r.referred_public_id),esc(r.joined_at||'')
      ]));
      byId('daily-invite-report').innerHTML='<p class="n">Total verified invites: <b>'+
        fmt(invites.total_invites)+'</b></p>'+
        window.T(['Bonus type','Coin rewards credited','Transactions'],
          (invites.bonus_totals||[]).map(r=>[esc(r.reason),fmt(r.coins),fmt(r.count)]))+
        window.T(['Virtual credit state','USD-equivalent cents','Referrals'],
          (invites.usd_earning_totals||[]).map(r=>[esc(r.status),fmt(r.cents),fmt(r.count)]))+table;
    }catch(error){byId('daily-invite-report').textContent=error.message;}
    const ruleSpecs=[
      ['inviter_coins','Inviter coins',0,1000000],
      ['invitee_coins','New member coins',2000,1000000],
      ['invite_usd_cents','Inviter USD-equivalent credit cents',0,10000],
      ['inviter_recharge_percent','Referrer recharge %',0,50],
      ['first_recharge_percent','First recharge bonus %',0,100],
      ['recharge_coins_per_usd','Virtual coins per $1 reference',1000,1000000],
      ['claim_window_hours','Invitation claim hours',1,168]
    ];
    try{
      const loaded=await api('GET','invites/rules');
      const config=loaded.rules||{};
      byId('daily-invite-rules-fields').innerHTML=ruleSpecs.map(([key,label,min,max])=>
        '<label style="display:inline-grid;gap:5px"><span>'+esc(label)+'</span>'+
        '<input type="number" class="field" min="'+min+'" max="'+max+'" step="1" ' +
        'id="sh-invite-config-'+key+'" value="'+esc(config[key])+'" '+
        (role==='super'?'':'disabled')+'></label>').join('');
      byId('daily-invite-rules-status').textContent='Version '+fmt(config.version)+
        ' · Changes take effect after Save.';
      byId('daily-invite-rules-save')?.addEventListener('click',async event=>{
        const button=event.currentTarget;
        const next={};
        for(const [key] of ruleSpecs){
          const raw=byId('sh-invite-config-'+key)?.value.trim()||'';
          if(!/^\d+$/.test(raw)){note('Enter whole numbers for all invite settings');return;}
          next[key]=Number(raw);
        }
        // Legacy fields remain in the D1 schema for old audit records but
        // cannot be edited through the virtual-only product UI.
        next.withdrawal_option_1_cents=Number(config.withdrawal_option_1_cents);
        next.withdrawal_option_2_cents=Number(config.withdrawal_option_2_cents);
        if(!window.confirm('Apply future Sharika invitation rewards and virtual-coin conversion rates?'))return;
        button.disabled=true;
        try{
          await api('PATCH','invites/rules',{rules:next,expected_version:Number(config.version)});
          note('Reward settings saved for future verified transactions.');
          await P.daily();
        }catch(error){note('Invite rule save failed: '+error.message);button.disabled=false;}
      });
    }catch(error){byId('daily-invite-rules-fields').textContent='Settings unavailable: '+error.message;}
    const reviewPanel=byId('daily-invite-cash');
    try{
      const earningData=await api('GET','invites/earnings');
      const earn=(earningData.earnings||[]).filter(x=>x.status==='pending');
      reviewPanel.innerHTML='<h4>Pending referral virtual credits ('+fmt(earn.length)+')</h4>'+
        window.T(['Inviter','New user','USD-equivalent points','Review'],earn.map(x=>[
          esc(x.inviter_id),esc(x.referred_id),'$'+(x.amount_cents/100).toFixed(2),
          '<button class="btn s" type="button" data-invite-verify="'+esc(x.referred_id)+
          '" data-approve="yes">Approve</button> '+
          '<button class="btn s" type="button" data-invite-verify="'+esc(x.referred_id)+
          '" data-approve="no">Reject</button>'
        ]))+'<p class="n">Once approved, the user may convert the verified credits '+
        'to virtual coins at the admin-controlled rate. No payout or bank workflow is offered.</p>';
      reviewPanel.onclick=async event=>{
        const earning=event.target.closest('[data-invite-verify]');
        if(!earning||earning.disabled)return;
        const button=earning;
        button.disabled=true;
        try{
          const approved=earning.dataset.approve==='yes';
          if(!window.confirm((approved?'Approve':'Reject')+' virtual invite credit from '+
            earning.dataset.inviteVerify+' after checking the real account?'))return;
          await api('POST','invites/earnings/verify',{
            referred_public_id:earning.dataset.inviteVerify,approved
          });
          await P.daily();
        }catch(error){note('Virtual credit review failed: '+error.message);}
        finally{button.disabled=false;}
      };
    }catch(error){reviewPanel.textContent='Invite credit review unavailable: '+error.message;}
    if(role!=='super')return;
    byId('daily-save')?.addEventListener('click',async event=>{
      const rewards=Array.from({length:7},(_,i)=>{
        const raw=byId('daily-day-'+(i+1))?.value.trim()||'';
        return /^\d+$/.test(raw)?Number(raw):NaN;
      });
      if(rewards.some(n=>!Number.isSafeInteger(n)||n<1||n>1000)){
        note.textContent='Every reward must be a whole number from 1 to 1,000 coins.';return;
      }
      if(!window.confirm('Save these 7 daily reward values? Existing claims will stay unchanged.'))return;
      const button=event.currentTarget;button.disabled=true;
      try{
        await api('PATCH','daily',{rewards});
        note.textContent='Daily rewards saved and audited. Future claims use the new values.';
      }catch(error){note.textContent='Update failed: '+error.message;}
      finally{button.disabled=false;}
    });
    byId('daily-task-save')?.addEventListener('click',async event=>{
      const follow=byId('daily-task-follow')?.value.trim()||'';
      const gift=byId('daily-task-gift')?.value.trim()||'';
      const task_rewards={follow:Number(follow),gift:Number(gift)};
      const hint=byId('daily-task-admin-note');
      if(!/^\d+$/.test(follow)||!/^\d+$/.test(gift)||
        Object.values(task_rewards).some(n=>!Number.isSafeInteger(n)||n<1||n>1000)){
        hint.textContent='Use 1–1,000 whole coins for each task.';return;
      }
      if(!window.confirm('Save future task rewards? Existing receipts stay unchanged.'))return;
      const button=event.currentTarget;button.disabled=true;
      try{
        await api('PATCH','daily',{task_rewards});
        hint.textContent='Task coin amounts saved and audited. Tomorrow and unclaimed tasks use these amounts.';
      }catch(error){hint.textContent='Update failed: '+error.message;}
      finally{button.disabled=false;}
    });
  };

  // Packages stay under the existing Finance workflow. The exchange rate
  // is a real D1 setting: only Super Admin may change it, with a server audit.
  P.money=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>💎 Diamond Exchange Percentage</h3>'+
      '<p class="n">Set one percentage. For example, 70% gives 70 coins for every 100 diamonds. '+
      'Changes apply only to new exchanges; completed receipts and balances are unchanged.</p>'+
      '<div id="sharika-exchange-admin">Loading verified exchange percentage…</div></div>'+
      card('Recharge packages','Verified payment packages are managed separately. No demo credits.');
    const panel=byId('sharika-exchange-admin');
    try{
      const current=await api('GET','exchange-rate');
      if(!panel?.isConnected)return;
      const currentPercent=Number((100*Number(current.coins_per_unit)/
        Number(current.diamonds_per_unit)).toFixed(2));
      const canEdit=role==='super'&&current.editable;
      panel.innerHTML='<p class="n"><b id="sharika-exchange-current"></b></p>'+
        (canEdit?'<label for="sharika-exchange-percent">Exchange Percentage (%)</label>'+
          '<div class="row">'+
          '<button class="btn s" type="button" id="sharika-percent-minus" aria-label="Decrease percentage">−</button>'+
          '<input id="sharika-exchange-percent" class="field" type="number" min="1" max="10000" step="1" inputmode="numeric" value="'+
          Math.round(currentPercent)+'" aria-label="Exchange percentage">'+
          '<span>%</span>'+
          '<button class="btn s" type="button" id="sharika-percent-plus" aria-label="Increase percentage">+</button></div>'+
          '<p class="n" id="sharika-percent-preview" aria-live="polite"></p>'+
          '<button class="btn" id="sharika-rate-save" type="button">Save percentage</button>':
          '<p class="n">'+(current.editable?
          'Only Super Admin can change this percentage.':
          'Exchange settings migration is pending. The existing rate remains active.')+'</p>')+
        '<p id="sharika-exchange-status" class="n" role="status"></p>';
      byId('sharika-exchange-current').textContent=
        'Current: '+currentPercent+'% · Revision '+current.revision;
      const input=byId('sharika-exchange-percent');
      const status=byId('sharika-exchange-status');
      const preview=byId('sharika-percent-preview');
      const validPercent=value=>Number.isSafeInteger(value)&&value>=1&&value<=10000;
      const showPreview=()=>{
        if(!preview)return;
        const percent=Number(input?.value);
        preview.textContent=input?.value!==''&&validPercent(percent)
          ?'100 💎 = '+percent+' 🪙'
          :'Enter a whole percentage between 1 and 10,000.';
      };
      input?.addEventListener('input',showPreview);
      for(const [id,delta] of [['sharika-percent-minus',-1],['sharika-percent-plus',1]]){
        byId(id)?.addEventListener('click',()=>{
          const value=Number(input.value);
          input.value=String(Math.max(1,Math.min(10000,
            (validPercent(value)?value:70)+delta)));
          showPreview();
        });
      }
      showPreview();
      byId('sharika-rate-save')?.addEventListener('click',async event=>{
        const button=event.currentTarget;
        const percent=Number(input.value);
        if(input.value===''||!validPercent(percent)){
          status.textContent='Enter a whole percentage between 1 and 10,000.';return;
        }
        if(percent===currentPercent){
          status.textContent='This percentage is already active.';return;
        }
        if(!window.confirm('Set diamond exchange to '+percent+
           '%? 100 Diamonds will give '+percent+
           ' Coins on future exchanges. This is audited.'))return;
        button.disabled=true;
        try{
          // Keep the existing audited D1 exchange API. The admin edits only
          // the percentage; the server uses an exact 100-diamond denominator.
          await api('PATCH','exchange-rate',{
            diamonds_per_unit:100,coins_per_unit:percent,
            expected_revision:current.revision
          });
          note('Exchange percentage saved ✓');
          await P.money();
        }catch(error){
          status.textContent='Percentage not changed: '+error.message;
          button.disabled=false;
        }
      });
    }catch(error){if(panel?.isConnected)panel.textContent='Percentage unavailable: '+error.message;}
  };


  // This editor arranges global template slots, never a member's owned items.
  // Published layouts and server-owned cosmetic selections remain independent.
  P.profileDesigner=async function(){
    const root=byId('pg');
    if(role!=='super'){
      root.innerHTML=card('Live Profile Designer','Only Super Admin can publish global profile layouts.');
      return;
    }
    root.innerHTML=card('Live Profile Designer',
      'Drag rows (desktop), or use ↑ ↓ on your phone. This changes where items appear, not which item a member owns.')+
      '<div class="card" id="sh-layout-editor">Loading saved templates…</div>';
    const box=byId('sh-layout-editor');
    let data;
    try{data=await api('GET','profile-layout');}
    catch(error){box.textContent='Could not load profile templates: '+error.message;return;}
    if(!box.isConnected)return;
    const groups={
      main:{sections:['hero','stats','wallet','collection','account'],
        identity:['avatar','svip','name','id']},
      public:{sections:['cover','identity','levels','stats','actions'],
        identity:['avatar','name','id']}
    };
    const label={
      hero:'Profile photo and identity',stats:'Followers and statistics',
      wallet:'Wallet and Recharge',collection:'Shop / Backpack / Collection',
      account:'Account and Features',cover:'Cover / Background',
      identity:'User name and identity',levels:'Wealth and Charm levels',
      actions:'Follow / Message / Gift buttons',avatar:'🖼️ Avatar + user-owned frame',
      svip:'👑 SVIP badge',name:'✍️ User name',id:'🆔 User ID'
    };
    const defaults={
      main:{sections:[...groups.main.sections],identity:[...groups.main.identity],
        frame_scale:142,tag_position:'id',medal_position:'id',background:'original'},
      public:{sections:[...groups.public.sections],identity:[...groups.public.identity],
        frame_scale:142,tag_position:'name',medal_position:'name',background:'original'}
    };
    const copy=x=>JSON.parse(JSON.stringify(x));
    const draft={
      main:copy(data.screens?.main?.draft||defaults.main),
      public:copy(data.screens?.public?.draft||defaults.public)
    };
    let screen='main',message='',busy=false;
    const isDirty=()=>JSON.stringify(draft[screen])!==JSON.stringify(data.screens[screen].draft);
    const opts=(list,value)=>list.map(([v,t])=>
      '<option value="'+v+'"'+(v===value?' selected':'')+'>'+esc(t)+'</option>').join('');
    function paint(){
      if(!box.isConnected)return;
      const current=draft[screen],state=data.screens[screen],enabled=!busy;
      const sectionRows=(type,items)=>items.map((key,i)=>
        '<div draggable="true" data-layout-row="'+type+'" data-key="'+key+'" '+
        'style="display:flex;align-items:center;gap:7px;background:#302044;border:1px solid #bfa174;'+
        'border-radius:11px;margin:5px 0;padding:8px;color:#ffeed1;touch-action:pan-y">'+
        '<span aria-hidden="true">⠿</span><span style="flex:1">'+esc(label[key]||key)+'</span>'+
        '<button class="btn s" type="button" data-move="'+type+':'+i+':-1" aria-label="Move up">↑</button>'+
        '<button class="btn s" type="button" data-move="'+type+':'+i+':1" aria-label="Move down">↓</button></div>'
      ).join('');
      const identityPreview=current.identity.map(k=>
        '<div style="order:'+current.identity.indexOf(k)+';text-align:center;padding:3px">'+
        (k==='avatar'?'<div style="margin:auto;width:70px;height:70px;border-radius:50%;'+
          'border:6px double #ffd26e;box-shadow:0 0 0 5px #a353b8;font-size:33px">👤</div>':
          k==='name'?'✦ Soverix Net ✦':k==='svip'?'👑 SVIP 7':'🆔 ID 1000001')+'</div>'
      ).join('');
      const previewSection=key=>{
        if(key==='hero'||key==='identity')
          return '<div style="padding:12px;display:flex;flex-direction:column">'+identityPreview+
          '<small style="color:#f9d597">Frame '+current.frame_scale+
          '% · Tag by '+current.tag_position+' · Medal by '+current.medal_position+'</small></div>';
        return '<div style="padding:10px;margin:6px;border:1px solid #a882c8;'+
          'border-radius:12px;background:#ffffff0e">'+esc(label[key]||key)+'</div>';
      };
      const preview=current.sections.map(previewSection).join('');
      const title='<div class="row"><h3>👑 Global profile placement</h3>'+
        '<select class="field" id="sh-layout-screen">'+
        opts([['main','My Main Profile'],['public','Other User / Public Profile']],screen)+
        '</select></div>';
      box.innerHTML=title+
        '<p class="n">All accounts use the same placement. Each account keeps its own name, ID, purchased frame, equipped tag and medals.</p>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">'+
        '<div><h4>Screen sections</h4>'+sectionRows('sections',current.sections)+
        '<h4>Inside identity</h4>'+sectionRows('identity',current.identity)+
        '<label>Frame size (%) <input class="field" id="sh-layout-frame" type="number" min="110" max="165" value="'+current.frame_scale+'"></label>'+
        '<div class="row"><label>Tag location <select class="field" id="sh-layout-tag">'+
        opts([['name','Under name'],['id','Under ID'],['avatar','On avatar']],current.tag_position)+
        '</select></label><label>Medal location <select class="field" id="sh-layout-medal">'+
        opts([['name','Under name'],['id','Under ID'],['avatar','On avatar']],current.medal_position)+
        '</select></label></div>'+
        '<label>Default background <select class="field" id="sh-layout-background">'+
        opts([['original','Original profile artwork'],['gold','Golden premium']],current.background)+
        '</select></label></div>'+
        '<div><h4>Live mobile preview</h4><div style="margin:6px auto;width:min(100%,290px);'+
        'border:5px solid #e8bc69;border-radius:28px;overflow:hidden;min-height:340px;'+
        'color:#ffe8b4;text-align:center;background:'+
        (current.background==='gold'?'linear-gradient(145deg,#a36e27,#281a27 66%)':
        'linear-gradient(145deg,#562169,#140c2c 60%)')+'">'+
        '<div style="background:#110d24;padding:10px">✦ Sharika '+(screen==='main'?'Main':'User')+' Profile ✦</div>'+
        preview+'</div><p class="n">Phone sizes may differ. Check on staging before publishing.</p></div></div>'+
        '<p class="n"><b>Draft revision '+state.revision+'</b> · '+
        (isDirty()?'Unsaved changes':'Saved draft')+'</p>'+
        '<div class="row"><button class="btn s" id="sh-layout-save" '+(enabled?'':'disabled')+'>Save Draft</button>'+
        '<button class="btn s" id="sh-layout-publish" '+(enabled?'':'disabled')+'>Publish to All</button>'+
        '<button class="btn s" id="sh-layout-rollback" '+(state.can_rollback&&enabled?'':'disabled')+'>Restore Previous</button>'+
        '<button class="btn s" id="sh-layout-reset">Reset Draft</button></div>'+
        '<p class="n" role="status" id="sh-layout-status">'+esc(message)+'</p>';
      byId('sh-layout-screen').onchange=e=>{screen=e.target.value;message='';paint();};
      const update=(key,transform)=>byId(key).onchange=e=>{transform(e.target.value);paint();};
      update('sh-layout-frame',v=>{draft[screen].frame_scale=Math.max(110,Math.min(165,Number(v)||142));});
      update('sh-layout-tag',v=>{draft[screen].tag_position=v;});
      update('sh-layout-medal',v=>{draft[screen].medal_position=v;});
      update('sh-layout-background',v=>{draft[screen].background=v;});
      function shift(group,i,j){
        const array=draft[screen][group];
        if(j<0||j>=array.length)return;
        const [item]=array.splice(i,1);array.splice(j,0,item);paint();
      }
      box.querySelectorAll('[data-move]').forEach(button=>{
        button.onclick=()=>{const [group,i,delta]=button.dataset.move.split(':');
          shift(group,Number(i),Number(i)+Number(delta));};
      });
      let dragged=null;
      box.querySelectorAll('[data-layout-row]').forEach(row=>{
        row.ondragstart=e=>{dragged={group:row.dataset.layoutRow,key:row.dataset.key};
          e.dataTransfer.effectAllowed='move';};
        row.ondragover=e=>{if(dragged?.group===row.dataset.layoutRow)e.preventDefault();};
        row.ondrop=e=>{
          e.preventDefault();
          if(!dragged||dragged.group!==row.dataset.layoutRow)return;
          const array=draft[screen][dragged.group];
          const from=array.indexOf(dragged.key),to=array.indexOf(row.dataset.key);
          if(from>=0&&to>=0)shift(dragged.group,from,to);
          dragged=null;
        };
      });
      byId('sh-layout-reset').onclick=()=>{draft[screen]=copy(state.published);message='Reset to published design (not saved).';paint();};
      byId('sh-layout-save').onclick=async()=>{
        busy=true;message='Saving draft…';paint();
        try{
          const result=await api('PATCH','profile-layout',{
            screen,expected_revision:state.revision,layout:copy(draft[screen])
          });
          data=result;message='Draft saved ✓ Only preview changed; app is unchanged.';
        }catch(error){message='Draft not saved: '+error.message;}
        finally{busy=false;paint();}
      };
      byId('sh-layout-publish').onclick=async()=>{
        if(isDirty()){message='Save Draft first, then Publish.';paint();return;}
        if(!window.confirm('Publish the saved '+screen+' layout to ALL Sharika members? Their purchased items and balances stay unchanged.'))return;
        busy=true;message='Publishing…';paint();
        try{
          data=await api('POST','profile-layout',{
            screen,expected_revision:state.revision,action:'publish'
          });
          message='Published ✓ Members see the new layout after profile refresh.';
        }catch(error){message='Not published: '+error.message;}
        finally{busy=false;paint();}
      };
      byId('sh-layout-rollback').onclick=async()=>{
        if(!window.confirm('Restore the previous '+screen+' published layout for all members?'))return;
        busy=true;message='Restoring…';paint();
        try{
          data=await api('POST','profile-layout',{
            screen,expected_revision:state.revision,action:'rollback'
          });
          draft[screen]=copy(data.screens[screen].draft);
          message='Previous published layout restored ✓';
        }catch(error){message='Restore failed: '+error.message;}
        finally{busy=false;paint();}
      };
    }
    paint();
  };

  P.cosmetics=async function(){
    const root=byId('pg');
    if(role!=='super'){
      root.innerHTML=card('Frames, entry and name tags','Only Super Admin can manage prices or grant free styles to an ID.');
      return;
    }
    const numbered=(prefix,count)=>Array.from({length:count},(_,i)=>
      prefix+'-'+String(i+1).padStart(2,'0'));
    const roleFrames=[...Array.from({length:51},(_,i)=>i+1),54,55,56,57,58,59,60,61,62,63,64]
      .map(n=>'role-frame-'+String(n).padStart(2,'0'));
    const art={
      frame_style:['phoenix-fire','ice-wings','royal-dragon','vip7','royal-gold','violet-love',
        'ice-admin','golden-dragon','ice-dragon','violet-phoenix','castle-flag','lion-queen','phoenix-queen','tiger-queen',
        'vip5-animated',...numbered('svip-frame',8),
        ...[2,3,4,5].map(n=>'vip-royal-frame-'+String(n).padStart(2,'0')),
        ...[4,5].map(n=>'svip-royal-frame-'+String(n).padStart(2,'0')),
        'noble-gold-microphone',...roleFrames],
      entry_style:['phoenix','dragon-queen','ice-king','castle-flag','lion-queen','phoenix-queen','tiger-queen'],
      medal_style:['bronze','silver','gold','top-host',...numbered('svip-medal',8),
        ...[2,3,4,5].map(n=>'vip-royal-badge-'+String(n).padStart(2,'0')),
        ...[1,2,3,4,5].map(n=>'svip-royal-badge-'+String(n).padStart(2,'0'))],
      name_tag_style:['legend',...numbered('svip-tag',17)]
    };
    const kinds=Object.keys(art);
    const options=(list,selected)=>list.map(v=>'<option value="'+esc(v)+'"'+
      (v===selected?' selected':'')+'>'+esc(v.replaceAll('_',' '))+'</option>').join('');
    root.innerHTML=mediaStudio('cos-media')+card('Verified cosmetic inventory',
      'Users must buy with wallet coins. Admin grants are free and attached to exact verified eight-digit IDs. Changes and grants are audited.')+
      '<div class="card"><h3>🎁 Give a frame or medal to a user</h3>'+
      '<p class="n">Super Admin: enter the real Sharika ID, find the frame or medal, and give it free. '+
      'Admin-only items can be granted even when Store sales are disabled. The granted item is equipped immediately and appears on verified profiles and room seats after refresh.</p>'+
      '<input class="field" id="sh-cos-user" maxlength="8" inputmode="numeric" '+
      'placeholder="Recipient Sharika ID (8 digits)" aria-label="Recipient Sharika ID">'+
      '<div class="row"><select class="field" id="sh-cos-grant-kind" aria-label="Cosmetic category">'+
      '<option value="frame_style">Frames</option><option value="medal_style">Medals</option>'+
      '<option value="entry_style">Entry effects</option><option value="name_tag_style">Name tags</option></select>'+
      '<input class="field" id="sh-cos-grant-filter" type="search" '+
      'placeholder="Search e.g. Role Frame 28" aria-label="Search cosmetics"></div>'+
      '<select class="field" id="sh-cos-grant-item" aria-label="Choose a frame or medal"></select>'+
      '<button class="btn s" type="button" id="sh-cos-grant">Give selected item to ID · Free</button>'+
      '<p class="n" role="status" id="sh-cos-note"></p></div>'+
      '<div class="card"><h3>↩️ Remove an admin-granted item</h3>'+
      '<p class="n">Only items previously given by an administrator can be removed here. Purchased items stay protected; every removal is audited.</p>'+
      '<div class="row"><input id="sh-cos-revoke-user" maxlength="8" inputmode="numeric" placeholder="User ID (8 digits)">'+
      '<button id="sh-cos-find-grants" class="btn s" type="button">Find granted items</button></div>'+
      '<div id="sh-cos-grants-list"></div><p id="sh-cos-revoke-note" class="n" aria-live="polite"></p></div>'+
      '<div id="sh-cosmetic-list">Loading server catalogue…</div>'+
      '<div class="card"><h3>Add new catalog item</h3>'+
      '<div class="row"><select class="field" id="sh-cos-kind">'+options(kinds,'entry_style')+'</select>'+
      '<input class="field" id="sh-cos-slug" maxlength="39" placeholder="New item ID (e.g. royal-arrival)"></div>'+
      '<div class="row"><input class="field" id="sh-cos-name" maxlength="80" placeholder="Display name">'+
      '<input class="field" id="sh-cos-price" type="number" min="1" max="1000000" placeholder="Coin price"></div>'+
      '<div class="row"><label>Existing bundled artwork <select class="field" id="sh-cos-art"></select></label>'+
      '<button class="btn s" type="button" id="sh-cos-create">Add item</button></div>'+
      '<div class="row"><input class="field" id="sh-cos-image" maxlength="500" type="url" placeholder="Image / still URL">'+
      '<input class="field" id="sh-cos-animation" maxlength="500" type="url" placeholder="Animated frame / entry video URL"></div>'+
      '<input class="field" id="sh-cos-audio" maxlength="500" type="url" placeholder="Optional separate entry sound URL">'+
      '<p class="n">Uploaded media overrides bundled artwork. Keep bundled artwork as a fallback for older app builds.</p></div>';
    wireMediaStudio('cos-media',[
      ['sh-cos-image','New item · image'],['sh-cos-animation','New item · video / animation'],
      ['sh-cos-audio','New item · entry sound']]);
    const status=byId('sh-cos-note'),kind=byId('sh-cos-kind'),artSelect=byId('sh-cos-art');
    function fillArt(){artSelect.innerHTML=options(art[kind.value]||[],'');}
    kind.onchange=fillArt;fillArt();
    try{
      const data=await api('GET','cosmetics');
      if(!root.isConnected)return;
      const items=Array.isArray(data.items)?data.items:[];
      const grantKind=byId('sh-cos-grant-kind'),grantFilter=byId('sh-cos-grant-filter');
      const grantItem=byId('sh-cos-grant-item');
      function fillGrantItems(){
        const query=grantFilter.value.trim().toLowerCase();
        const matches=items.filter(item=>item.kind===grantKind.value&&
          (!query||(item.name+' '+item.id).toLowerCase().includes(query)));
        grantItem.innerHTML=matches.length?matches.map(item=>
          '<option value="'+esc(item.id)+'">'+esc(item.name+' · '+item.id+
          (item.active?'':' · Admin-only') )+'</option>').join(''):
          '<option value="">No matching items in server catalogue</option>';
        grantItem.disabled=matches.length===0;
      }
      grantKind.onchange=fillGrantItems;
      grantFilter.oninput=fillGrantItems;
      fillGrantItems();
      const list=byId('sh-cosmetic-list');
      list.innerHTML=items.map(item=>'<div class="card"><h4>'+esc(item.id)+'</h4>'+
        '<div class="row"><label>Name <input class="field" data-cos-field="name" data-id="'+esc(item.id)+'" value="'+esc(item.name)+'"></label>'+
        '<label>Price coins <input class="field" type="number" min="1" max="1000000" data-cos-field="price" data-id="'+esc(item.id)+'" value="'+Number(item.price_coins)+'"></label></div>'+
        '<div class="row"><label>Artwork <select class="field" data-cos-field="art" data-id="'+esc(item.id)+'">'+
        options(art[item.kind]||[],item.art_key)+'</select></label>'+
        '<div class="row"><label>Image URL<input class="field" type="url" maxlength="500" data-cos-field="image" data-id="'+esc(item.id)+'" value="'+esc(item.image_url||'')+'"></label>'+
        '<label>Animation / video URL<input class="field" type="url" maxlength="500" data-cos-field="animation" data-id="'+esc(item.id)+'" value="'+esc(item.animation_url||'')+'"></label>'+
        '<label>Sound URL<input class="field" type="url" maxlength="500" data-cos-field="audio" data-id="'+esc(item.id)+'" value="'+esc(item.audio_url||'')+'"></label></div>'+
        '<label><input type="checkbox" data-cos-field="active" data-id="'+esc(item.id)+'"'+
        (item.active?' checked':'')+'> Available to buy</label>'+
        '<button class="btn s" type="button" data-cos-save="'+esc(item.id)+'">Save</button></div></div>').join('')||
        card('No catalogue','No cosmetic items have been seeded yet.');
      const field=(id,name)=>Array.from(list.querySelectorAll('[data-cos-field]'))
        .find(x=>x.dataset.id===id&&x.dataset.cosField===name);
      list.querySelectorAll('[data-cos-save]').forEach(button=>{
        button.onclick=async()=>{
          const id=button.dataset.cosSave;
          const item=items.find(x=>x.id===id);
          const price=Number(field(id,'price')?.value);
          if(!item||!Number.isSafeInteger(price)||price<1||price>1000000){
            status.textContent='Enter a coin price from 1 to 1,000,000.';return;
          }
          button.disabled=true;
          try{
            await api('PATCH','cosmetics',{
              item_id:id,kind:item.kind,name:field(id,'name').value.trim(),
              price_coins:price,art_key:field(id,'art').value,
              image_url:field(id,'image').value.trim(),
              animation_url:field(id,'animation').value.trim(),
              audio_url:field(id,'audio').value.trim(),
              active:field(id,'active').checked
            });
            status.textContent='Saved and audited: '+id;
          }catch(error){status.textContent='Not saved: '+error.message;}
          finally{button.disabled=false;}
        };
      });
      byId('sh-cos-create').onclick=async event=>{
        const button=event.currentTarget;
        const price=Number(byId('sh-cos-price').value);
        const payload={kind:kind.value,slug:byId('sh-cos-slug').value.trim(),
          name:byId('sh-cos-name').value.trim(),art_key:artSelect.value,
          image_url:byId('sh-cos-image').value.trim(),
          animation_url:byId('sh-cos-animation').value.trim(),
          audio_url:byId('sh-cos-audio').value.trim(),
          price_coins:price};
        if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(payload.slug)||!Number.isSafeInteger(price)||
           price<1||price>1000000){status.textContent='Enter a valid slug and positive coin price.';return;}
        button.disabled=true;
        try{await api('POST','cosmetics',payload);await P.cosmetics();note('Cosmetic added');}
        catch(error){status.textContent='Not added: '+error.message;button.disabled=false;}
      };
      byId('sh-cos-grant').onclick=async event=>{
        const button=event.currentTarget;
        const id=byId('sh-cos-user').value.trim(),itemId=byId('sh-cos-grant-item').value;
        if(!/^[0-9]{8}$/.test(id)||!itemId){
          status.textContent='Enter a verified 8-digit ID and select one cosmetic.';return;
        }
        const selected=items.find(item=>item.id===itemId);
        if(!selected||!window.confirm('Give '+selected.name+' to user ID '+id+
          ' for FREE and EQUIP it immediately? This replaces the currently selected item of that type. The grant is audited.'))return;
        button.disabled=true;
        try{
          const given=await api('POST','cosmetics/grant',{public_id:id,item_id:itemId});
          status.textContent=(given.duplicate?'Already owned; re-equipped: ':'Granted and equipped: ')+id+' · '+itemId;
        }catch(error){status.textContent='Grant failed: '+error.message;}
        finally{button.disabled=false;}
      };
      const revokeNote=byId('sh-cos-revoke-note'),grantList=byId('sh-cos-grants-list');
      const finder=byId('sh-cos-find-grants');
      async function loadMemberGrants(){
        const publicId=byId('sh-cos-revoke-user').value.trim();
        if(!/^[0-9]{8}$/.test(publicId)){
          revokeNote.textContent='Enter a verified eight-digit member ID.';return;
        }
        finder.disabled=true;
        try{
          const data=await api('GET','cosmetics/grants?public_id='+encodeURIComponent(publicId));
          grantList.innerHTML=(data.grants||[]).map(item=>
            '<div class="row"><span>'+esc(item.name)+' · '+esc(item.item_id)+'</span>'+
            '<button class="btn s" data-cos-revoke="'+esc(item.item_id)+'" type="button">Remove</button></div>'
          ).join('')||'<p class="n">No administrator-granted items found for this ID.</p>';
          revokeNote.textContent='Only explicit admin gifts are listed; purchases cannot be revoked here.';
          grantList.querySelectorAll('[data-cos-revoke]').forEach(button=>{
            button.onclick=async()=>{
              const itemId=button.dataset.cosRevoke;
              const reason=window.prompt('Why are you removing this item? (8–200 characters)');
              if(reason===null)return;
              if(reason.trim().length<8||reason.trim().length>200){
                revokeNote.textContent='A reason of 8–200 characters is required.';return;
              }
              if(!window.confirm('Remove '+itemId+' from member '+publicId+'? This is audited.'))return;
              button.disabled=true;
              try{
                await api('POST','cosmetics/revoke',{public_id:publicId,item_id:itemId,reason:reason.trim()});
                await loadMemberGrants();
                revokeNote.textContent='Removed and audited: '+itemId;
              }catch(error){revokeNote.textContent='Removal failed: '+error.message;
                button.disabled=false;}
            };
          });
        }catch(error){revokeNote.textContent='Could not find grants: '+error.message;}
        finally{finder.disabled=false;}
      }
      finder.onclick=loadMemberGrants;
    }catch(error){status.textContent='Cosmetics unavailable: '+error.message;}
  };

  // Revive the former placeholder Store and Medals pages too.
  P.store=P.cosmetics;
  P.md=P.cosmetics;

  // Premium policies are stored in D1, not localStorage. Super Admin can
  // enable/disable all three acquisition routes and configure every tier.
  P.premium=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>👑 VIP / SVIP / Noble</h3>'+
      '<p class="n">Automatic gift/level qualification, coin purchases and admin grants '+
      'have independent switches. Changes affect new eligibility immediately; '+
      'past wallet receipts remain unchanged.</p><div id="sh-premium-settings">Loading…</div></div>'+
      '<div class="card"><h3>🔎 Member lookup & admin grant</h3>'+
      '<p class="n">Use the real eight-digit Sharika ID. Only Super Admin can grant or revoke.</p>'+
      '<input class="field" id="sh-premium-id" inputmode="numeric" maxlength="8" placeholder="8-digit user ID">'+
      '<button class="btn" id="sh-premium-lookup" type="button">Check member</button>'+
      '<div id="sh-premium-member" class="n"></div>'+
      (role==='super'?'<div class="row"><label>Grant tier <select id="sh-premium-grant-tier">'+
        '<option value="vip">VIP</option><option value="svip">SVIP</option>'+
        '<option value="noble">Noble</option><option value="none">Revoke manual/purchased tier</option>'+
        '</select></label><label>SVIP level <select id="sh-premium-grant-level" class="field" aria-label="SVIP level 1 to 8">'+
        Array.from({length:8},(_,i)=>'<option value="'+(i+1)+'">SVIP '+(i+1)+'</option>').join('')+
        '</select></label><label>Days <input id="sh-premium-grant-days" class="field" '+
        'type="number" min="1" max="365" value="30"></label></div>'+
        '<button class="btn s" id="sh-premium-grant" type="button">Confirm admin assignment</button>':'')+
      '<div id="sh-premium-result" role="status" class="n"></div>'+ 
      '<p class="n">SVIP 1–8 uses the eight verified animated frames, medals and nameplates. '+
      'A free admin grant adds the matching frame, entry, medal and nameplate to My Backpack. '+
      'Paid SVIP passes last 30 days. Users can equip any other owned frame later.</p></div>';
    const settingsRoot=byId('sh-premium-settings'),result=byId('sh-premium-result');
    let data;
    try{data=await api('GET','premium');}
    catch(error){settingsRoot.textContent='Premium config unavailable: '+error.message;return;}
    if(!settingsRoot.isConnected)return;
    const controls=[
      ['purchase_enabled','Coin purchases'],['admin_grant_enabled','Admin grants'],
      ['auto_enabled','Automatic qualification'],['auto_by_level','Qualify by wealth level'],
      ['auto_by_gifts','Qualify by gifts sent']
    ];
    settingsRoot.innerHTML='<div class="row" style="display:flex;flex-wrap:wrap;gap:15px">'+
      controls.map(([key,label])=>'<label><input type="checkbox" data-pr-policy="'+key+'" '+
        (data.config.policy[key]?'checked':'')+(role==='super'?'':' disabled')+'> '+label+'</label>').join('')+
      '</div><div style="overflow-x:auto"><table style="width:100%;min-width:630px;text-align:left">'+
      '<thead><tr><th>Tier</th><th>Wealth Lv.</th><th>Gift coins</th><th>Buy price</th>'+
      '<th>Days</th><th>Daily bonus</th></tr></thead><tbody>'+
      (data.config.tiers||[]).map(t=>'<tr data-premium-tier="'+esc(t.tier)+'"><td><b>'+esc(t.tier.toUpperCase())+'</b></td>'+
        [['min_wealth_level',t.min_wealth_level],['min_gift_coins',t.min_gift_coins],
          ['price_coins',t.price_coins],['duration_days',t.duration_days],
          ['daily_bonus_coins',t.daily_bonus_coins]].map(([key,value])=>
          '<td><input type="number" inputmode="numeric" class="field" '+
          'data-premium-field="'+key+'" style="width:95px" min="0" value="'+esc(value)+'" '+
          (role==='super'?'':'disabled')+'></td>').join('')+'</tr>').join('')+
      '</tbody></table></div>'+
      '<p class="n">SVIP uses the prices below, not the legacy SVIP tier price above. '+
      'Every user purchase lasts 30 days; daily bonuses reset each UTC day.</p>'+
      '<h3>♛ SVIP 1–8 · Pass prices & Daily Rewards</h3>'+
      '<div style="overflow-x:auto"><table style="width:100%;min-width:490px;text-align:left">'+
      '<thead><tr><th>Level</th><th>30-day price</th><th>Daily reward</th><th>Sell</th></tr></thead><tbody>'+
      (data.config.svip_levels||[]).map(level=>'<tr data-svip-level="'+level.level+'">'+
        '<td><b>SVIP '+level.level+'</b></td>'+
        '<td><input type="number" inputmode="numeric" min="1" max="1000000000" class="field" '+
        'data-svip-field="price_coins" value="'+esc(level.price_coins)+'" '+(role==='super'?'':'disabled')+'></td>'+
        '<td><input type="number" inputmode="numeric" min="0" max="1000000" class="field" '+
        'data-svip-field="daily_bonus_coins" value="'+esc(level.daily_bonus_coins)+'" '+(role==='super'?'':'disabled')+'></td>'+
        '<td><input type="checkbox" data-svip-enabled '+(level.enabled?'checked':'')+
        (role==='super'?'':' disabled')+'></td></tr>').join('')+
      '</tbody></table></div>'+
      (role==='super'?'<button class="btn s" id="sh-premium-save" type="button">Save premium rules</button>':'')+
      '<p class="n" id="sh-premium-config-note">UTC day reset · bonus claims recorded in wallet ledger.</p>';
    byId('sh-premium-save')?.addEventListener('click',async event=>{
      const button=event.currentTarget;
      const policy=Object.fromEntries(controls.map(([key])=>
        [key,!!settingsRoot.querySelector('[data-pr-policy="'+key+'"]')?.checked]));
      const tiers=[...settingsRoot.querySelectorAll('[data-premium-tier]')].map(row=>{
        const entry={tier:row.dataset.premiumTier};
        row.querySelectorAll('[data-premium-field]').forEach(field=>{
          entry[field.dataset.premiumField]=Number(field.value);
        });
        return entry;
      });
      const svip_levels=[...settingsRoot.querySelectorAll('[data-svip-level]')].map(row=>({
        level:Number(row.dataset.svipLevel),
        price_coins:Number(row.querySelector('[data-svip-field="price_coins"]')?.value),
        daily_bonus_coins:Number(row.querySelector('[data-svip-field="daily_bonus_coins"]')?.value),
        enabled:!!row.querySelector('[data-svip-enabled]')?.checked
      }));
      if(svip_levels.length!==8){byId('sh-premium-config-note').textContent='SVIP table unavailable';return;}
      if(!window.confirm('Save eight SVIP prices, daily coins and membership rules?'))return;
      button.disabled=true;
      try{await api('PATCH','premium',{policy,tiers,svip_levels});
        byId('sh-premium-config-note').textContent='Premium configuration saved and audited ✓';
      }catch(error){byId('sh-premium-config-note').textContent='Not saved: '+error.message;}
      finally{button.disabled=false;}
    });
    async function lookup(){
      const id=byId('sh-premium-id')?.value.trim()||'';
      if(!/^[0-9]{8}$/.test(id)){result.textContent='Enter a verified 8-digit ID';return;}
      const member=byId('sh-premium-member');member.textContent='Checking…';
      try{
        const response=await api('GET','premium?public_id='+id);
        const person=response.member;
        member.textContent=person?'ID '+id+' · '+person.tier.toUpperCase()+
          (person.svip_level?' '+person.svip_level:'')+' · '+person.source+' · Wealth Lv.'+person.wealth_level+
          ' · Sent gifts '+fmt(person.gift_coins)+' coins':'Member unavailable';
      }catch(error){member.textContent='Member unavailable: '+error.message;}
    }
    byId('sh-premium-lookup').onclick=lookup;
    const levelSelect=byId('sh-premium-grant-level');
    const tierSelect=byId('sh-premium-grant-tier');
    if(levelSelect&&tierSelect){
      const updateLevel=()=>{levelSelect.disabled=tierSelect.value!=='svip';};
      tierSelect.addEventListener('change',updateLevel);updateLevel();
    }
    byId('sh-premium-grant')?.addEventListener('click',async event=>{
      const id=byId('sh-premium-id')?.value.trim()||'';
      const tier=byId('sh-premium-grant-tier')?.value;
      const days=Number(byId('sh-premium-grant-days')?.value);
      const svipLevel=Number(byId('sh-premium-grant-level')?.value||1);
      if(!/^[0-9]{8}$/.test(id)||!['vip','svip','noble','none'].includes(tier)||
        (tier!=='none'&&(!Number.isInteger(days)||days<1||days>365))||
        (tier==='svip'&&(!Number.isInteger(svipLevel)||svipLevel<1||svipLevel>8))){
        result.textContent='Check the ID and duration (1–365 days).';return;
      }
      if(!window.confirm(tier==='none'?'Revoke the assigned membership for '+id+'?':
        'Grant '+tier.toUpperCase()+(tier==='svip'?' '+svipLevel:'')+
        ' to '+id+' for '+days+' days?'))return;
      event.currentTarget.disabled=true;
      try{await api('POST','premium/grant',{public_id:id,tier,duration_days:days,
        ...(tier==='svip'?{svip_level:svipLevel}:{})});
        result.textContent='Membership updated and audited ✓';await lookup();
      }catch(error){result.textContent='Not changed: '+error.message;}
      finally{if(event.currentTarget.isConnected)event.currentTarget.disabled=false;}
    });
  };

  // CP/Friendship policy is independent of ordinary room gifts. Only the
  // verified Super Admin can change prices or enabled status; Finance reads.
  async function renderCpRewardAdmin(){
    const root=byId('sh-cp-reward-settings');if(!root)return;
    let data;
    try{data=await api('GET','bonds/rewards');}
    catch(error){root.textContent='CP rewards unavailable: '+error.message+
      ' (staging migration 0035 may be pending)';return;}
    if(!root.isConnected)return;
    const editable=role==='super';
    const items=data.assets||[];
    const options=(kind,selected)=>'<option value="">No '+(kind==='frame_style'?'frame':'medal')+'</option>'+
      items.filter(x=>x.kind===kind).map(x=>'<option value="'+esc(x.id)+'" '+
        (x.id===selected?'selected':'')+'>'+esc(x.name)+'</option>').join('');
    const rows=(data.rules||[]).map(rule=>'<div class="row" style="align-items:end;'+
      'border-bottom:1px solid #ffffff24;padding:10px 0;flex-wrap:wrap">'+
      '<strong style="min-width:65px">TOP '+rule.rank+'</strong>'+
      '<label>Coins each<input class="field" style="width:120px" type="number" min="0" max="1000000" '+
      'id="sh-cp-coins-'+rule.rank+'" value="'+esc(rule.coins_each)+'" '+(editable?'':'disabled')+'></label>'+
      '<label>Special frame<select class="field" id="sh-cp-frame-'+rule.rank+'" '+
      (editable?'':'disabled')+'>'+options('frame_style',rule.frame_item_id)+'</select></label>'+
      '<label>Medal<select class="field" id="sh-cp-medal-'+rule.rank+'" '+
      (editable?'':'disabled')+'>'+options('medal_style',rule.medal_item_id)+'</select></label></div>').join('');
    const last=data.last_week||{};
    root.innerHTML='<p class="n">Each partner receives the configured coins, special frame and medal. '+
      'Frames/medals are permanent Store entitlements, not replacements for purchased items. '+
      'Changes affect future settlement only; paid weeks are immutable.</p>'+
      '<label><input type="checkbox" id="sh-cp-enabled" '+(data.policy?.enabled?'checked ':'')+
      (editable?'':'disabled')+'> Enable weekly CP rewards</label><br>'+
      '<label><input type="checkbox" id="sh-cp-auto" '+(data.policy?.auto_award?'checked ':'')+
      (editable?'':'disabled')+'> Automatically settle after a full eligible week</label>'+
      '<p class="n">Automatic rewards begin with the next complete UTC Monday–Sunday week when first activated. '+
      'Previous weeks require an explicit Super Admin action.</p>'+rows+
      (editable?'<button class="btn s" type="button" id="sh-cp-rewards-save">Save TOP 1–7 prizes</button> ':'')+
      '<p class="n" id="sh-cp-rewards-note">'+(data.policy?.enabled?'Rewards enabled':'Rewards disabled')+'</p>'+
      '<div class="card"><h3>🏆 Last completed week</h3><p class="n">'+
      new Date(last.start_ms).toISOString().slice(0,10)+' · '+
      (last.awarded?'Awarded and locked':'Not yet awarded')+'</p>'+
      (last.leaders||[]).map(pair=>'<p class="n">#'+pair.rank+' · '+
        esc(pair.a.name)+' & '+esc(pair.b.name)+' · '+fmt(pair.total)+' verified CP coins</p>').join('')+
      (!(last.leaders||[]).length?'<p class="n">No eligible verified CP pairs.</p>':'')+
      (editable?'<button type="button" class="btn s" id="sh-cp-award-last" '+
        (!data.policy?.enabled||last.awarded?'disabled':'')+'>Award last completed week once</button>':'')+'</div>'+
      '<div class="card"><h3>📜 Weekly payout receipts</h3>'+
      (data.history||[]).map(batch=>'<p class="n">'+
        new Date(Number(batch.week_start_ms)).toISOString().slice(0,10)+' · '+
        Number(batch.winner_count)+' CP pairs · '+esc(batch.issued_by)+'</p>').join('')+
      (!(data.history||[]).length?'<p class="n">No paid weeks yet.</p>':'')+'</div>';
    byId('sh-cp-rewards-save')?.addEventListener('click',async event=>{
      const rules=[];
      for(let rank=1;rank<=7;rank++){
        const coins_each=Number(byId('sh-cp-coins-'+rank).value);
        if(!Number.isSafeInteger(coins_each)||coins_each<0||coins_each>1_000_000){
          byId('sh-cp-rewards-note').textContent='Coins must be 0–1,000,000 per partner.';return;}
        rules.push({rank,coins_each,frame_item_id:byId('sh-cp-frame-'+rank).value||null,
          medal_item_id:byId('sh-cp-medal-'+rank).value||null});
      }
      const enabled=byId('sh-cp-enabled').checked,auto_award=byId('sh-cp-auto').checked;
      if(!window.confirm('Save weekly CP TOP 1–7 reward rules?'))return;
      const button=event.currentTarget;button.disabled=true;
      try{await api('PATCH','bonds/rewards',{enabled,auto_award,rules});
        note('CP reward rules saved ✓');await renderCpRewardAdmin();}
      catch(error){byId('sh-cp-rewards-note').textContent='Not saved: '+error.message;
        button.disabled=false;}
    });
    byId('sh-cp-award-last')?.addEventListener('click',async event=>{
      if(!window.confirm('FINAL CONFIRMATION: Credit BOTH partners of each eligible TOP 1–7 CP pair '+
        'and grant configured frames/medals for the completed UTC week? This cannot be undone.'))return;
      const button=event.currentTarget;button.disabled=true;
      try{const result=await api('POST','bonds/rewards/settle',{confirm:true});
        note(result.duplicate?'This week was already awarded':
          'CP reward complete · '+result.winner_count+' pairs');await renderCpRewardAdmin();}
      catch(error){note('Not awarded: '+error.message);button.disabled=false;}
    });
  }

  P.bonds=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>💞 Royal CP & Friendship Gifts</h3>'+
      '<p class="n">CP is one active partner per person. Friendship supports multiple partners. '+
      'Each gift holds coins until accepted; decline/expiry creates a ledger refund.</p>'+
      '<div id="sh-admin-bond-policy">Loading verified bond rules…</div></div>'+
      '<div class="card"><h3>🎁 CP / Friendship Gift Catalog</h3>'+
      '<div id="sh-admin-bond-gifts">Loading gift prices…</div></div>'+
      '<div class="card"><h3>👑 CP TOP 1–7 Weekly Ranking Rewards</h3>'+
      '<div id="sh-cp-reward-settings">Loading reward rules…</div></div>'+
      '<div class="card"><h3>📜 Recent Relationship Audit</h3>'+
      '<div id="sh-admin-bond-audit">Loading…</div></div>';
    void renderCpRewardAdmin();
    const policyRoot=byId('sh-admin-bond-policy');
    const giftRoot=byId('sh-admin-bond-gifts');
    const auditRoot=byId('sh-admin-bond-audit');
    let data;
    try{data=await api('GET','bonds');}
    catch(error){policyRoot.textContent='Bond settings unavailable: '+error.message;
      giftRoot.textContent='Deployment and migration 0029 must be ready.';return;}
    if(!root.isConnected)return;
    const editable=role==='super';
    const policy=data.policy||{};
    const control=(field,label,checked)=>'<label style="display:flex;align-items:center;gap:10px;margin:12px 0">'+
      '<input type="checkbox" id="sh-bond-'+field+'" '+(checked?'checked ':'')+
      (editable?'':'disabled ')+'>'+esc(label)+'</label>';
    policyRoot.innerHTML=control('cp','Enable CP gifts',policy.cp_enabled)+
      control('friendship','Enable Friendship gifts',policy.friendship_enabled)+
      '<label>Invitation expiry (hours, 1–168) '+
      '<input id="sh-bond-expiry" type="number" class="field" min="1" max="168" '+
      'value="'+esc(policy.expiry_hours)+'" '+(editable?'':'disabled')+'></label>'+
      (editable?'<button class="btn s" id="sh-bond-policy-save" type="button">Save CP & Friendship policy</button>':'')+
      '<p class="n" id="sh-bond-policy-note">Only future invitations use a changed expiry period.</p>';
    byId('sh-bond-policy-save')?.addEventListener('click',async event=>{
      const expiry_hours=Number(byId('sh-bond-expiry').value);
      if(!Number.isSafeInteger(expiry_hours)||expiry_hours<1||expiry_hours>168){
        byId('sh-bond-policy-note').textContent='Choose 1–168 hours.';return;}
      if(!window.confirm('Save relationship invitation rules?'))return;
      const button=event.currentTarget;button.disabled=true;
      try{await api('PATCH','bonds',{
        cp_enabled:byId('sh-bond-cp').checked,
        friendship_enabled:byId('sh-bond-friendship').checked,expiry_hours});
        byId('sh-bond-policy-note').textContent='Saved and audited ✓';
      }catch(error){byId('sh-bond-policy-note').textContent='Not saved: '+error.message;}
      finally{if(button.isConnected)button.disabled=false;}
    });
    giftRoot.replaceChildren();
    for(const gift of data.gifts||[]){
      const row=document.createElement('div');
      row.className='row';row.style.cssText='padding:12px 0;border-bottom:1px solid #ffffff25;'+
        'display:flex;flex-wrap:wrap;gap:9px;align-items:center';
      const label=document.createElement('strong');
      label.textContent=(gift.type==='cp'?'💗 CP':'🤝 Friendship')+' · '+gift.emoji+' '+gift.name;
      const price=document.createElement('input');price.type='number';price.min='1';
      price.max='1000000000';price.className='field';price.value=gift.price_coins;
      price.style.width='125px';price.disabled=!editable;
      const active=document.createElement('input');active.type='checkbox';
      active.checked=gift.active;active.disabled=!editable;
      const activeLabel=document.createElement('label');activeLabel.textContent='Active ';
      activeLabel.appendChild(active);
      row.append(label,price,activeLabel);
      if(editable){const save=document.createElement('button');save.type='button';
        save.className='btn s';save.textContent='Save gift';
        save.onclick=async()=>{
          const value=Number(price.value);
          if(!Number.isSafeInteger(value)||value<1||value>1_000_000_000){
            note('Gift price must be between 1 and 1,000,000,000 coins');return;}
          if(!window.confirm('Save '+gift.name+' price and availability?'))return;
          save.disabled=true;
          try{await api('PATCH','bonds/gifts/'+gift.id,{price_coins:value,active:active.checked});
            note('Bond gift saved and audited ✓');
          }catch(error){note('Not saved: '+error.message);}
          finally{save.disabled=false;}
        };row.appendChild(save);}
      giftRoot.appendChild(row);
    }
    const audit=data.audit||[];
    auditRoot.innerHTML=audit.length?audit.map(entry=>
      '<div class="n" style="padding:7px 0;border-bottom:1px solid #ffffff20">'+
      esc(entry.action)+' · ID '+esc(entry.actor_id)+' · '+
      esc(new Date(entry.created_at_ms).toLocaleString())+'</div>').join(''):
      '<p class="n">No relationship activity recorded yet.</p>';
  };

  P.sellers=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>🪙 Verified coin sellers</h3>'+
      '<p class="n">Seller stock is separate from personal wallets. Allocations and transfers are permanently audited.</p>'+
      '<div id="seller-list">Loading…</div></div>'+
      '<div class="card"><h3>Coin transfer list · sender IDs</h3><div id="seller-transfers">Loading…</div></div>'+
      '<div class="card"><h3>Seller wallet allocations</h3><div id="seller-allocations">Loading…</div></div>'+
      (role==='super'?'<div class="card"><h3>Seller management</h3>'+
        '<div class="row"><input id="seller-id" maxlength="8" inputmode="numeric" placeholder="Seller 8-digit user ID">'+
        '<button type="button" class="btn s" id="seller-approve">Approve</button>'+
        '<button type="button" class="btn s" id="seller-suspend">Suspend</button></div>'+
        '<div class="row"><input id="seller-coins" inputmode="numeric" placeholder="Coin stock to allocate (max 1,000,000,000)">'+
        '<button type="button" class="btn s" id="seller-allocate">Allocate stock</button></div>'+
         '<div class="row"><button type="button" class="btn s" id="seller-unlimited-on">Enable ∞ stock</button>'+
         '<button type="button" class="btn s" id="seller-unlimited-off">Disable ∞ stock</button></div>'+
         '<p class="n">Unlimited mode is Super Admin-only. Every transfer is still logged. Maximum 1M coins per transfer.</p>'+
        '<p class="n" id="seller-note">Only Super Admin can approve sellers and allocate inventory.</p></div>':'');
    const table=byId('seller-list'),transfers=byId('seller-transfers'),
      allocations=byId('seller-allocations');
    async function refresh(){
      table.textContent='Loading approved seller records…';
      transfers.textContent='Loading verified transfers…';
      allocations.textContent='Loading verified seller stock credits…';
      try{
        const [list,history,credits]=await Promise.all([
          api('GET','sellers'),api('GET','sellers/transfers'),api('GET','sellers/allocations')
        ]);
        table.innerHTML=window.T(['ID','Name','Status','Available stock','Updated'],(list.sellers||[]).map(s=>
          [esc(s.public_id),esc(s.name),s.active?'Approved':'Suspended',
           s.unlimited_stock?'∞ Unlimited · reserve '+fmt(s.available_coins):fmt(s.available_coins),
           esc(s.updated_at||'')]));
        transfers.innerHTML=window.T(['#','Sender ID','Recipient ID','Coins','Stock after','Time'],
          (history.transfers||[]).map(t=>[
            esc(t.id),esc(t.sender_public_id),esc(t.recipient_public_id),
            fmt(t.coins),fmt(t.stock_after),esc(t.created_at||'')]));
        allocations.innerHTML=window.T(['#','Admin sender ID','Seller ID','Stock coins added','Stock after','Time'],
          (credits.allocations||[]).map(a=>[
            esc(a.id),esc(a.sender_public_id),esc(a.seller_public_id),
            fmt(a.coins),fmt(a.stock_after),esc(a.created_at||'')]));
        if(!list.sellers?.length)table.insertAdjacentHTML('beforeend','<p class="n">No approved sellers yet.</p>');
      }catch(error){
        table.textContent=error.message;
        transfers.textContent='Transfer history unavailable.';
        allocations.textContent='Allocation history unavailable.';
      }
    }
    await refresh();
    if(role!=='super')return;
    const note=byId('seller-note'),idInput=byId('seller-id'),coinsInput=byId('seller-coins');
    let busy=false;
    async function act(button,kind){
      if(busy)return;
      const sellerId=idInput.value.trim();
      const raw=coinsInput.value.trim();
      const coins=Number(raw);
      if(!/^[0-9]{8}$/.test(sellerId)){
        note.textContent='Enter an existing eight-digit user ID.';return;
      }
      if(kind==='allocate'&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(coins)||coins<1||coins>1000000000)){
        note.textContent='Allocate 1–1,000,000,000 coins, or enable Unlimited Stock.';return;
      }
      const isStockMode=kind==='unlimited_on'||kind==='unlimited_off';
      const reason=isStockMode?window.prompt('Reason for unlimited stock change (8–200 characters):',''):null;
      if(isStockMode&&(!reason||reason.trim().length<8||reason.trim().length>200)){
        note.textContent='A reason of 8–200 characters is required.';return;
      }
      const message=kind==='allocate'
        ?'Add '+fmt(coins)+' coins to the SELLER STOCK of '+sellerId+'? This does not debit any user.'
        :isStockMode
          ?(kind==='unlimited_on'?'ENABLE':'DISABLE')+' unlimited stock for seller '+sellerId+
            '? The change is audited and requires Super Admin authority.'
          :(kind==='approve'?'Approve':'Suspend')+' coin seller '+sellerId+'?';
      if(!window.confirm(message))return;
      busy=true;button.disabled=true;note.textContent='Submitting verified request…';
      try{
        const payload=kind==='allocate'
          ?{seller_public_id:sellerId,coins,request_id:'admin-seller:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2)}
          :isStockMode
            ?{seller_public_id:sellerId,unlimited_stock:kind==='unlimited_on',reason:reason.trim()}
            :{target_public_id:sellerId,active:kind==='approve'};
        const endpoint=kind==='allocate'?'sellers/allocate':isStockMode?'sellers/stock-mode':'sellers';
        const result=await api('POST',endpoint,payload);
        note.textContent=kind==='allocate'?'Allocated '+fmt(coins)+' stock coins. New stock '+fmt(result.available_coins)+'.':
          isStockMode?'Seller '+sellerId+' unlimited stock '+(result.unlimited_stock?'enabled':'disabled')+' and audited.':
          'Seller '+sellerId+' '+(kind==='approve'?'approved':'suspended')+'.';
        await refresh();
      }catch(error){note.textContent='Request rejected: '+error.message;}
      finally{busy=false;button.disabled=false;}
    }
    byId('seller-approve')?.addEventListener('click',e=>act(e.currentTarget,'approve'));
    byId('seller-suspend')?.addEventListener('click',e=>act(e.currentTarget,'suspend'));
    byId('seller-allocate')?.addEventListener('click',e=>act(e.currentTarget,'allocate'));
    byId('seller-unlimited-on')?.addEventListener('click',e=>act(e.currentTarget,'unlimited_on'));
    byId('seller-unlimited-off')?.addEventListener('click',e=>act(e.currentTarget,'unlimited_off'));
  };

  P.ledger=async function () {
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>Wallet ledger</h3><div class="row"><input id="ledger-id" inputmode="numeric" placeholder="Optional 8-digit user ID"><button class="btn s" id="ledger-go">Search</button></div><div id="ledger-list">Loading…</div></div>';
    const output=byId('ledger-list'),field=byId('ledger-id');
    async function refresh() {
      output.textContent='Loading verified transaction history…';
      try {
        const id=field.value.trim();
        if(id&&!/^[0-9]{8}$/.test(id))throw new Error('Enter a valid eight-digit Sharika ID');
        const data=await api('GET','ledger'+(id?'?public_id='+id:''));
        output.innerHTML=window.T(['Entry','User','Currency','Change','Balance','Reason','Time'],
          (data.ledger||[]).map(x=>[fmt(x.id),esc(x.public_id),esc(x.currency),
            fmt(x.delta),fmt(x.balance_after),esc(x.reason),esc(x.created_at)]));
      } catch(error){output.textContent=error.message;}
    }
    byId('ledger-go').onclick=refresh;
    await refresh();
  };
  P.support=async function () {
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>Verified support inbox</h3>'+
      '<p class="n">Messages are stored in the Sharika D1 database. No demo tickets.</p>'+
      '<button type="button" class="btn s" id="support-refresh">Refresh</button>'+
      '<div id="support-list">Loading…</div></div><div id="support-thread"></div>';
    const list=byId('support-list'),thread=byId('support-thread');
    let opened=null;
    async function refreshList(){
      try {
        const data=await api('GET','support');
        list.innerHTML=window.T(['User ID','Name','Messages','Latest message','Open'],
          (data.conversations||[]).map(c=>[
            esc(c.public_id),esc(c.name),fmt(c.message_count),
            esc(String(c.last_body||'').slice(0,140)),
            '<button type="button" class="btn s" data-support-id="'+esc(c.public_id)+'">Open</button>'
          ]));
      }catch(error){list.textContent=error.message;}
    }
    async function refreshThread(){
      if(!opened)return;
      try{
        const data=await api('GET','support/'+encodeURIComponent(opened));
        const rows=(data.messages||[]).map(m=>[
          m.sender_role==='admin'?'Admin':'User',esc(m.body),esc(m.created_at)
        ]);
        thread.innerHTML='<div class="card"><h3>Support: '+esc(data.user.name)+
          ' (ID '+esc(data.user.public_id)+')</h3>'+
          window.T(['From','Message','Sent'],rows)+
          '<div class="row"><input id="support-reply-text" maxlength="1000" '+
          'placeholder="Reply to this user" aria-label="Support reply">'+
          '<button type="button" class="btn s" id="support-send">Send reply</button></div></div>';
        byId('support-send').onclick=async()=>{
          const button=byId('support-send');
          const body=byId('support-reply-text').value.trim();
          if(!body){note('Write a reply first.');return;}
          button.disabled=true;
          try{
            const request_id='adm:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
            await api('POST','support/'+encodeURIComponent(opened)+'/reply',{body,request_id});
            note('Support reply sent');
            await refreshThread();await refreshList();
          }catch(error){note('Reply failed: '+error.message);button.disabled=false;}
        };
      }catch(error){thread.textContent='Conversation unavailable: '+error.message;}
    }
    list.onclick=e=>{
      const button=e.target.closest('button[data-support-id]');
      if(!button)return;
      opened=button.dataset.supportId;
      refreshThread();
    };
    byId('support-refresh').onclick=async()=>{await refreshList();await refreshThread();};
    await refreshList();
  };

  P.gifts=async function () {
    const root=byId('pg');
    const canEdit=role==='super';
    root.innerHTML=(canEdit?mediaStudio('gift-media')+'<div class="card"><h3>Add gift to real catalog</h3>'+
      '<p class="n">Regular gifts are settled through the verified wallet ledger. Lucky payouts are still disabled.</p>'+
      '<div class="row"><input id="gift-name" maxlength="80" placeholder="Gift name" aria-label="Gift name">'+
      '<input id="gift-emoji" maxlength="16" placeholder="🎁" aria-label="Gift emoji">'+
      '<input id="gift-price" type="number" min="1" step="1" placeholder="Coin price" aria-label="Coin price">'+
      '<select id="gift-category" aria-label="Gift category"><option value="0">Gifts</option>'+
      '<option value="1">Luxury</option><option value="2">Lucky</option></select>'+
      '<button type="button" id="gift-create" class="btn s">Add gift</button></div>'+
      '<div class="row"><input id="gift-image-url" type="url" maxlength="500" placeholder="HTTPS gift image link" aria-label="Gift image URL">'+
      '<input id="gift-animation-url" type="url" maxlength="500" placeholder="HTTPS animation link (optional)" aria-label="Gift animation URL"></div>'+
      '<input class="field" id="gift-audio-url" type="url" maxlength="500" placeholder="Optional separate gift sound URL">'+
      '<p class="n">Upload video with embedded music or add a separate sound. New gifts stay inactive until you review and enable them.</p></div>':'')+
      '<div class="card"><h3>Real gift catalog</h3><div id="gift-list">Loading…</div></div>'+
      '<div class="card"><h3>Verified gift transactions</h3><div id="gift-event-list">Loading…</div></div>'+
      '<div class="card"><h3>Gift wallet settlement audit</h3>'+
      '<p class="n">Read-only D1 transaction audit. Recipient diamonds may include fractional accrual; room shares are not credited to the owner wallet.</p>'+
      '<div id="gift-settlement-list">Loading…</div></div>';
    if(canEdit)wireMediaStudio('gift-media',[
      ['gift-image-url','New gift · image'],['gift-animation-url','New gift · video'],
      ['gift-audio-url','New gift · separate sound']]);
    const list=byId('gift-list');
    async function refresh(){
      list.textContent='Loading verified gift catalog…';
      try{
        const data=await api('GET','gifts');
        list.innerHTML=window.T(['ID','Name','Emoji','Category','Coins','Media URLs','Active','Action'],
          (data.gifts||[]).map(g=>{
            if(!canEdit)return[fmt(g.id),esc(g.name),esc(g.emoji),
              ['Gifts','Luxury','Lucky'][g.tab]||'Other',fmt(g.price_coins),
              [g.image_url?'🖼️ Image':'',g.animation_url?'🎬 Video':'',g.audio_url?'🎵 Sound':''].filter(Boolean).join(' ')||'—',g.active?'Active':'Disabled','—'];
            const id=esc(g.id),input=(key,value,max=100)=>
              '<input class="field" data-gift-field="'+key+'" data-id="'+id+
              '" maxlength="'+max+'" value="'+esc(value??'')+'" style="min-width:100px;max-width:180px">';
            return[fmt(g.id),input('name',g.name,80),input('emoji',g.emoji,16),
              '<select class="field" data-gift-field="tab" data-id="'+id+'">'+
                ['Gifts','Luxury','Lucky'].map((n,i)=>'<option value="'+i+'"'+
                  (i===Number(g.tab)?' selected':'')+'>'+n+'</option>').join('')+'</select>',
              '<input class="field" type="number" min="1" max="1000000000" data-gift-field="price" data-id="'+id+
                '" value="'+Number(g.price_coins)+'" style="width:115px">',
              '<div>'+input('image',g.image_url||'',500)+input('animation',g.animation_url||'',500)+input('audio',g.audio_url||'',500)+'</div>',
              '<label><input type="checkbox" data-gift-field="active" data-id="'+id+'"'+
                (g.active?' checked':'')+'> Live</label>',
              '<button type="button" class="btn s" data-gift-save="'+id+'">Save</button>'];
          }));
      }catch(error){list.textContent='Gift catalog unavailable: '+error.message;}
    }
    if(canEdit){
      byId('gift-create').onclick=async()=>{
        const button=byId('gift-create'),name=byId('gift-name').value.trim();
        const price=Number(byId('gift-price').value);
        const emoji=byId('gift-emoji').value.trim()||'🎁',tab=Number(byId('gift-category').value);
        const image_url=byId('gift-image-url').value.trim();
        const animation_url=byId('gift-animation-url').value.trim();
        const audio_url=byId('gift-audio-url').value.trim();
        if(!name||!Number.isSafeInteger(price)||price<1){note('Enter gift name and valid coin price');return;}
        button.disabled=true;
        try{
          await api('POST','gifts',{name,emoji,tab,price_coins:price,active:false,image_url,animation_url,audio_url});
          ['gift-name','gift-price','gift-emoji','gift-image-url','gift-animation-url','gift-audio-url'].forEach(id=>byId(id).value='');
          note('Gift added; activate it when ready.');await refresh();
        }catch(error){note('Gift not created: '+error.message);}
        finally{button.disabled=false;}
      };
      list.onclick=async e=>{
        const button=e.target.closest('button[data-gift-save]');
        if(!button||button.disabled)return;
        const id=button.dataset.giftSave;
        const controls=Array.from(list.querySelectorAll('[data-gift-field]'));
        const field=name=>controls.find(el=>el.dataset.id===id&&el.dataset.giftField===name);
        const name=field('name')?.value.trim(),emoji=field('emoji')?.value.trim()||'🎁';
        const price=Number(field('price')?.value),tab=Number(field('tab')?.value);
        if(!name||name.length>80||emoji.length>16||!Number.isSafeInteger(price)||
          price<1||price>1000000000||![0,1,2].includes(tab)){
          note('Enter valid gift name, emoji, category and coin price');return;
        }
        const payload={name,emoji,price_coins:price,tab,
          image_url:field('image')?.value.trim()||'',
          animation_url:field('animation')?.value.trim()||'',
          audio_url:field('audio')?.value.trim()||'',
          active:!!field('active')?.checked};
        if(!window.confirm('Save gift #'+id+' on the server? This changes future sends.'))return;
        button.disabled=true;
        try{await api('PATCH','gifts/'+encodeURIComponent(id),payload);
          note('Gift updated and audited ✓');await refresh();}
        catch(error){note('Gift update failed: '+error.message);button.disabled=false;}
      };
    }
    await refresh();
    const giftHistory=byId('gift-event-list');
    if(role==='super'||role==='finance') {
      try {
        const history=await api('GET','gift-events');
        giftHistory.innerHTML=window.T(
          ['Time','Room','Sender','Recipient','Gift','Quantity','Coins'],
          (history.events||[]).map(e=>[
            esc(e.created_at),esc(e.room_id),esc(e.sender_id),
            esc(e.recipient_id),esc(e.emoji)+' '+esc(e.gift),
            fmt(e.quantity),fmt(e.coins)
          ]));
      }catch(error){giftHistory.textContent='Gift history unavailable: '+error.message;}
    }else giftHistory.textContent='Only Super Admin and Finance roles can view gift transactions.';
    const giftSettlements=byId('gift-settlement-list');
    if(role==='super'||role==='finance') {
      try {
        const data=await api('GET','gift-settlements');
        const diamondAmount=hundredths=>(Number(hundredths||0)/100).toFixed(2);
        giftSettlements.innerHTML=window.T(
          ['Time / #','Room','Sender','Gift','Recipients','Spent coins','Lucky payout','Recipient diamond accrual','Room share (coins)'],
          (data.settlements||[]).map(e=>[
            esc(e.created_at)+' / #'+fmt(e.transaction_id),
            esc(e.room_id),esc(e.sender_id),
            esc(e.emoji)+' '+esc(e.gift)+' ('+esc(e.kind)+')',
            fmt(e.recipient_count),fmt(e.spent_coins),
            e.lucky_payout_coins===null?'—':fmt(e.lucky_payout_coins),
            diamondAmount(e.recipient_diamond_hundredths),
            diamondAmount(e.room_reward_hundredths)
          ]));
      }catch(error){giftSettlements.textContent='Settlement audit unavailable: '+error.message;}
    }else giftSettlements.textContent='Only Super Admin and Finance roles can view wallet settlements.';
  };
  P.audit=async function () {
    const root=byId('pg');root.innerHTML=card('Admin audit','Loading…');
    try {
      const data=await api('GET','audit');
      root.innerHTML='<div class="card">'+window.T(['Time','Admin ID','Action','Details'],
        (data.audit||[]).map(a=>[esc(a.created_at),esc(a.actor_public_id||''),
          esc(a.action),esc(a.details_json)]))+'</div>';
    }catch(error){root.innerHTML=card('Admin audit unavailable',error.message);}
  };
  P.admins=async function () {
    const root=byId('pg');root.innerHTML=card('Admin roles','Loading…');
    if(role!=='super'){root.innerHTML=card('Admin accounts','Super Admin permission required.');return;}
    try {
      const [data,team]=await Promise.all([api('GET','roles'),api('GET','staff')]);
      const scopeFields=(prefix,id,selected=[])=>Object.entries(STAFF_SCOPES).map(([key,label])=>
        '<label style="display:inline-flex;gap:6px;align-items:center;margin:6px 12px 6px 0">'+
        '<input type="checkbox" data-staff-scope="'+esc(key)+'" data-staff-group="'+esc(id)+
        '"'+(selected.includes(key)?' checked':'')+'> '+esc(label)+'</label>').join('');
      const staffList=(team.staff||[]).map(item=>
        '<div class="card" data-staff-card="'+item.id+'" style="margin:12px 0">'+
        '<h4>'+esc(item.name)+' · '+(item.email.endsWith('@panel.sharika.invalid')?
          'Sharika ID '+esc(item.public_id||'') : esc(item.email))+'</h4>'+
        '<p class="n">Staff #'+fmt(item.id)+' · Created '+esc(item.created_at)+'</p>'+
        '<div>'+scopeFields('edit',item.id,item.permissions||[])+'</div>'+
        '<div class="row"><label>Max staff coins/day <input inputmode="numeric" data-staff-limit="'+item.id+
        '" value="'+esc(item.daily_coin_limit)+'"></label>'+
        '<label><input type="checkbox" data-staff-active="'+item.id+'"'+(item.active?' checked':'')+
        '> Login enabled</label>'+
        '<button class="btn s" type="button" data-staff-save="'+item.id+'">Save permissions</button></div>'+
        '</div>').join('');
      root.innerHTML='<div class="card"><h3>Protected application administrators</h3>'+
        '<p class="n">Existing Super, Finance and Support accounts are protected; staff users cannot promote themselves.</p>'+
        window.T(['User ID','Name','Role','Assigned'],(data.admins||[]).map(a=>[
          esc(a.public_id),esc(a.name),esc(a.role),esc(a.assigned_at)]))+'</div>'+
        '<div class="card"><h3>🔐 Give existing member admin-panel access</h3>'+
        '<p class="n">Enter the existing Sharika member ID. They sign in to the panel with their OWN Google/Firebase account. No new password is needed, and they only receive the permissions you select.</p>'+
        '<div class="row"><input id="staff-member-id" maxlength="8" inputmode="numeric" placeholder="Existing 8-digit Sharika ID" aria-label="Existing member ID"></div>'+
        '<div>'+scopeFields('member','member')+'</div>'+
        '<div class="row"><label>Maximum coins per day (if recharge enabled) <input id="staff-member-limit" inputmode="numeric" value="0"></label>'+
        '<button class="btn s" id="staff-member-create" type="button">Grant selected panel permissions</button></div>'+
        '<p id="staff-member-note" class="n" aria-live="polite"></p></div>'+
        '<div class="card"><h3>➕ Create staff login</h3>'+
        '<p class="n">Uses Firebase email/password. Passwords never reach the Sharika server or D1. Staff must verify their email before signing in.</p>'+
        '<div class="row"><input id="staff-name" maxlength="80" placeholder="Staff display name" aria-label="Staff name">'+
        '<input id="staff-email" type="email" placeholder="Staff email" aria-label="Staff email">'+
        '<input id="staff-password" type="password" minlength="12" autocomplete="new-password" placeholder="Temporary password (12+ characters)" aria-label="Staff password"></div>'+
        '<div>'+scopeFields('new','new')+'</div>'+
        '<div class="row"><label>Daily recharge limit <input id="staff-limit" inputmode="numeric" value="0"></label>'+
        '<button class="btn s" id="staff-create" type="button">Create account and invite</button></div>'+
        '<p class="n">Give each staff member a unique password privately. Revoke access at any time below.</p>'+
        '<p id="staff-note" class="n" aria-live="polite"></p></div>'+
        '<div class="card"><h3>Staff accounts and per-action permissions</h3>'+
        (staffList||'<p class="n">No staff accounts yet.</p>')+'</div>';
      const note=byId('staff-note');
      function picked(group){
        return Array.from(root.querySelectorAll('[data-staff-group="'+group+'"]:checked'))
          .map(field=>field.dataset.staffScope);
      }
      function validateLimit(raw,permissions){
        const limit=Number(raw);
        if(!/^\d+$/.test(raw)||!Number.isSafeInteger(limit)||limit<0||limit>10000000||
           (permissions.includes('coin_recharge')&&limit<1))
          throw new Error('Set a daily limit of 1–10,000,000 coins when recharge permission is enabled.');
        return limit;
      }
      const create=byId('staff-create');
      const memberButton=byId('staff-member-create');
      memberButton.onclick=async()=>{
        if(memberButton.disabled)return;
        const publicId=byId('staff-member-id').value.trim(),permissions=picked('member');
        const info=byId('staff-member-note');
        let limit;
        try{limit=validateLimit(byId('staff-member-limit').value.trim(),permissions);}
        catch(error){info.textContent=error.message;return;}
        if(!/^[0-9]{8}$/.test(publicId)||!permissions.length){
          info.textContent='Select an existing 8-digit Sharika ID and at least one permission.';return;
        }
        if(!window.confirm('Enable ADMIN PANEL access for existing member '+publicId+
          ' with ONLY these permissions: '+permissions.join(', ')+'?'))return;
        memberButton.disabled=true;
        try{
          await api('POST','staff/existing',{
            target_public_id:publicId,permissions,daily_coin_limit:limit
          });
          await P.admins();
          byId('staff-member-note').textContent='Access granted. The member can log in using their own Sharika account.';
        }catch(error){info.textContent='Access not granted: '+error.message;}
        finally{if(memberButton.isConnected)memberButton.disabled=false;}
      };
      create.onclick=async()=>{
        if(create.disabled)return;
        const name=byId('staff-name').value.trim();
        const email=byId('staff-email').value.trim().toLowerCase();
        const password=byId('staff-password').value;
        const permissions=picked('new');
        let limit;
        try{limit=validateLimit(byId('staff-limit').value.trim(),permissions);}
        catch(error){note.textContent=error.message;return;}
        if(name.length<1||name.length>80||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
           password.length<12||password.length>128){
          note.textContent='Enter staff name, valid email and password of 12–128 characters.';return;
        }
        if(!window.confirm('Create Firebase login '+email+' with ONLY the selected staff permissions?'))return;
        create.disabled=true;
        note.textContent='Creating Firebase account…';
        let created;
        try{
          created=await firebase('accounts:signUp',{email,password,returnSecureToken:true},false);
          byId('staff-password').value='';
          if(!created.idToken||!created.localId)throw new Error('Firebase did not return a verified account ID');
          note.textContent='Saving restricted staff permission…';
          await api('POST','staff',{
            name,email,new_staff_id_token:created.idToken,
            permissions,daily_coin_limit:limit
          });
          let emailSent=true;
          try{await firebase('accounts:sendOobCode',{
            requestType:'VERIFY_EMAIL',idToken:created.idToken
          },false);}catch(_){emailSent=false;}
          await P.admins();
          const feedback=byId('staff-note');
          if(feedback)feedback.textContent=emailSent?
            'Staff login created. Ask '+email+' to verify the email and then sign in.':
            'Staff created, but verification email failed. Ask them to request a new verification email.';
        }catch(error){
          note.textContent=(created?.localId?'Firebase account created; staff access may need an administrator review: ':
            'Staff not created: ')+error.message;
        }finally{if(create.isConnected)create.disabled=false;}
      };
      root.querySelectorAll('[data-staff-save]').forEach(button=>{
        button.onclick=async()=>{
          const id=button.dataset.staffSave;
          const permissions=picked(id);
          const raw=root.querySelector('[data-staff-limit="'+id+'"]').value.trim();
          let limit;
          try{limit=validateLimit(raw,permissions);}
          catch(error){note.textContent=error.message;return;}
          const active=root.querySelector('[data-staff-active="'+id+'"]').checked;
          if(!window.confirm((active?'Enable':'Suspend')+' staff #'+id+' with the selected permissions?'))return;
          button.disabled=true;
          try{await api('PATCH','staff/'+id,{permissions,daily_coin_limit:limit,active});
            await P.admins();
          }catch(error){note.textContent='Staff permissions not updated: '+error.message;}
          finally{if(button.isConnected)button.disabled=false;}
        };
      });
    }catch(error){root.innerHTML=card('Admin staff management unavailable',error.message);}
  };
  P.rank=async function () {
    const root=byId('pg');
    let kind='sending',period='weekly',requestNo=0;
    const kinds={rich:'Rich · historic',charm:'Charm · received',room:'Rooms',recharge:'Top Recharge',
      sending:'Verified Sending',game:'Verified Game Wins'};
    const periods={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};
    async function getVerifiedBoard(query){
      // This is a member-authenticated read-only API, not an Admin mutation.
      // The Admin api() helper prefixes /api/v1/admin, which would 404 here.
      const jwt=await idToken();
      const response=await fetch(API+'/api/v1/rankings/verified?'+query,{
        headers:{authorization:'Bearer '+jwt,accept:'application/json'},
        cache:'no-store'
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Verified leaderboard unavailable');
      return data;
    }
    root.innerHTML='<div class="card"><h3>Verified wallet rankings</h3>'+
      '<p>Gift ranks reflect settled transfers; Top Recharge counts only approved seller or finance recharge coins. No simulated players or payouts.</p>'+
      '<div class="row" id="rank-kinds">'+Object.entries(kinds).map(([key,label])=>
        '<button class="btn" type="button" data-rkind="'+esc(key)+'">'+esc(label)+'</button>'
      ).join('')+'</div>'+
      '<div class="row" id="rank-periods">'+Object.entries(periods).map(([key,label])=>
        '<button class="btn" type="button" data-rperiod="'+esc(key)+'">'+esc(label)+'</button>'
      ).join('')+'</div><div id="rank-results">Loading verified rankings…</div></div>'+
      '<div class="card"><h3>🏆 Automatic Ranking Targets & Rewards</h3>'+
      '<p class="n">All scores come from verified server activity. New rules apply at the NEXT UTC period. No historical payouts. Seven optional TOP prizes, with a minimum target for each rank.</p>'+
      '<div id="sh-rra-config">Loading reward controls…</div></div>';
    const results=byId('rank-results');
    async function reload(){
      const current=++requestNo;
      root.querySelectorAll('[data-rkind]').forEach(b=>b.disabled=b.dataset.rkind===kind);
      root.querySelectorAll('[data-rperiod]').forEach(b=>b.disabled=b.dataset.rperiod===period);
      results.textContent='Loading verified rankings…';
      try{
        const verified=['sending','recharge','game'].includes(kind);
        const data=verified?await getVerifiedBoard('kind='+kind+'&period='+period+
          (kind==='game'?'&metric=wins':'')):
          await api('GET','rankings?kind='+kind+'&period='+period);
        if(current!==requestNo)return;
        const leaders=Array.isArray(data.leaders)?data.leaders:[];
        if(!leaders.length){
          results.textContent=kind==='recharge'?'No approved recharges recorded for this period.':
            kind==='game'?'No server-settled game wins yet.':'No settled activity recorded for this period.';
          return;
        }
        const labels=kind==='room'?['Rank','Room ID','Room','Gift coins']:
          ['Rank','User ID','Name',kind==='game'?'Game wins':
            kind==='recharge'?'Approved recharge coins':'Gift coins'];
        const rows=leaders.map(item=>kind==='room'
          ?[fmt(item.rank),esc(item.room_id),esc(item.name),fmt(item.total)]
          :[fmt(item.rank),esc(item.display_id||item.public_id),esc(item.name),fmt(item.total)]);
        results.innerHTML=window.T(labels,rows);
      }catch(error){if(current===requestNo)results.textContent='Rankings unavailable: '+error.message;}
    }
    root.onclick=e=>{
      const k=e.target.closest('button[data-rkind]');
      const p=e.target.closest('button[data-rperiod]');
      if(k){kind=k.dataset.rkind;reload();}
      if(p){period=p.dataset.rperiod;reload();}
    };
    await reload();
    await renderRankingRewardSettings();
  };
  async function renderRankingRewardSettings(initial){
    const box=byId('sh-rra-config');if(!box)return;
    const selection=initial||{kind:'sending',period:'weekly',metric:'wins',game:''};
    const select=(id,options,selected)=>'<select class="field" id="'+id+'">'+
      options.map(([value,label])=>'<option value="'+esc(value)+'" '+
      (value===selected?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
    const filters='<div class="row"><label>Leaderboard '+select('sh-rra-kind',[
      ['sending','Gift Sending'],['recharge','Approved Recharge'],['game','Server-settled Games']],selection.kind)+
      '</label><label>Period '+select('sh-rra-period',[
        ['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']],selection.period)+
      '</label>'+(selection.kind==='game'?'<label>Game metric '+select('sh-rra-metric',[
        ['wins','Wins'],['stake','Total stakes'],['payout','Total payouts']],selection.metric)+
      '</label><label>Game '+select('sh-rra-game',[
        ['','All games'],['food-wheel','Food Wheel'],['jackpot-fruit','Fruit Jackpot'],
        ['sovera-food','Sovera Food'],['night-food','Night Food'],
        ['greedy-wheel','Greedy Wheel'],['fruit-royale','Fruit Royale'],
        ['sovera-gaddy','Sovera Gaddy']],selection.game)+
      '</label>':'')+'</div>';
    box.innerHTML=filters+'<p class="n" id="sh-rra-status">Loading verified rewards…</p>';
    const current=()=>({kind:byId('sh-rra-kind').value,
      period:byId('sh-rra-period').value,metric:byId('sh-rra-metric')?.value||'wins',
      game:byId('sh-rra-game')?.value||''});
    for(const id of ['sh-rra-kind','sh-rra-period','sh-rra-metric','sh-rra-game']){
      byId(id)?.addEventListener('change',()=>void renderRankingRewardSettings(current()));
    }
    const query='kind='+encodeURIComponent(selection.kind)+'&period='+encodeURIComponent(selection.period)+
      (selection.kind==='game'?'&metric='+encodeURIComponent(selection.metric)+
        (selection.game?'&game='+encodeURIComponent(selection.game):''):'');
    let data;
    try{data=await api('GET','ranking-rewards?'+query);}
    catch(error){byId('sh-rra-status').textContent='Reward controls unavailable: '+error.message+
      ' (new D1 migration may not be installed yet).';return;}
    const editing=role==='super';
    const targets=data.policy?.targets||Array(7).fill(0);
    const prizes=data.policy?.prizes||Array(7).fill(0);
    const row=Array.from({length:7},(_,i)=>'<tr><td>TOP '+(i+1)+'</td><td>'+
      '<input class="field" type="number" min="0" max="1000000000000" step="1" ' +
      'id="sh-rra-target-'+i+'" value="'+esc(targets[i])+'" '+(editing?'':'disabled')+'></td><td>'+
      '<input class="field" type="number" min="0" max="1000000" step="1" ' +
      'id="sh-rra-prize-'+i+'" value="'+esc(prizes[i])+'" '+(editing?'':'disabled')+'></td></tr>').join('');
    const last=data.last_completed;
    const winners=(last?.candidates||[]).map(item=>[
      'TOP '+item.rank,esc(item.display_id),esc(item.score)]);
    byId('sh-rra-status').outerHTML='<p class="n">'+
      (data.paused?'🔒 Reward payments globally paused.':'🟢 Global reward payments unpaused.')+
      ' · Latest version #'+esc(data.policy?.id||'none')+
      ' · Future activation: '+esc(data.next_effective_from)+
      ' · Automatic settlement additionally requires the server environment flag.</p>'+
      '<div class="row"><label><input id="sh-rra-enabled" type="checkbox" '+
      (data.policy?.enabled?'checked ':'')+(editing?'':'disabled')+'> Enable rules</label> '+
      '<label><input id="sh-rra-auto" type="checkbox" '+
      (data.policy?.auto_award?'checked ':'')+(editing?'':'disabled')+'> Enable automatic award</label></div>'+
      '<div style="overflow-x:auto"><table><thead><tr><th>Rank</th><th>Minimum score</th><th>Reward (coins)</th></tr></thead><tbody>'+
      row+'</tbody></table></div>'+
      (editing?'<div class="row"><button class="btn s" type="button" id="sh-rra-save">Publish future rules</button> '+
        '<button class="btn" type="button" id="sh-rra-pause">'+(data.paused?'Unpause rewards':'Pause all rewards')+'</button> '+
        '<button class="btn" type="button" id="sh-rra-settle">Settle last completed period</button></div>':'')+
      '<p class="n" id="sh-rra-feedback">'+(last?.settled?'Last period paid once.':'Last period has no settlement receipt.')+
      '</p><h4>Last completed verified leaderboard · '+esc(last?.start_at||'')+'</h4>'+
      (winners.length?window.T(['Rank','Displayed user ID','Verified score'],winners):
        '<p class="n">No verified activity recorded in the last completed period.</p>')+
      '<p class="n">Eligible award preview (using the rule active for that completed period): '+
      (last?.preview_awards?.length?last.preview_awards.map(a=>'#'+a.rank+' '+esc(a.display_id)+
        ' · '+fmt(a.coins)+' coins').join(', '):'None')+'</p>';
    if(!editing)return;
    byId('sh-rra-save').onclick=async()=>{
      const readNums=prefix=>Array.from({length:7},(_,i)=>{
        const raw=byId(prefix+i).value.trim();return /^\d+$/.test(raw)?Number(raw):NaN;});
      const targets=readNums('sh-rra-target-'),prizes=readNums('sh-rra-prize-');
      const enabled=byId('sh-rra-enabled').checked,auto_award=byId('sh-rra-auto').checked;
      if(targets.some(n=>!Number.isSafeInteger(n)||n<0||n>1e12)||
        prizes.some(n=>!Number.isSafeInteger(n)||n<0||n>1e6)||
        (enabled&&!prizes.some(n=>n>0))||auto_award&&!enabled){
        byId('sh-rra-feedback').textContent='Invalid targets/prizes: targets 0–1T; each prize 0–1M, at least one enabled prize.';
        return;
      }
      if(!window.confirm('Publish these TOP 1–7 rules for the NEXT full UTC period? Older rules and payments remain unchanged.'))return;
      try{await api('PATCH','ranking-rewards',{kind:selection.kind,period:selection.period,
        ...(selection.kind==='game'?{metric:selection.metric,game:selection.game||null}:{}),
        enabled,auto_award,targets,prizes});
        note('Future ranking rules published and audited.');await renderRankingRewardSettings(selection);
      }catch(error){byId('sh-rra-feedback').textContent='Not published: '+error.message;}
    };
    byId('sh-rra-pause').onclick=async()=>{
      const paused=!data.paused;
      if(!window.confirm((paused?'Pause':'Unpause')+' ALL ranking prize payments? This action is audited.'))return;
      try{await api('POST','ranking-rewards/pause',{paused,confirm:true});
        await renderRankingRewardSettings(selection);}catch(error){byId('sh-rra-feedback').textContent=error.message;}
    };
    byId('sh-rra-settle').onclick=async()=>{
      if(!window.confirm('Settle the LAST completed UTC period? This may credit REAL user coin wallets according to previously published rules. Continue?'))return;
      try{const result=await api('POST','ranking-rewards/settle',{kind:selection.kind,
        period:selection.period,...(selection.kind==='game'?{
          metric:selection.metric,game:selection.game||null}:{}),confirm:true});
        note(result.awarded?'Ranking prizes credited once.':'Settlement: '+(result.skipped||'already settled'));
        await renderRankingRewardSettings(selection);
      }catch(error){byId('sh-rra-feedback').textContent='Not settled: '+error.message;}
    };
  }
  P.analytics=async function () {
    const root=byId('pg');root.innerHTML=card('Analytics','Loading verified statistics…');
    try{
      const data=await api('GET','analytics');
      const rows=[
        ['Active users',data.active_users],['Blocked users',data.blocked_users],
        ['Rooms created',data.total_rooms],['Saved room memberships',data.room_memberships],
        ['Occupied seats',data.occupied_seats],['Catalog gifts',data.catalog_gifts],
        ['Active gifts',data.active_gifts],['App administrators',data.admins]
      ];
      root.innerHTML='<div class="kp">'+rows.map(([name,num])=>
        '<div class="k"><small>'+esc(name)+'</small><b>'+fmt(num)+'</b></div>'
      ).join('')+'</div>'+card('Verified D1 analytics',
        'These are persisted counts, not live presence. No fake online-user figures.');
    }catch(error){root.innerHTML=card('Analytics unavailable',error.message);}
  };
  async function mountDirectRecharge(root){
    const section=document.createElement('div');
    section.className='card';
    section.innerHTML='<h3>🪙 Direct verified user coin credit</h3>'+
      '<p class="n">Credits the real user wallet exactly once. This is a manual admin grant, NOT a payment receipt or seller stock. Every credit has an immutable ledger entry and reason.</p>'+
      '<div class="row"><input id="direct-user" maxlength="10" inputmode="numeric" placeholder="Recipient 1–10 digit Member or Special ID" aria-label="User ID">'+
      '<input id="direct-coins" inputmode="numeric" placeholder="Coins (Super Admin: up to 1 trillion)" aria-label="Coin amount"></div>'+
      '<div class="row"><input id="direct-reason" maxlength="200" placeholder="Reason (8–200 characters)" aria-label="Reason">'+
      '<button id="direct-submit" class="btn s" type="button">Credit user wallet</button></div>'+
      '<p id="direct-note" class="n" aria-live="polite"></p>'+
      '<h4>Verified direct credit history</h4><div id="direct-history">Loading…</div>';
    root.insertBefore(section,root.firstChild);
    if(role==='super'){
      const debit=document.createElement('div');
      debit.className='card';
      debit.innerHTML='<h3>↩️ Subtract virtual coins · Super Admin only</h3>'+
        '<p class="n">Deduct only from the current available wallet. This does not edit old recharge receipts or other historic transactions. Every debit is a new immutable ledger entry with a mandatory reason.</p>'+
        '<div class="row"><input id="debit-user" maxlength="10" inputmode="numeric" placeholder="Member / Special ID">'+
        '<input id="debit-coins" inputmode="numeric" placeholder="Virtual coins to subtract"></div>'+
        '<div class="row"><input id="debit-reason" maxlength="200" placeholder="Reason (8–200 characters)">'+
        '<button class="btn s" id="debit-submit" type="button">Subtract virtual coins</button></div>'+
        '<p id="debit-note" class="n" aria-live="polite"></p>'+
        '<h4>Immutable debit history</h4><div id="debit-history">Loading…</div>';
      section.insertAdjacentElement('afterend',debit);
      const debitNote=byId('debit-note'),debitHistory=byId('debit-history');
      let pendingDebit=null;
      async function refreshDebits(){
        try{
          const res=await api('GET','coin-adjustments');
          debitHistory.innerHTML=window.T(['Transaction','Recipient','Coins subtracted','Balance','Reason','Time'],
            (res.adjustments||[]).map(a=>[fmt(a.id),esc(a.recipient_id),fmt(a.coins),
              fmt(a.balance_after),esc(a.reason),esc(a.created_at)]));
        }catch(error){debitHistory.textContent='Debit history unavailable: '+error.message;}
      }
      const debitButton=byId('debit-submit');
      debitButton.onclick=async()=>{
        if(debitButton.disabled)return;
        const target=byId('debit-user').value.trim(),raw=byId('debit-coins').value.trim();
        const amount=Number(raw),reason=byId('debit-reason').value.trim();
        if(!/^[0-9]{1,10}$/.test(target)||!/^[0-9]+$/.test(raw)||
           !Number.isSafeInteger(amount)||amount<1||amount>1000000000000||
           reason.length<8||reason.length>200){
          debitNote.textContent='Enter a valid ID, positive virtual coin amount and a reason of 8–200 characters.';return;
        }
        if(!window.confirm('SUBTRACT '+fmt(amount)+' VIRTUAL coins from member '+target+
          '? Reason: '+reason+'\nThis cannot be undone except by a separate audited credit.'))return;
        const fingerprint=target+':'+amount+':'+reason;
        const requestId=pendingDebit?.fingerprint===fingerprint?pendingDebit.requestId:
          'admin-debit:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
        pendingDebit={fingerprint,requestId};
        debitButton.disabled=true;debitNote.textContent='Submitting audited virtual coin adjustment…';
        try{
          const result=await api('POST','coin-adjustments',{
            target_public_id:target,coins:amount,reason,request_id:requestId
          });
          pendingDebit=null;
          debitNote.textContent=(result.duplicate?'Already processed safely. ':'Confirmed. ')+
            'Transaction #'+result.transaction_id+' · Remaining '+fmt(result.balance_after)+' coins.';
          byId('debit-coins').value='';
          await refreshDebits();
        }catch(error){debitNote.textContent='Not confirmed. Check debit history before retrying: '+error.message;}
        finally{debitButton.disabled=false;}
      };
      await refreshDebits();
    }
    const note=byId('direct-note'),history=byId('direct-history');
    async function refreshHistory(){
      try{
        const response=await api('GET','recharge-user');
        history.innerHTML=window.T(['Transaction','Recipient','Coins','Balance','Reason','Time'],
          (response.grants||[]).map(item=>[
            fmt(item.id),esc(item.recipient_id),fmt(item.coins),
            fmt(item.balance_after),esc(item.reason),esc(item.created_at)]));
        if(role==='staff')note.textContent='Your daily allowed limit: '+
          fmt(response.daily_coin_limit)+' coins.';
      }catch(error){history.textContent='Credit history unavailable: '+error.message;}
    }
    const button=byId('direct-submit');
    button.onclick=async()=>{
      if(button.disabled)return;
      const target=byId('direct-user').value.trim();
      const raw=byId('direct-coins').value.trim();
      const amount=Number(raw);
      const reason=byId('direct-reason').value.trim();
      if(!/^[0-9]{1,10}$/.test(target)||!/^[0-9]+$/.test(raw)||
         !Number.isSafeInteger(amount)||amount<1||amount>(role==='super'?1000000000000:1000000)||
         reason.length<8||reason.length>200){
        note.textContent='Enter 1–10 digit Member or Special ID, positive coins within the wallet cap and an 8–200 character reason.';return;
      }
      if(!window.confirm('Credit '+fmt(amount)+' real coins to user '+target+
        '? Reason: '+reason+'\nThis grant is permanently audited.'))return;
      const fingerprint=target+':'+amount+':'+reason;
      const requestId=pendingAdminCredit?.fingerprint===fingerprint?
        pendingAdminCredit.requestId:
        'admin-credit:'+Date.now().toString(36)+':'+Math.random().toString(36).slice(2);
      pendingAdminCredit={fingerprint,requestId};
      button.disabled=true;note.textContent='Submitting one auditable coin credit…';
      try{
        const result=await api('POST','recharge-user',{
          target_public_id:target,coins:amount,reason,request_id:requestId
        });
        pendingAdminCredit=null;
        note.textContent=(result.duplicate?'Already credited (safe retry). ':'Credit confirmed. ')+
          'Transaction #'+result.transaction_id+' · New wallet '+fmt(result.balance_after)+' coins.';
        byId('direct-coins').value='';
        await refreshHistory();
      }catch(error){
        note.textContent='Not confirmed; check credit history, then retry the SAME amount and reason. '+error.message;
      }finally{button.disabled=false;}
    };
    await refreshHistory();
  }

  P.rech=async function(){
    const root=byId('pg');
    if(role==='staff'&&identity?.permissions?.includes('coin_recharge')){
      root.innerHTML='';
      await mountDirectRecharge(root);
      return;
    }
    if(role!=='super'&&role!=='finance'){
      root.innerHTML=card('Recharge requests','Only verified Finance or Super Admin can approve payments.');
      return;
    }
    root.innerHTML='<div class="card"><h3>💳 Verified recharge requests</h3>'+
      '<p class="n">A support request is NOT proof of payment. Verify the transaction directly with the payment provider before approval. Only a verified Finance or Super Admin may credit coins.</p>'+
      '<div id="recharge-list">Loading genuine support requests…</div></div>'+
      '<div class="card"><h3>Review selected request</h3>'+
      '<div class="row"><label>Support request # <input id="rc-request-id" class="field" inputmode="numeric" placeholder="Choose a pending request"></label>'+
      '<label>Coins to credit <input id="rc-amount" class="field" inputmode="numeric" placeholder="1–1,000,000,000,000"></label></div>'+
      '<div class="row"><label>Payment method <input id="rc-method" class="field" maxlength="40" placeholder="e.g. bKash or PayPal"></label>'+
      '<label>Verified receipt ID <input id="rc-reference" class="field" maxlength="120" placeholder="External transaction reference"></label></div>'+
      '<label style="display:block;margin:12px 0"><input type="checkbox" id="rc-verified"> I independently verified that this payment was received.</label>'+
      '<button id="rc-approve" class="btn s" type="button">Approve and credit once</button>'+
      '<p class="n">If payment was not received, enter a reason and reject. A rejected request cannot later be approved; ask the user to submit a new request.</p>'+
      '<textarea id="rc-reject-note" class="field" maxlength="250" placeholder="Reason for rejection (at least 8 characters)"></textarea>'+
      '<button id="rc-reject" class="btn s" type="button">Reject selected request</button>'+
      '<p id="rc-note" class="n" aria-live="polite"></p></div>';
    const list=byId('recharge-list'),note=byId('rc-note');
    let busy=false;
    async function refresh(){
      list.textContent='Loading verified request records…';
      try{
        const result=await api('GET','recharges');
        const items=result.requests||[];
        if(!items.length){list.innerHTML='<p class="n">No recharge support requests have been submitted.</p>';return;}
        list.innerHTML=items.map(r=>
          '<div class="row" style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,.08)">'+
          '<div style="flex:1;min-width:0"><b>#'+esc(r.request_id)+' · ID '+esc(r.public_id)+'</b>'+
          '<p class="n">'+esc(r.name)+' · '+esc(r.status)+' · '+esc(r.requested_at||'')+'</p>'+
          '<p class="n">'+esc(r.request_text||'')+'</p>'+
          (r.status==='approved'?'<p class="n">Verified: '+fmt(r.reviewed_coins)+' coins · '+esc(r.payment_method||'')+
            ' · '+esc(r.payment_reference||'')+'</p>':'')+'</div>'+
          (r.status==='pending'?'<button class="btn s" data-rc-select="'+esc(r.request_id)+'" type="button">Select</button>':'')+
          '</div>').join('');
        list.querySelectorAll('[data-rc-select]').forEach(button=>{
          button.onclick=()=>{
            byId('rc-request-id').value=button.dataset.rcSelect;
            byId('rc-amount').value='';
            byId('rc-method').value='';
            byId('rc-reference').value='';
            byId('rc-verified').checked=false;
            note.textContent='Selected request #'+button.dataset.rcSelect+
              '. Check external payment receipt before entering coins.';
          };
        });
      }catch(error){list.textContent='Recharge records unavailable: '+error.message;}
    }
    async function review(kind){
      if(busy)return;
      const idRaw=byId('rc-request-id').value.trim();
      const id=Number(idRaw);
      if(!/^\d+$/.test(idRaw)||!Number.isSafeInteger(id)||id<1){
        note.textContent='Select a genuine pending support request first.';return;
      }
      let data={support_message_id:id},question;
      if(kind==='approve'){
        const raw=byId('rc-amount').value.trim(),coins=Number(raw);
        const method=byId('rc-method').value.trim();
        const reference=byId('rc-reference').value.trim();
        if(!/^\d+$/.test(raw)||!Number.isSafeInteger(coins)||coins<1||coins>1000000000000||
            method.length<2||reference.length<6||!byId('rc-verified').checked){
          note.textContent='Enter a valid coin amount, payment method, receipt ID, and check verified payment.';return;
        }
        data={...data,coins,payment_method:method,payment_reference:reference,confirm_payment_verified:true};
        question='You independently verified payment '+reference+' via '+method+
          '. Credit '+fmt(coins)+' coins to request #'+id+'? This cannot be undone.';
      }else{
        const reason=byId('rc-reject-note').value.trim();
        if(reason.length<8||reason.length>250){
          note.textContent='Enter a rejection reason of 8–250 characters.';return;
        }
        data.note=reason;
        question='Reject recharge request #'+id+' without crediting coins?';
      }
      if(!window.confirm(question))return;
      busy=true;byId('rc-approve').disabled=true;byId('rc-reject').disabled=true;
      note.textContent='Submitting reviewed request…';
      try{
        const result=await api('POST','recharges/'+kind,data);
        note.textContent=kind==='approve'?
          (result.duplicate?'Already approved; no extra coins credited.':
            'Approved: +'+fmt(result.credited_coins)+' coins; first recharge bonus +'+
              fmt(result.first_recharge_bonus_coins)+'; inviter bonus +'+
              fmt(result.referral_bonus_coins)+' coins.') :
          'Request rejected; zero coins credited.';
        byId('rc-verified').checked=false;
        await refresh();
      }catch(error){note.textContent='Not completed: '+error.message;}
      finally{busy=false;byId('rc-approve').disabled=false;byId('rc-reject').disabled=false;}
    }
    byId('rc-approve').onclick=()=>review('approve');
    byId('rc-reject').onclick=()=>review('reject');
    await refresh();
    if(role==='super')await mountDirectRecharge(root);
  };

  P.banners=async function(){
    const root=byId('pg');
    root.innerHTML=card('Home banners','Loading verified banner configuration…');
    // The admin browser's gallery picker is the only image source. Convert
    // locally to a bounded landscape JPEG; EXIF and device paths never upload.
    async function bannerJpeg(file){
      if(!file||!file.type.startsWith('image/')||file.size>12*1024*1024)
        throw new Error('Select an image smaller than 12 MB.');
      const objectUrl=URL.createObjectURL(file);
      const picture=new Image();
      try{
        await new Promise((resolve,reject)=>{
          picture.onload=resolve;
          picture.onerror=()=>reject(new Error('The photo could not be opened.'));
          picture.src=objectUrl;
        });
        if(!picture.naturalWidth||!picture.naturalHeight)
          throw new Error('The photo has no usable dimensions.');
        const canvas=document.createElement('canvas');
        canvas.width=1100;canvas.height=480;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('Banner image conversion unavailable.');
        const scale=Math.max(canvas.width/picture.naturalWidth,
          canvas.height/picture.naturalHeight);
        const width=picture.naturalWidth*scale,height=picture.naturalHeight*scale;
        context.drawImage(picture,(canvas.width-width)/2,
          (canvas.height-height)/2,width,height);
        for(const quality of [.79,.66,.53,.42]){
          const data=canvas.toDataURL('image/jpeg',quality);
          if(data.startsWith('data:image/jpeg;base64,')&&data.length<480000)
            return data;
        }
        throw new Error('The image is too detailed; choose a smaller photo.');
      }finally{URL.revokeObjectURL(objectUrl);}
    }
    try{
      const data=await api('GET','banners');
      const rows=data.banners||[];
      const actions=[['none','No action'],['daily','Daily check-in'],['recharge','Recharge'],['rank','Rankings'],['invite','Invite friends']];
      const choices=selected=>actions.map(([key,label])=>
        '<option value="'+key+'"'+(selected===key?' selected':'')+'>'+label+'</option>').join('');
      const palette={
        purple:['#9b4dff','#ff3dc8'],ocean:['#0ea5e9','#075985'],
        gold:['#f59e0b','#ff3dc8'],green:['#10b981','#3b82f6']
      };
      const list=rows.map(row=>{
        const canEdit=role==='super';
        const image=typeof row.image_url==='string'&&
          /^https:\/\/sharika-api-staging\.soverixnet\.workers\.dev\/api\/v1\/banners\/[1-9][0-9]{0,8}\/image\?v=[1-9][0-9]*$/.test(row.image_url)&&
          row.image_url.includes('/banners/'+row.id+'/image?')
          ?row.image_url:null;
        return '<div class="card" style="margin:10px 0">'+
          '<div style="position:relative;overflow:hidden;min-height:110px;padding:15px;'+
          'border-radius:16px;background:linear-gradient(135deg,'+
          esc(row.color_a)+','+esc(row.color_b)+');color:#fff">'+
          (image?'<img src="'+esc(image)+'" alt="Banner #'+row.id+
          '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">': '')+
          '<div style="position:relative;text-shadow:0 2px 6px #000">'+
          '<b>'+esc(row.emoji)+' '+esc(row.title)+'</b><small style="display:block">'+
          esc(row.subtitle)+'</small></div></div>'+
          '<p class="n">Banner #'+esc(row.id)+' · '+(row.active?'Visible in app':'Hidden')+'</p>'+
          (canEdit?'<div class="row"><input data-bf="title" data-id="'+row.id+'" maxlength="80" value="'+esc(row.title)+'" aria-label="Banner title">'+
          '<input data-bf="subtitle" data-id="'+row.id+'" maxlength="160" value="'+esc(row.subtitle||'')+'" aria-label="Banner subtitle"></div>'+
          '<div class="row"><select data-bf="action" data-id="'+row.id+'">'+choices(row.action)+'</select>'+
          '<input type="number" min="0" max="100" data-bf="sort_order" data-id="'+row.id+'" value="'+Number(row.sort_order)+'" aria-label="Display order">'+
          '<label><input type="checkbox" data-bf="active" data-id="'+row.id+'"'+(row.active?' checked':'')+'> Active</label>'+
          '<button class="btn s" type="button" data-bsave="'+row.id+'">Save</button></div>'+
          '<div class="row"><label>🖼️ Add/replace photo from gallery'+
          '<input type="file" accept="image/jpeg,image/png,image/webp" data-bimage-id="'+row.id+'"></label>'+
          (image?'<button class="btn s" type="button" data-bremove="'+row.id+'">Remove photo</button>':'')+
          '</div>':'')+
          '</div>';
      }).join('');
      const create=role==='super'?'<div class="card"><h3>➕ Add home banner</h3>'+
        '<p class="n">Choose a gallery photo, or keep a color banner. Photos are center-cropped for the home carousel.</p>'+
        '<div class="row"><input id="new-banner-title" maxlength="80" placeholder="Banner headline">'+
        '<input id="new-banner-subtitle" maxlength="160" placeholder="Subtitle"></div>'+
        '<div class="row"><label>🖼️ Banner photo (optional)<input type="file" id="new-banner-image" accept="image/jpeg,image/png,image/webp"></label></div>'+
        '<div class="row"><input id="new-banner-emoji" maxlength="12" value="🎉" aria-label="Emoji">'+
        '<select id="new-banner-action">'+choices('none')+'</select>'+
        '<select id="new-banner-color"><option value="purple">Purple</option><option value="gold">Gold</option><option value="ocean">Ocean</option><option value="green">Green</option></select>'+
        '<label><input type="checkbox" id="new-banner-active"> Show now</label>'+
        '<button class="btn" id="new-banner-save" type="button">Add banner</button></div></div>':'';
      root.innerHTML=card('Verified home banners',
        'These are real D1 announcements used by the Sharika Android home carousel. No demo banners or wallet changes.')+
        (list||card('No banners','No active or inactive banners have been created.'))+create+
        '<p id="banner-note" class="n" aria-live="polite"></p>';
      const note=byId('banner-note');
      const add=byId('new-banner-save');
      if(add)add.onclick=async()=>{
        if(add.disabled)return;
        add.disabled=true;
        try{
          const picked=palette[byId('new-banner-color').value]||palette.purple;
          const selectedPhoto=byId('new-banner-image')?.files?.[0];
          const image_data=selectedPhoto?await bannerJpeg(selectedPhoto):null;
          const showNow=byId('new-banner-active').checked;
          const created=await api('POST','banners',{
            title:byId('new-banner-title').value.trim(),
            subtitle:byId('new-banner-subtitle').value.trim(),
            emoji:byId('new-banner-emoji').value.trim()||'🎉',
            action:byId('new-banner-action').value,
            color_a:picked[0],color_b:picked[1],
            active:image_data?false:showNow,sort_order:rows.length
          });
          if(image_data){
            const createdId=Number(created.id);
            if(!Number.isSafeInteger(createdId)||createdId<1)
              throw new Error('Banner saved but photo ID was not returned; refresh to retry.');
            await api('PUT','banners/'+createdId+'/image',{image_data});
            if(showNow)await api('PATCH','banners/'+createdId,{active:true});
          }
          await P.banners();
        }catch(error){if(note)note.textContent='Banner not fully saved: '+error.message+
          '. If a banner was created, reopen this page to finish the photo.';}
        finally{if(add.isConnected)add.disabled=false;}
      };
      root.querySelectorAll('[data-bimage-id]').forEach(input=>{
        input.onchange=async()=>{
          const file=input.files?.[0];
          if(!file)return;
          input.disabled=true;
          note.textContent='Preparing your gallery photo…';
          try{
            const image_data=await bannerJpeg(file);
            await api('PUT','banners/'+input.dataset.bimageId+'/image',{image_data});
            await P.banners();
          }catch(error){
            if(note)note.textContent='Photo not uploaded: '+error.message;
          }finally{if(input.isConnected)input.disabled=false;}
        };
      });
      root.querySelectorAll('[data-bremove]').forEach(button=>{
        button.onclick=async()=>{
          if(button.disabled)return;
          if(!window.confirm('Remove this banner photo? The banner text and settings will remain.'))return;
          button.disabled=true;
          try{
            await api('DELETE','banners/'+button.dataset.bremove+'/image');
            await P.banners();
          }catch(error){if(note)note.textContent='Photo not removed: '+error.message;}
          finally{if(button.isConnected)button.disabled=false;}
        };
      });
      root.querySelectorAll('[data-bsave]').forEach(button=>{
        button.onclick=async()=>{
          const id=button.dataset.bsave;
          const field=name=>root.querySelector('[data-bf="'+name+'"][data-id="'+id+'"]');
          const sort=Number(field('sort_order').value);
          if(!Number.isSafeInteger(sort)||sort<0||sort>100){
            note.textContent='Display order must be between 0 and 100.';return;
          }
          button.disabled=true;
          try{
            await api('PATCH','banners/'+id,{
              title:field('title').value.trim(),subtitle:field('subtitle').value.trim(),
              action:field('action').value,sort_order:sort,active:field('active').checked
            });
            await P.banners();
          }catch(error){if(note)note.textContent='Banner not saved: '+error.message;}
          finally{if(button.isConnected)button.disabled=false;}
        };
      });
    }catch(error){root.innerHTML=card('Banners unavailable',error.message);}
  };

  P.system=async function () {
    const root=byId('pg');
    root.innerHTML=card('Sharika staging','Firebase login and D1 role enforcement active. Only audited, authenticated wallet operations are permitted.');
  };


  // Real event manager: replaces the template's simulated Events and Prizes tables.
  // Event winners are paid only after the published event ends, by exact verified ID.
  const EVENT_KINDS={
    gift_race:'🎁 Gift race',room_battle:'🎙️ Room ranking battle',
    recharge_bonus:'🪙 Recharge campaign',game_tournament:'🎮 Game tournament',
    invite_campaign:'🤝 Invite campaign',checkin_festival:'📅 Check-in festival',
    festival:'🎊 Festival',custom:'✨ Custom event'
  };
  function eventLocal(iso){
    const time=new Date(iso);
    if(!Number.isFinite(+time))return '';
    return new Date(time.getTime()-time.getTimezoneOffset()*60000)
      .toISOString().slice(0,16);
  }
  P.opening=async function(){
    const root=byId('pg');
    root.innerHTML=card('7 Day Opening Screen','Loading live settings and last week’s verified winners…');
    let data;
    try{data=await api('GET','opening');}
    catch(error){root.innerHTML=card('Opening screen unavailable',error.message);return;}
    if(!root.isConnected)return;
    const c=data.settings||{};
    const readonly=role!=='super';
    const shown=data.next_week_winners||[];
    const preview=shown.length?shown.map((person,index)=>
      '<div class="card" style="flex:1;min-width:170px;border-color:#d9b055;'+
      'background:linear-gradient(150deg,#3f0a68,#160828)">'+
      '<div style="font-size:12px;color:#f5d77c">'+esc(person.title)+'</div>'+
      '<div style="display:flex;align-items:center;gap:12px;margin:10px 0">'+
      (person.pic&&/^https:\/\//i.test(person.pic)?
        '<img src="'+esc(person.pic)+'" alt="User" style="width:48px;height:48px;'+
        'border:3px solid #edc565;border-radius:50%;object-fit:cover">':
        '<span style="font-size:36px">👤</span>')+
      '<div><b>'+esc(person.name)+'</b><small style="display:block;color:#d8c6ff">ID '+
      esc(person.public_id)+'</small></div></div><b>🏆 '+fmt(person.total)+' coins</b></div>'
    ).join(''):'<p class="n">No verified previous-week winners yet. The app will skip this spotlight until there is a real result.</p>';
    root.innerHTML='<div class="card" style="border-color:#e7ba5c">'+
      '<h3>👑 7 Day Opening Screen — live server control</h3>'+
      '<p class="n">Each completed Monday–Sunday week selects the verified winners for the next week. '+
      'One user appears per app launch. Every viewer gets their own rotating order; no automatic slideshow during the 10-second screen.</p>'+
      '<div class="ft"><div><b>Enable opening screen</b><small>Turn off anytime, takes effect on the next app launch</small></div>'+
      '<input id="sh-opening-enabled" type="checkbox" style="width:24px;height:24px;margin:0" '+
      (c.enabled?'checked':'')+(readonly?' disabled':'')+'></div>'+
      '<div class="g2" style="margin-top:14px">'+
      '<div><label for="sh-opening-mode">Display mode</label><select id="sh-opening-mode" '+(readonly?'disabled':'')+'>'+
      '<option value="automatic" '+(c.mode==='automatic'?'selected':'')+'>Automatic weekly top users</option>'+
      '<option value="custom" '+(c.mode==='custom'?'selected':'')+'>Custom user or special banner</option></select></div>'+
      '<div><label for="sh-opening-duration">Duration (seconds)</label><input id="sh-opening-duration" '+
      'type="number" min="3" max="30" value="'+Number(c.duration_seconds||10)+'" '+
      (readonly?'disabled':'')+'></div></div>'+
      '<div id="sh-opening-custom"><div class="g2">'+
      '<div><label for="sh-opening-user">Featured user ID (optional, 8 digits)</label><input id="sh-opening-user" '+
      'inputmode="numeric" maxlength="8" placeholder="10000001" value="'+esc(c.custom_user_id||'')+'" '+(readonly?'disabled':'')+'></div>'+
      '<div><label for="sh-opening-title">Custom title</label><input id="sh-opening-title" maxlength="60" '+
      'placeholder="SHARIKA STAR" value="'+esc(c.custom_title||'')+'" '+(readonly?'disabled':'')+'></div>'+
      '<div><label for="sh-opening-subtitle">Custom subtitle</label><input id="sh-opening-subtitle" '+
      'maxlength="100" placeholder="Featured this week" value="'+esc(c.custom_subtitle||'')+'" '+(readonly?'disabled':'')+'></div>'+
      '<div><label for="sh-opening-image">Custom image HTTPS link</label><input id="sh-opening-image" '+
      'maxlength="500" placeholder="https://…/banner.jpg" value="'+esc(c.custom_image_url||'')+'" '+(readonly?'disabled':'')+'></div></div></div>'+
      (readonly?'<p class="n">Only Super Admin can change the opening screen.</p>':
        '<button id="sh-opening-save" class="btn" type="button">Save & publish opening settings</button>')+
      '<p class="n" style="margin-top:10px">Settings version '+Number(c.version||1)+
      ' · Changes apply to the next app opening; no reinstall needed.</p></div>'+
      '<h3 style="color:#f5d77c;margin:16px 0 10px">Previous week’s verified champions</h3>'+
      '<div class="row" style="align-items:stretch">'+preview+'</div>';
    const mode=byId('sh-opening-mode'),custom=byId('sh-opening-custom');
    const toggleCustom=()=>{custom.style.display=mode.value==='custom'?'':'none';};
    mode.onchange=toggleCustom;toggleCustom();
    if(readonly)return;
    byId('sh-opening-save').onclick=async function(){
      const button=this;
      const next={expected_version:Number(c.version),
        enabled:byId('sh-opening-enabled').checked,mode:mode.value,
        duration_seconds:Number(byId('sh-opening-duration').value),
        custom_user_id:byId('sh-opening-user').value.trim(),
        custom_title:byId('sh-opening-title').value.trim(),
        custom_subtitle:byId('sh-opening-subtitle').value.trim(),
        custom_image_url:byId('sh-opening-image').value.trim()};
      button.disabled=true;
      try{await api('PATCH','opening',next);note('Opening screen settings saved ✓');await P.opening();}
      catch(error){note(error.message||'Could not save settings');button.disabled=false;}
    };
  };

  P.events=async function(){
    const root=byId('pg');
    root.innerHTML='<div class="card"><h3>🎉 Verified Events & Rewards</h3>'+
      '<p class="n">Events appear in the app as soon as they are published. '+
      'Set UTC event dates and prize coins; select real winning user IDs only after the event ends. '+
      'Every winner is paid once through the server wallet and immutable ledger.</p>'+
      '<div id="sh-event-stats">Loading verified events…</div></div>'+
      (role==='super'?'<div class="card" style="border:1px solid #edc668;border-radius:19px;'+
      'box-shadow:0 8px 20px #553ba026"><h3 id="sh-event-form-title">✨ Create event</h3>'+
      '<div class="row">'+
      '<label>Title<input class="field" id="sh-ev-title" maxlength="100" placeholder="Weekend Gift Race"></label>'+
      '<label>Type<select class="field" id="sh-ev-kind">'+
      Object.entries(EVENT_KINDS).map(([key,label])=>'<option value="'+key+'">'+esc(label)+'</option>').join('')+
      '</select></label></div>'+
      '<label>Description / rules<textarea class="field" id="sh-ev-desc" maxlength="1000" rows="3" '+
      'placeholder="Describe the ranking and how winners are chosen"></textarea></label>'+
      '<div class="row"><label>Starts (local time)<input class="field" id="sh-ev-start" type="datetime-local"></label>'+
      '<label>Ends (local time)<input class="field" id="sh-ev-end" type="datetime-local"></label>'+
      '<label>Status<select class="field" id="sh-ev-status">'+
      '<option value="draft">Draft (hidden)</option><option value="published">Publish in app</option>'+
      '<option value="cancelled">Cancelled</option></select></label></div>'+
      '<div class="row"><label>🥇 Rank 1 coins<input class="field" type="number" id="sh-ev-p1" min="0" max="1000000" value="10000"></label>'+
      '<label>🥈 Rank 2 coins<input class="field" type="number" id="sh-ev-p2" min="0" max="1000000" value="5000"></label>'+
      '<label>🥉 Rank 3 coins<input class="field" type="number" id="sh-ev-p3" min="0" max="1000000" value="2500"></label></div>'+
      '<button class="btn s" type="button" id="sh-event-save">Create event</button>'+
      ' <button class="btn" type="button" id="sh-event-clear">Clear form</button>'+
      '<p class="n" id="sh-event-note">Use 0 to disable a prize. Awarded events are locked to protect old receipts.</p>'+
      '</div>':'')+
      '<div id="sh-event-list">Loading…</div>';
    let data;
    try{data=await api('GET','events');}
    catch(error){
      byId('sh-event-list').textContent='Events unavailable: '+error.message;
      byId('sh-event-stats').textContent='Could not read event records.';
      return;
    }
    const all=data.events||[];
    byId('sh-event-stats').innerHTML='<b>'+fmt(all.length)+'</b> real events · '+
      '<b>'+fmt(all.filter(e=>e.status==='live').length)+'</b> live · '+
      '<b>'+fmt(all.reduce((sum,e)=>sum+(e.awards||[]).length,0))+'</b> paid prizes';
    const list=byId('sh-event-list');
    if(!all.length)list.innerHTML=card('No events yet',
      'Create an event above. No demo competitions or prize payments are enabled.');
    else list.innerHTML=all.map(e=>{
      const awarded=e.awards||[];
      const labels=['🥇','🥈','🥉'];
      const schedule=esc(new Date(e.starts_at).toLocaleString())+' — '+
        esc(new Date(e.ends_at).toLocaleString());
      const prizes=labels.map((medal,i)=>{
        const receipt=awarded.find(a=>a.rank===i+1);
        const coins=Number(e.prizes?.[i]||0);
        if(!coins)return '<span class="n">'+medal+' No prize</span>';
        return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0">'+
          '<b>'+medal+' '+fmt(coins)+' 🪙</b> '+
          (receipt?'<span class="n">✓ Paid to '+esc(receipt.public_id)+
             ' ('+esc(receipt.name)+')</span>':
           role==='super'&&e.status==='ended'?
             '<input class="field" style="max-width:145px" inputmode="numeric" maxlength="8" '+
             'placeholder="8-digit user ID" id="sh-ev-recipient-'+e.id+'-'+(i+1)+'">'+
             '<button type="button" class="btn s" data-sh-event-award="'+e.id+'" '+
             'data-sh-event-rank="'+(i+1)+'">Pay verified winner</button>':
             '<span class="n">Pending · ends first</span>')+'</div>';
      }).join('');
      return '<div class="card" style="border:1px solid #9d7be4;border-radius:22px;'+
        'background:linear-gradient(140deg,#fff,#f6f0ff);box-shadow:0 7px 0 #d2c2ef">'+
        '<h3>🏆 '+esc(e.title)+' <small>#'+e.id+'</small></h3>'+
        '<p class="n">'+esc(EVENT_KINDS[e.kind]||e.kind)+' · <b>'+esc(e.status.toUpperCase())+'</b></p>'+
        '<p class="n">'+schedule+'</p><p>'+esc(e.description||'No rules entered')+'</p>'+
        '<div>'+prizes+'</div>'+
        (role==='super'&&!e.locked?
          '<button class="btn" type="button" data-sh-event-edit="'+e.id+'">Edit event / prizes</button>':
          e.locked?'<p class="n">🔒 Paid event cannot be edited.</p>':'')+
        '</div>';
    }).join('');
    let editing=null;
    const now=new Date(),tomorrow=new Date(now.getTime()+86400000);
    function clear(){
      editing=null;
      byId('sh-event-form-title')?.replaceChildren(document.createTextNode('✨ Create event'));
      byId('sh-ev-title').value='';
      byId('sh-ev-kind').value='gift_race';
      byId('sh-ev-desc').value='';
      byId('sh-ev-start').value=eventLocal(now.toISOString());
      byId('sh-ev-end').value=eventLocal(tomorrow.toISOString());
      byId('sh-ev-status').value='draft';
      ['10000','5000','2500'].forEach((v,i)=>byId('sh-ev-p'+(i+1)).value=v);
      byId('sh-event-save').textContent='Create event';
    }
    if(role==='super'){
      clear();
      byId('sh-event-clear').onclick=clear;
      list.querySelectorAll('[data-sh-event-edit]').forEach(button=>button.onclick=()=>{
        const e=all.find(row=>row.id===Number(button.dataset.shEventEdit));
        if(!e||e.locked)return;
        editing=e.id;
        byId('sh-event-form-title').textContent='✏️ Edit '+e.title;
        byId('sh-ev-title').value=e.title;
        byId('sh-ev-kind').value=e.kind;
        byId('sh-ev-desc').value=e.description||'';
        byId('sh-ev-start').value=eventLocal(e.starts_at);
        byId('sh-ev-end').value=eventLocal(e.ends_at);
        byId('sh-ev-status').value=e.published?'published':e.status;
        (e.prizes||[]).forEach((n,i)=>byId('sh-ev-p'+(i+1)).value=n);
        byId('sh-event-save').textContent='Save event changes';
        byId('sh-event-form-title').scrollIntoView({behavior:'smooth',block:'start'});
      });
      byId('sh-event-save').onclick=async event=>{
        const hint=byId('sh-event-note');
        const p=[1,2,3].map(i=>{
          const raw=byId('sh-ev-p'+i).value.trim();
          return /^\d+$/.test(raw)?Number(raw):NaN;
        });
        const start=Date.parse(byId('sh-ev-start').value);
        const end=Date.parse(byId('sh-ev-end').value);
        if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
          end-start>366*86400000||p.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000)||
          !p.some(n=>n>0)){
          hint.textContent='Use valid dates (max 366 days) and prize coins from 0–1,000,000.';return;
        }
        const payload={title:byId('sh-ev-title').value.trim(),kind:byId('sh-ev-kind').value,
          description:byId('sh-ev-desc').value.trim(),starts_at:new Date(start).toISOString(),
          ends_at:new Date(end).toISOString(),status:byId('sh-ev-status').value,prizes:p};
        if(payload.title.length<3){hint.textContent='Enter an event name of at least 3 characters.';return;}
        if(!window.confirm((editing?'Update event #'+editing:'Create this event')+
          ' with '+p.map(fmt).join(' / ')+' prize coins?'))return;
        const button=event.currentTarget;button.disabled=true;
        try{
          await api(editing?'PATCH':'POST',editing?'events/'+editing:'events',payload);
          note('Event saved to verified server ✓');
          await P.events();
        }catch(error){hint.textContent='Event save failed: '+error.message;}
        finally{button.disabled=false;}
      };
      list.querySelectorAll('[data-sh-event-award]').forEach(button=>button.onclick=async event=>{
        const id=Number(button.dataset.shEventAward),rank=Number(button.dataset.shEventRank);
        const input=byId('sh-ev-recipient-'+id+'-'+rank);
        const public_id=input?.value.trim()||'';
        if(!/^\d{8}$/.test(public_id)){note('Enter the exact 8-digit winning user ID');return;}
        const prize=Number(all.find(e=>e.id===id)?.prizes?.[rank-1]||0);
        if(!window.confirm('Pay '+fmt(prize)+' real wallet coins to user '+public_id+
          ' for event #'+id+' rank '+rank+'? This cannot be undone.'))return;
        // Preserve request ID across a network retry so one tap cannot double credit.
        button.dataset.requestId=button.dataset.requestId||
          'event-award:'+id+':'+rank+':'+crypto.randomUUID();
        button.disabled=true;
        try{
          const result=await api('POST','events/'+id+'/award',{
            rank,public_id,request_id:button.dataset.requestId});
          note(result.duplicate?'Already credited ✓':fmt(result.coins)+' coins paid ✓');
          await P.events();
        }catch(error){note('Prize not paid: '+error.message);button.disabled=false;}
      });
    }
  };

  const verifiedDashboard=P.dash;
  P.dash=async function(){
    if(role!=='staff')return verifiedDashboard();
    const granted=(identity?.permissions||[]).map(p=>STAFF_SCOPES[p]).filter(Boolean);
    byId('pg').innerHTML='<div class="card"><h3>Restricted staff dashboard</h3>'+
      '<p class="n">Verified Firebase staff login. Only your assigned modules are available. Financial actions are audited.</p>'+
      '<p>'+esc(granted.join(' · ')||'No permissions assigned')+'</p></div>';
  };

  // Recover operational menu pages from the old visual-only template.
  // Pages that cannot safely mutate the backend remain explicitly read-only.
  const openVerifiedPage=page=>{window.V=page;window.shell();};
  function verifiedHub(title,body,links){
    const root=byId('pg');
    root.innerHTML=card(title,body);
    const actions=document.createElement('div');
    actions.className='card';
    for(const [label,page] of links){
      const b=document.createElement('button');
      b.type='button';b.className='btn s';b.textContent=label;
      b.style.margin='4px';
      b.onclick=()=>openVerifiedPage(page);
      actions.appendChild(b);
    }
    root.appendChild(actions);
  }
  P.levels=P.premium;
  P.promo=function(){
    verifiedHub('Invite codes & promotions',
      'Real invite links and referral rewards are managed under Check-in, Tasks & Invites. Generic coupon redemption is not yet connected; no simulated promo codes are issued.',
      [['Open verified Invite settings','daily'],['Create event campaign','events']]);
  };
  P.themes=async function(){
    const root=byId('pg');root.innerHTML=card('Room themes','Reading real room theme usage…');
    try{
      const data=await api('GET','theme-usage');
      root.innerHTML='<div class="card"><h3>Actual room backgrounds in use</h3>'+
        '<p class="n">Existing room themes are chosen by room owners. Admin-uploaded themes are not available yet; no demo previews are saved.</p>'+
        window.T(['Theme','Rooms using'],(data.themes||[]).map(t=>[
          esc(t.theme),fmt(t.rooms)
        ]))+'<button class="btn s" id="theme-rooms" type="button">Open real rooms</button></div>';
      byId('theme-rooms').onclick=()=>openVerifiedPage('rooms');
    }catch(error){root.innerHTML=card('Theme usage unavailable',error.message);}
  };
  P.rr=async function(){
    const root=byId('pg');
    if(role!=='super'&&role!=='finance'){
      root.innerHTML=card('Room Reward','Finance or Super Admin access is required.');return;
    }
    root.innerHTML=card('Room Reward','Loading audited room gift shares…');
    try{
      const data=await api('GET','gift-settlements');
      root.innerHTML='<div class="card"><h3>Verified room gift accruals</h3>'+
        '<p class="n">The figures below are room accrual units, not payments to the owner’s wallet. No claim or owner payout is enabled here.</p>'+
        window.T(['Transaction','Room','Sender','Gift','Spent coins','Room share (1/100 units)','Date'],
          (data.settlements||[]).map(x=>[
            fmt(x.transaction_id),esc(x.room_id||'—'),esc(x.sender_id),
            esc(x.gift),fmt(x.spent_coins),fmt(x.room_reward_hundredths),
            esc(x.created_at)
          ]))+'</div>';
    }catch(error){root.innerHTML=card('Room rewards unavailable',error.message);}
  };
  async function readGameMonitor(){
    if(role!=='super'&&role!=='finance')
      throw Error('Finance or Super Admin permission is required');
    return await api('GET','game-monitor');
  }
  P.games=async function(){
    const root=byId('pg');
    root.innerHTML=card('🎮 Real game catalog','Loading server settings…');
    if(!['super','finance'].includes(role)){
      root.innerHTML=card('Games','Only Super Admin can manage games; Finance may view.');
      return;
    }
    try{
      const result=await api('GET','game-catalog');
      const games=Array.isArray(result.games)?result.games:[];
      root.innerHTML='<div class="card"><h3>🎮 Published game engines</h3>'+
        '<p class="n">Switch off a bundled game to hide it in the app and reject NEW bets. Existing bets still settle and historical records stay intact. '+
        'Activate a game to add it back to the room and Home. New HTML game engines need an audited app/server release.</p>'+
        window.T(['Game','Engine','Available','Action'],
          games.map(g=>[
            esc(g.name),esc(g.engine),
            '<label><input type="checkbox" data-game-flag="'+esc(g.id)+'"'+
              (g.enabled?' checked':'')+(role==='super'?'':' disabled')+'> '+
              (g.enabled?'On':'Off')+'</label>',
            role==='super'?'<button class="btn s" type="button" data-game-save="'+esc(g.id)+'">Save</button>':'Read-only'
          ]))+
        '<p class="n" id="sh-game-status" role="status"></p></div>'+
        '<div class="card"><h3>Verified game activity</h3>'+
        '<div id="sh-game-activity">Loading settled games…</div>'+
        '<button type="button" id="game-winners" class="btn s">Show settled winners</button></div>';
      byId('game-winners').onclick=()=>openVerifiedPage('winb');
      root.querySelectorAll('button[data-game-save]').forEach(button=>button.onclick=async ()=>{
        const id=button.dataset.gameSave;
        const input=Array.from(root.querySelectorAll('[data-game-flag]')).find(x=>x.dataset.gameFlag===id);
        const enabled=!!input?.checked;
        const current=games.find(g=>g.id===id);
        if(!current)return;
        if(enabled===current.enabled){byId('sh-game-status').textContent='No changes for '+current.name;return;}
        if(!window.confirm((enabled?'Enable':'Disable')+' '+current.name+
            '? Existing accepted bets remain eligible for settlement.'))return;
        button.disabled=true;
        try{
          await api('PATCH','game-catalog',{id,enabled});
          byId('sh-game-status').textContent=current.name+(enabled?' enabled':' disabled')+' on the verified server ✓';
          await P.games();
        }catch(error){byId('sh-game-status').textContent='Not saved: '+error.message;button.disabled=false;}
      });
      try{
        const data=await readGameMonitor();
        byId('sh-game-activity').innerHTML=window.T(
          ['Engine','Game','Bets','Settled','Winning bets'],
          (data.games||[]).map(g=>[
            esc(g.source),esc(g.game),fmt(g.bets),fmt(g.settled),fmt(g.winning_bets)
          ]));
      }catch(error){byId('sh-game-activity').textContent='Monitoring unavailable: '+error.message;}
    }catch(error){root.innerHTML=card('Game catalog unavailable',error.message);}
  };
  P.winb=async function(){
    const root=byId('pg');root.innerHTML=card('Win announcements','Loading verified winners…');
    try{
      const data=await readGameMonitor();
      root.innerHTML='<div class="card"><h3>Recent confirmed game wins</h3>'+
        '<p class="n">This is a verified read-only settlement history. Game win banners are generated inside the app; this page does not issue fake announcements.</p>'+
        window.T(['User ID','Game','Round','Win coins','Settled UTC'],
          (data.wins||[]).map(w=>[
            esc(w.public_id),esc(w.game),fmt(w.round_no),
            fmt(w.payout_coins),esc(w.settled_at)
          ]))+'</div>';
    }catch(error){root.innerHTML=card('Win history unavailable',error.message);}
  };
  async function featureHealth(){
    return await api('GET','feature-health');
  }
  // Free two-hour Lucky Box is deliberately separate from paid Lucky Gifts.
  P.luckyBox=async function(){
    const root=byId('pg');
    if(role!=='super'){
      root.innerHTML=card('Lucky Box','Only Super Admin may change free-box rewards.');
      return;
    }
    root.innerHTML=card('🎁 Free Lucky Box','Loading server-controlled rewards…');
    try{
      const data=await api('GET','lucky-box');
      if(!root.isConnected)return;
      const cfg=data.settings||{};
      const items=Array.isArray(data.items)?data.items.filter(i=>i.active):[];
      const number=(key,unit='')=>'<label>'+esc(key.replaceAll('_',' '))+
        '<input class="field" type="number" min="0" max="100" data-sh-box-weight="'+esc(key)+
        '" value="'+Number(cfg[key]||0)+'">'+unit+'</label>';
      root.innerHTML='<div class="card" style="border:1.5px solid #e8b45d;background:linear-gradient(145deg,#351447,#1c0a35);color:#ffecc2">'+
        '<h3>🎁 Lucky Box · Free every 2 hours</h3>'+
        '<p class="n">One server-verified opening per user every 2 hours. Frames and entry effects expire after 24 hours. An empty box awards nothing. Paid Lucky Gifts are a separate feature.</p>'+
        '<label><input id="sh-box-enabled" type="checkbox"'+(cfg.enabled?' checked':'')+'> Enable free Lucky Box</label>'+
        '<div class="row"><label>Coin prize <input class="field" id="sh-box-coins" type="number" min="1" max="1000000" value="'+Number(cfg.coin_reward||200)+'"></label>'+
        '<label>Cooldown <input class="field" value="2 hours" disabled></label>'+
        '<label>Temporary items <input class="field" value="24 hours" disabled></label></div>'+
        '<h4>Prize probabilities (must total 100%)</h4><div class="row">'+
        number('coin_weight')+number('frame_weight')+
        number('entry_weight')+number('empty_weight')+'</div>'+
        '<h4>Choose frames and entry effects in the prize pool</h4>'+
        '<p class="n">Add as many of the existing verified artworks as needed. Add new artwork first through Frames, Entry & Name Tags.</p>'+
        '<div id="sh-box-items" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;max-height:320px;overflow:auto">'+
        items.map(item=>'<label style="display:flex;gap:7px;align-items:center;padding:6px;border:1px solid #9b6b9b;border-radius:9px">'+
          '<input type="checkbox" data-box-item="'+esc(item.id)+'"'+(item.in_box?' checked':'')+'>'+
          esc(item.kind==='frame_style'?'🖼️ ':'✨ ')+esc(item.name)+'</label>').join('')+
        '</div><button class="btn s" id="sh-box-save" type="button" style="margin-top:13px">Save Lucky Box settings</button>'+
        '<p id="sh-box-result" class="n" role="status"></p></div>';
      byId('sh-box-save').onclick=async event=>{
        const button=event.currentTarget,status=byId('sh-box-result');
        const keys=['coin_weight','frame_weight','entry_weight','empty_weight'];
        const payload={enabled:byId('sh-box-enabled').checked,
          coin_reward:Number(byId('sh-box-coins').value),
          item_ids:Array.from(root.querySelectorAll('[data-box-item]:checked')).map(x=>x.dataset.boxItem)};
        for(const key of keys)payload[key]=Number(root.querySelector('[data-sh-box-weight="'+key+'"]').value);
        if(keys.reduce((sum,key)=>sum+payload[key],0)!==100||
          !Number.isSafeInteger(payload.coin_reward)||payload.coin_reward<1){
          status.textContent='Prize weights must add to 100%, and coin amount must be positive.';return;
        }
        button.disabled=true;status.textContent='Saving and auditing…';
        try{
          const result=await api('POST','lucky-box',payload);
          status.textContent='Saved! '+result.item_count+' items available in the Lucky Box.';
        }catch(error){status.textContent='Could not save: '+error.message;}
        finally{button.disabled=false;}
      };
    }catch(error){root.innerHTML=card('Lucky Box unavailable',error.message);}
  };

  P.lucky=async function(){
    const root=byId('pg');root.innerHTML=card('Lucky gifts','Checking server switch…');
    try{
      const state=await featureHealth();
      verifiedHub('Lucky gifts · '+(state.lucky_gifts_enabled?'Enabled':'Disabled'),
        state.lucky_gifts_enabled?
          'The staging API reports Lucky gifts enabled. Use the verified gift catalogue to inspect items.':
          'The server’s Lucky-gift switch is off. No admin demo toggle can bypass the server safety gate.',
        [['Open gift catalogue','gifts']]);
    }catch(error){root.innerHTML=card('Lucky gift status unavailable',error.message);}
  };
  P.system=P.config=async function(){
    const root=byId('pg');root.innerHTML=card('Staging services','Checking verified service bindings…');
    try{
      const st=await featureHealth();
      root.innerHTML='<div class="card"><h3>Verified Sharika staging system</h3>'+
        window.T(['Service','Observed state'],[
          ['Environment',esc(st.environment)],
          ['D1 database',st.d1_bound?'Bound':'Unavailable'],
          ['Voice room coordinator',st.voice_rooms_bound?'Bound':'Unavailable'],
          ['Server time (UTC)',esc(st.server_time)]
        ])+'<p class="n">Service bindings are server-reported. External provider health and end-to-end voice calls need their own tests.</p></div>';
    }catch(error){root.innerHTML=card('System status unavailable',error.message);}
  };
  P.flags=async function(){
    const root=byId('pg');root.innerHTML=card('Feature switches','Reading protected staging flags…');
    try{
      const st=await featureHealth();
      root.innerHTML='<div class="card"><h3>Server-enforced feature switches</h3>'+
        window.T(['Feature','Verified state'],[
          ['Lucky gifts',st.lucky_gifts_enabled?'Enabled':'Disabled'],
          ['Cash-redeemable coins',st.cash_redeemable_coins?'Enabled':'Disabled']
        ])+'<p class="n">These are read-only safety switches. Editing requires a separately reviewed server deployment; no fake on/off controls are shown.</p></div>';
    }catch(error){root.innerHTML=card('Feature status unavailable',error.message);}
  };

  // Verified Super Admin notice publisher. Rewards and gifts are automatic
  // from committed server transactions; admins cannot fabricate coin grants here.
  P.push=async function(){
    const root=byId('pg');
    if(role!=='super'){
      root.innerHTML=card('Notifications','Only Super Admin can publish official notices.');return;
    }
    root.innerHTML='<div class="card" style="background:linear-gradient(125deg,#251247,#42256c);'+
      'border:1px solid #be88f3;border-radius:18px;color:#fff">'+
      '<h3>🔔 Official Notifications</h3><p>Send a real in-app notification to verified '+
      'Sharika accounts. Rewards and gifts are announced automatically after a server transaction.</p>'+
      '<p id="sh-push-status">Checking push configuration…</p></div>'+
      '<div class="card" style="border:1px solid #c2a4ef;border-radius:18px">'+
      '<h3>📣 Publish new notice</h3><div class="row" style="gap:10px;flex-wrap:wrap">'+
      '<label>Type <select id="sh-push-kind"><option value="official">Official notice</option>'+
      '<option value="event">Event announcement</option><option value="system">System update</option></select></label>'+
      '<label>Recipients <select id="sh-push-audience"><option value="all">All active members</option>'+
      '<option value="user">One member ID</option></select></label></div>'+
      '<input id="sh-push-id" class="field" maxlength="8" inputmode="numeric" '+
      'placeholder="8-digit member ID" style="display:none;margin:9px 0">'+
      '<input id="sh-push-title" class="field" maxlength="100" '+
      'placeholder="Notice title (up to 100 characters)" style="margin:9px 0">'+
      '<textarea id="sh-push-body" maxlength="1000" rows="5" '+
      'placeholder="Write a clear official notice for members…" '+
      'style="width:100%;min-height:115px;padding:12px;border-radius:12px"></textarea>'+
      '<div class="row" style="gap:10px;align-items:center;margin-top:12px">'+
      '<button type="button" class="btn" id="sh-push-send">Send verified notice</button>'+
      '<small id="sh-push-feedback"></small></div></div>'+
      '<div class="card"><h3>Recent verified notices</h3><div id="sh-push-history">Loading…</div></div>';
    const status=byId('sh-push-status'),history=byId('sh-push-history'),
      audience=byId('sh-push-audience'),target=byId('sh-push-id'),
      submit=byId('sh-push-send'),feedback=byId('sh-push-feedback');
    audience.onchange=()=>{target.style.display=audience.value==='user'?'block':'none';};
    async function refresh(){
      try{
        const data=await api('GET','notifications');
        status.textContent=data.push_configured?
          '✅ FCM configured. Android delivery is attempted to registered devices. Registered devices: '+data.registered_devices:
          '⚠️ Firebase FCM sender not configured on the Worker. In-app inbox delivery works; phone push is not active yet.';
        const rows=(data.campaigns||[]).map(n=>[
          esc(n.title),esc(n.kind),esc(n.body),
          Number(n.recipients)+' member(s)',
          Number(n.read_count)+' read',
          Number(n.push_sent_count)+' pushed',esc(n.created_at)
        ]);
        history.innerHTML=rows.length?window.T(['Title','Type','Message','Audience','Read','Push','Created'],rows):
          '<p class="n">No verified notices published yet.</p>';
      }catch(error){status.textContent='Unable to read status: '+error.message;history.textContent='History unavailable';}
    }
    submit.onclick=async()=>{
      const kind=byId('sh-push-kind').value,title=byId('sh-push-title').value.trim(),
        body=byId('sh-push-body').value.trim(),targetId=target.value.trim();
      if(!title||title.length>100||!body||body.length>1000){
        feedback.textContent='Enter a title and message within the limits.';return;
      }
      if(audience.value==='user'&&!/^[0-9]{8}$/.test(targetId)){
        feedback.textContent='A verified 8-digit member ID is required.';return;
      }
      const who=audience.value==='all'?'ALL active members':'member '+targetId;
      if(!window.confirm('Send this '+kind+' notice to '+who+'?'))return;
      submit.disabled=true;feedback.textContent='Publishing…';
      try{
        const requestId='notification:'+Date.now().toString(36)+':'+
          Math.random().toString(36).slice(2,14);
        const result=await api('POST','notifications',{
          kind,title,body,audience:audience.value,
          public_id:audience.value==='user'?targetId:null,request_id:requestId
        });
        feedback.textContent='Saved for '+result.recipients+' member(s). '+
          (result.push_configured?
            'Device pushes succeeded for '+result.push_sent_to_users+' member(s).':
            'Phone push awaits Firebase configuration.');
        byId('sh-push-title').value='';byId('sh-push-body').value='';
        await refresh();
      }catch(error){feedback.textContent='Not sent: '+error.message;}
      finally{submit.disabled=false;}
    };
    await refresh();
  };

  // The original visual-only dashboard includes demo pages. Replace every
  // unconnected page with an honest staging status while retaining its card
  // layout and menu. No fake sellers, payouts, or active games are displayed.

  // Family/BD administration: only verified Cloudflare D1 results are shown.
  const familyAdminCss=document.createElement('style');
  familyAdminCss.textContent=[
    '#sh-family-admin .sh-fam-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}',
    '#sh-family-admin .sh-fam-card{border:1px solid #d4ad59;background:linear-gradient(145deg,#362620,#1a1525);',
    'border-radius:18px;padding:16px;margin-bottom:14px;box-shadow:inset 0 2px 2px #fff2,0 8px 20px #0004}',
    '#sh-family-admin .sh-fam-card h3{color:#fce09c}',
    '#sh-family-admin input,#sh-family-admin select{padding:10px;border-radius:9px;max-width:100%;margin:5px 0 10px}',
    '#sh-family-admin table{width:100%;border-collapse:collapse;font-size:13px}',
    '#sh-family-admin th,#sh-family-admin td{text-align:left;padding:8px;border-bottom:1px solid #ffffff22}',
    '#sh-family-admin .sh-fam-scroll{overflow:auto;max-height:360px}',
    '#sh-family-admin .sh-fam-pill{display:inline-block;border-radius:20px;padding:4px 10px;',
    'border:1px solid #dab673;background:#604321;color:#ffeab3;font-weight:bold}',
    '#sh-family-admin small{opacity:.85}'
  ].join('');
  document.head.appendChild(familyAdminCss);
  P.agency=async function(){
    const root=byId('pg');
    root.innerHTML='<div id="sh-family-admin"><h2>👑 BD · Agency · Host Center</h2>'+
      '<p class="n">Loading verified D1 policy and salary targets…</p></div>';
    const parent=root.querySelector('#sh-family-admin');
    let data,legacy,applications;
    try{
      [data,legacy,applications]=await Promise.all([api('GET','agency'),
        api('GET','family').catch(()=>({agents:[],families:[]})),
        role==='super'?api('GET','family/creation/requests'):
          Promise.resolve({requests:[]})]);
    }catch(error){parent.innerHTML=card('Agency service unavailable',error.message);return;}
    if(!parent.isConnected)return;
    const p=data.policy||{},s=data.salary_config||{},superAdmin=role==='super';
    const control=(label,id,value,min,max)=>'<label>'+esc(label)+'<input id="'+id+
      '" type="number" min="'+min+'" max="'+max+'" value="'+esc(value)+'"></label>';
    const rows=(columns,records)=>'<div class="sh-fam-scroll"><table><thead><tr>'+
      columns.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
      (records.map(cols=>'<tr>'+cols.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')||
        '<tr><td colspan="'+columns.length+'">No verified records yet</td></tr>')+
      '</tbody></table></div>';
    const section=(name,html)=>'<section class="sh-fam-card"><h3>'+esc(name)+'</h3>'+html+'</section>';
    parent.innerHTML='<h2>👑 BD · Agency · Host Center</h2>'+
      '<p class="n">Family has been removed from navigation; existing Agency membership and '+
      'historic financial records are preserved. All values below come from Cloudflare D1.</p>'+
      section('Verified gift policy • same recipient gift base',
        '<div class="sh-fam-cols">'+
        control('Host salary (4000 = 40%)','ag2-host',p.host_bps,0,8000)+
        control('Agency commission (1000 = 10%)','ag2-agency',p.agency_bps,0,5000)+
        control('BD commission (500 = 5%)','ag2-bd',p.bd_bps,0,3000)+
        '<label>Salary settlement period<select id="ag2-mode">'+
        '<option value="daily">Daily</option><option value="weekly">Weekly</option>'+
        '<option value="monthly">Monthly</option></select></label>'+
        '<label><input type="checkbox" id="ag2-enabled" '+(p.enabled?'checked':'')+
        '> Verified Agency earnings enabled</label></div>'+
        '<p class="n">Changes apply to future settled gifts only. Existing salary entries '+
        'retain their earning percentage.</p>'+
        (superAdmin?'<button class="btn" id="ag2-policy-save">Save Gift Commission Policy</button>':''))+
      section('Salary Wallet • targets & exchange permission',
        '<div class="sh-fam-cols">'+
        control('Coins for $1 reference','ag2-usd',s.coins_per_usd||500000,1,1000000000)+
        '<label>Target tiers, comma-separated coins<input id="ag2-targets" value="'+
        esc((data.targets||[]).join(', '))+'" placeholder="5000000, 10000000, 20000000"></label>'+
        '<label><input type="checkbox" id="ag2-salary-enabled" '+
        (s.exchange_enabled?'checked':'')+'> Allow completed-period Salary Exchange</label></div>'+
        '<p class="n">Initial first target: 5M gift coins. Admin may change any target. '+
        'Salary payouts exchange to main coins, never direct USD. Permission starts OFF. '+
        'Main Wallet Diamond Exchange is a separate editable rate.</p>'+
        (superAdmin?'<button class="btn" id="ag2-salary-save">Save Targets & Salary Permission</button>':''))+
      section('Assigned Hosts',rows(['Agency #','Host ID','Name','State'],
        (data.hosts||[]).map(h=>[esc(h.family_id),esc(h.public_id),esc(h.name),
          h.active?'Active':'Inactive']))+
        (superAdmin?'<div class="sh-fam-cols"><label>Agency #'+
          '<input id="ag2-agency-id" type="number" min="1"></label><label>Approved Host ID'+
          '<input id="ag2-host-id" maxlength="8" inputmode="numeric"></label></div>'+
          '<button class="btn" id="ag2-host-save">Assign Host</button>':''))+
      section('BD Management',rows(['BD ID','Name','Active','Can Grant Agency'],
        (legacy.agents||[]).map(a=>[esc(a.public_id),esc(a.name),
          a.active?'Yes':'No',a.can_grant?'Yes':'No']))+
        (superAdmin?'<div class="sh-fam-cols"><label>BD User ID'+
          '<input id="ag2-bd-id" maxlength="8" inputmode="numeric"></label>'+
          '<label><input type="checkbox" id="ag2-bd-active" checked> Active BD</label>'+
          '<label><input type="checkbox" id="ag2-bd-can-grant" checked> Can grant Agency</label></div>'+
          '<button class="btn" id="ag2-bd-save">Save BD Role</button>':''))+
      section('Create Agency',superAdmin?'<div class="sh-fam-cols">'+
        '<label>Owner ID<input id="ag2-owner-id" maxlength="8" inputmode="numeric"></label>'+
        '<label>Active BD ID<input id="ag2-owner-bd-id" maxlength="8" inputmode="numeric"></label>'+
        '<label>Agency name<input id="ag2-name" maxlength="40"></label></div>'+
        '<button class="btn" id="ag2-create">Create Verified Agency</button>':
        '<p class="n">Super Admin controls Agency creation.</p>')+
      section('Agency Applications • Awaiting Approval',superAdmin?
        rows(['Applicant','Agency Name','Assign Active BD','Decision'],
          (applications.requests||[]).map(a=>[
            esc(a.requester_id)+' · '+esc(a.requester_name),esc(a.name),
            '<input type="text" maxlength="8" inputmode="numeric" '+
              'aria-label="Active BD for Agency application" data-ag2-approval-bd="'+esc(a.id)+'" '+
              'placeholder="BD 8-digit ID">',
            '<button type="button" class="btn s" data-ag2-approve="'+esc(a.id)+'">Approve</button> '+
            '<button type="button" class="btn s" data-ag2-reject="'+esc(a.id)+'">Reject</button>'
          ])):'<p class="n">Super Admin approves Agency applications.</p>')+
      '<p id="ag2-status" role="status" aria-live="polite"></p>';
    byId('ag2-mode').value=p.settlement_mode||'weekly';
    const notice=message=>{const status=byId('ag2-status');if(status)status.textContent=message;};
    const save=async(method,path,payload)=>{
      notice('Saving to verified D1…');
      try{await api(method,path,payload);notice('Saved ✓');await P.agency();}
      catch(error){notice('Not saved: '+String(error?.message||error));}
    };
    byId('ag2-policy-save')?.addEventListener('click',()=>{
      const h=Number(byId('ag2-host').value),a=Number(byId('ag2-agency').value),
        b=Number(byId('ag2-bd').value);
      if(![h,a,b].every(Number.isSafeInteger)||h<0||a<0||b<0||h+a+b>10000)
        return notice('Invalid commission percentage.');
      save('PATCH','agency/policy',{enabled:byId('ag2-enabled').checked,
        host_bps:h,agency_bps:a,bd_bps:b,settlement_mode:byId('ag2-mode').value});
    });
    byId('ag2-salary-save')?.addEventListener('click',()=>{
      const usd=Number(byId('ag2-usd').value);
      const targets=byId('ag2-targets').value.split(',').map(x=>Number(x.trim()));
      if(!Number.isSafeInteger(usd)||usd<1||targets.length<1||targets.length>12||
        targets.some((x,i)=>!Number.isSafeInteger(x)||x<1||x>1000000000000||
          (i>0&&x<=targets[i-1])))return notice('Targets must be unique, ascending whole coin amounts.');
      save('PATCH','agency/salary/policy',{expected_version:s.version,coins_per_usd:usd,
        exchange_enabled:byId('ag2-salary-enabled').checked,targets});
    });
    byId('ag2-host-save')?.addEventListener('click',()=>{
      const id=byId('ag2-host-id').value.trim(),agencyId=Number(byId('ag2-agency-id').value);
      if(!/^[0-9]{8}$/.test(id)||!Number.isSafeInteger(agencyId)||agencyId<1)
        return notice('Enter a verified 8-digit Host ID and Agency number.');
      save('POST','agency/hosts/assign',{agency_id:agencyId,host_public_id:id,active:true});
    });
    byId('ag2-bd-save')?.addEventListener('click',()=>{
      const id=byId('ag2-bd-id').value.trim();
      if(!/^[0-9]{8}$/.test(id))return notice('Enter a verified 8-digit BD ID.');
      save('POST','family/bd',{public_id:id,active:byId('ag2-bd-active').checked,
        can_grant:byId('ag2-bd-can-grant').checked});
    });
    byId('ag2-create')?.addEventListener('click',()=>{
      const owner=byId('ag2-owner-id').value.trim(),bd=byId('ag2-owner-bd-id').value.trim(),
        name=byId('ag2-name').value.trim();
      if(!/^[0-9]{8}$/.test(owner)||!/^[0-9]{8}$/.test(bd)||name.length<3)
        return notice('Enter the Agency name, Owner ID and active BD ID.');
      save('POST','family/create',{owner_public_id:owner,bd_public_id:bd,name,
        request_id:'admin:'+crypto.randomUUID()});
    });
    parent.querySelectorAll('[data-ag2-approve]').forEach(button=>button.onclick=()=>{
      const requestId=button.dataset.ag2Approve;
      const bd=parent.querySelector('[data-ag2-approval-bd="'+requestId+'"]')?.value.trim();
      if(!/^[0-9]{8}$/.test(bd||''))return notice('Assign an active BD 8-digit ID before approval.');
      save('POST','family/creation/requests/'+requestId+'/approve',{bd_public_id:bd});
    });
    parent.querySelectorAll('[data-ag2-reject]').forEach(button=>button.onclick=()=>{
      const reason=window.prompt('Why was this Agency application declined?');
      if(reason===null)return;
      save('POST','family/creation/requests/'+button.dataset.ag2Reject+'/reject',{reason:reason.trim()});
    });
  };
  P.family=async function(){
    const root=byId('pg');
    root.innerHTML='<div id="sh-family-admin"><h2>👑 BD · Agency · Host</h2>'+
      '<p class="n">Verified Agency grants, BD commission, Host gift performance and Crystal settlement. '+
      'Existing Room Gift rewards and original recipient diamonds are unchanged.</p>'+
      '<div class="sh-fam-card">Loading verified records…</div></div>';
    const parent=root.querySelector('#sh-family-admin');
    const notice=t=>{const el=parent?.querySelector('#sh-fam-admin-status');if(el)el.textContent=t;};
    let data, sheets, creationQueue;
    try{
      [data,sheets,creationQueue]=await Promise.all([
        api('GET','family'),api('GET','family/sheets/status'),
        role==='super'?api('GET','family/creation/requests'):Promise.resolve({requests:[]})
      ]);
    }catch(error){
      parent.innerHTML=card('Family service unavailable',error.message+
        '. Apply the new staging migration and Worker before using this panel.');
      return;
    }
    if(!parent.isConnected)return;
    const p=data.policy||{};
    const isSuper=role==='super';
    let agencyData=null,agencyError='';
    try{agencyData=await api('GET','agency');}
    catch(error){agencyError=error.message||'Migration required';}
    const table=(columns,entries)=>'<div class="sh-fam-scroll"><table><thead><tr>'+
      columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
      (entries.length?entries.map(items=>'<tr>'+items.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join(''):
        '<tr><td colspan="'+columns.length+'">No verified records</td></tr>')+
      '</tbody></table></div>';
    const box=(title,contents)=>'<section class="sh-fam-card"><h3>'+esc(title)+'</h3>'+contents+'</section>';
    parent.innerHTML='<h2>👑 BD · Agency · Host Control Center</h2>'+
      '<p class="n">Existing Family records are preserved as Agencies. Host gift rankings and personal statements are available inside the app; no salary has been credited.</p>'+
      '<div class="sh-fam-cols">'+
      box('🏰 Registered Agencies','<span class="sh-fam-pill">'+
        esc((data.families||[]).length)+'</span><p>Approved Agency records shown below.</p>')+
      box('👥 Hosts & Members','<span class="sh-fam-pill">'+
        esc((data.families||[]).reduce((total,f)=>total+Number(f.member_count||0),0))+
        '</span><p>Members in listed Agencies.</p>')+
      box('💼 Host Salary Policy','<span class="sh-fam-pill">Not configured</span>'+
        '<p>No Host salary is auto-paid. A future payout policy must define targets, rates, and Admin approval first.</p>')+
      box('💼 BD Commission','<span class="sh-fam-pill">'+
        esc(Number(p.bd_bps||0)/100)+'%</span><p>Family Owner: '+
        esc(Number(p.owner_bps||0)/100)+'% · Mode: '+esc(p.settlement_mode||'monthly')+'</p>')+
      box('💎 Crystal Conversion','<span class="sh-fam-pill">'+
        (p.conversion_enabled?'Enabled':'Disabled')+'</span><p>'+
        esc(p.coins_per_crystal||1)+' coins per whole Crystal. Admin approval required.</p>')+
      box('📊 Google Sheets','<span class="sh-fam-pill">'+
        (sheets.last_synced_at?'Synced':'Authorization / first sync pending')+'</span><p>Last sync: '+
        esc(sheets.last_synced_at||'Never')+'</p>'+
        '<p class="n">Automatic Google Apps Script mirror every 5 minutes; no service-account key needed.</p>'+
        '<button class="btn" id="sh-fam-report-day">Daily Statement</button>'+
        '<button class="btn" id="sh-fam-report-week">Weekly Statement</button>'+
        '<button class="btn" id="sh-fam-report-month">Monthly Statement</button>'+
        (isSuper?'<button class="btn" id="sh-fam-sync" '+
          (sheets.configured?'':'disabled')+'>Sync Google Sheet</button>':''))+
      '</div>'+
      (isSuper?box('⚙️ Commission & Family Policy',
        '<div class="sh-fam-cols"><label>BD commission (basis points; 500 = 5%)'+
        '<input id="sh-fam-bd-bps" type="number" min="0" max="1000" value="'+esc(p.bd_bps)+'"></label>'+
        '<label>Owner commission (1000 = 10%)'+
        '<input id="sh-fam-owner-bps" type="number" min="0" max="2000" value="'+esc(p.owner_bps)+'"></label>'+
        '<label>Settlement period<select id="sh-fam-period"><option value="daily">Daily</option>'+
        '<option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>'+
        '<label>Max family members<input type="number" id="sh-fam-max-members" min="2" max="200" value="'+
        esc(p.max_members)+'"></label>'+
        '<label>Coins per Crystal<input type="number" id="sh-fam-rate" min="1" max="10000" value="'+
        esc(p.coins_per_crystal)+'"></label>'+
        '<label><input type="checkbox" id="sh-fam-enabled" '+(p.enabled?'checked':'')+
        '> Family active</label><label><input type="checkbox" id="sh-fam-conversion" '+
        (p.conversion_enabled?'checked':'')+'> Permit seller conversion</label></div>'+
        '<p class="n">Rates affect only future gifts. Turning on conversion allows audited seller-stock credits.</p>'+
        '<button class="btn" id="sh-fam-policy-save">Save Future Policy</button>')+
        box('🗝️ Assign BD Permission',
          '<label>User 8-digit ID<input id="sh-fam-bd-id" maxlength="8" inputmode="numeric" placeholder="12345678"></label>'+
          '<label><input type="checkbox" id="sh-fam-bd-active" checked> BD active</label>'+
          '<label><input type="checkbox" id="sh-fam-bd-grant" checked> Can grant Families</label>'+
          '<button class="btn" id="sh-fam-bd-save">Save BD Permission</button>'+
          '<p class="n">Removing BD immediately stops FUTURE BD commissions. Existing Families, members, Family Owner commissions and Crystal ledger stay unchanged.</p>')+
        box('👑 Pending Family Applications',
          '<p class="n">A user submits a Family name; only Super Admin approval creates it on their own ID. Assign a verified active BD for future commissions.</p>'+
          table(['Request','Applicant','Proposed Family','Country','Assigned BD','Decision'],
          (creationQueue.requests||[]).map(x=>[
            '#'+esc(x.id),esc(x.requester_name)+' · '+esc(x.requester_id),
            esc(x.name)+'<small style="display:block">'+esc(x.description||'')+'</small>',
            esc(x.country||'—'),
            '<input aria-label="Active BD ID for request '+esc(x.id)+'" inputmode="numeric" maxlength="8" data-fam-assign-bd="'+esc(x.id)+'" value="'+
              esc(((data.agents||[]).find(b=>b.active)||{}).public_id||'')+'">',
            '<button class="btn s" data-fam-approve-creation="'+esc(x.id)+'">Approve</button>'+
            '<button class="btn s" data-fam-reject-creation="'+esc(x.id)+'">Reject</button>'
          ])))+
        box('🏰 Admin Create Family',
          '<label>Owner 8-digit ID<input id="sh-fam-create-owner" maxlength="8" inputmode="numeric"></label>'+
          '<label>Active BD 8-digit ID<input id="sh-fam-create-bd" maxlength="8" inputmode="numeric"></label>'+
          '<label>Unique Family Name<input id="sh-fam-create-name" maxlength="40"></label>'+
          '<button class="btn" id="sh-fam-create">Create Family</button>')+
        box('👥 Family Member & Leadership Control',
          '<label>Family ID<input id="sh-fam-manage-id" type="number" min="1" placeholder="Family #"></label>'+
          '<button class="btn" id="sh-fam-load-members">View Members</button>'+
          '<div id="sh-fam-roster"></div>'+
          '<label>User 8-digit ID<input id="sh-fam-manage-user" maxlength="8" inputmode="numeric"></label>'+
          '<button class="btn" id="sh-fam-member-add">Add Member (Admin)</button>'+
          '<button class="btn" id="sh-fam-member-remove">Remove Member</button>'+
          '<button class="btn" id="sh-fam-owner-transfer">Make User Family Owner</button>'+
          '<label>New Active BD 8-digit ID<input id="sh-fam-manage-bd" maxlength="8" inputmode="numeric"></label>'+
          '<button class="btn" id="sh-fam-bd-transfer">Reassign Family BD</button>'+
          '<p class="n">Only Super Admin may directly manage members. BD accounts cannot remove Family members. Transfer Family ownership before removing its current owner.</p>'):'')+
      box('👑 Registered Families',table(['Family','Owner','BD','Members','State','Action'],
        (data.families||[]).map(x=>[
          esc(x.name)+' · #'+esc(x.id),esc(x.owner_id),esc(x.bd_id),
          esc(x.member_count),esc(x.status)+' · BD '+(x.bd_active?'active':'inactive'),
          isSuper?'<button class="btn s" data-sh-fam-status="'+esc(x.id)+
            '" data-next="'+(x.status==='active'?'suspended':'active')+'">'+
            (x.status==='active'?'Suspend':'Reactivate')+'</button>'+
            '<button class="btn s" data-sh-fam-manage="'+esc(x.id)+'">Manage</button>':'—'])))+
      box('💼 BD Accounts',table(['BD ID','Name','Active','Can Grant','Admin Action'],
        (data.agents||[]).map(x=>[esc(x.public_id),esc(x.name),
          x.active?'Yes':'No',x.can_grant?'Yes':'No',
          isSuper?'<button class="btn s" data-sh-fam-bd-toggle="'+esc(x.public_id)+'" data-next="'+(x.active?'off':'on')+'">'+(x.active?'Remove BD':'Restore BD')+'</button>':'—'])))+
      box('💎 Crystal → Seller Transfer Requests',table(
        ['ID','From','Seller','Crystals','Status','Action'],
        (data.transfers||[]).map(x=>[
          esc(x.id),esc(x.sender_id),esc(x.seller_id),
          esc((Number(x.crystal_units||0)/10000).toLocaleString('en-US')),
          esc(x.status),
          isSuper&&x.status==='pending'?
            '<button class="btn s" data-sh-fam-approve="'+esc(x.id)+'">Approve</button>'+
            '<button class="btn s" data-sh-fam-reject="'+esc(x.id)+'">Reject</button>':'—'
        ])))+
      '<p id="sh-fam-admin-status" role="status" aria-live="polite"></p>'+
      '<div id="sh-fam-report-results"></div>';
    const ap=agencyData?.policy||{};
    const agencyBox=box('🏆 Agency / BD / Host Earnings Policy',
      !agencyData?'<p class="n">Agency service not connected: '+esc(agencyError)+
        '. Deploy migration 0059 with the Worker to enable live controls.</p>':
      '<p class="n">Real Host gifts → 100% diamonds. The separate Diamond Exchange editor is ' +
        'set to 100 diamonds → 40 coins by the new migration only if the old 100:70 rate was unchanged. ' +
        'Host salary, Agency and BD amounts are pending estimates, not wallet payments.</p>'+
      '<div class="sh-fam-cols">'+
      '<label>Host salary (4000 = 40%)<input id="sh-ag-host" type="number" min="0" max="8000" value="'+esc(ap.host_bps)+'"></label>'+
      '<label>Agency share (1000 = 10%)<input id="sh-ag-agency" type="number" min="0" max="5000" value="'+esc(ap.agency_bps)+'"></label>'+
      '<label>BD share (500 = 5%)<input id="sh-ag-bd" type="number" min="0" max="3000" value="'+esc(ap.bd_bps)+'"></label>'+
      '<label>Salary statement period<select id="sh-ag-period"><option value="daily">Daily</option>'+
      '<option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>'+
      '<label><input id="sh-ag-enabled" type="checkbox" '+(ap.enabled?'checked':'')+'> Agency earnings active</label></div>'+
      '<p class="n">New policy applies only to future verified regular gifts. ' +
      'Current Room Reward and legacy Family Crystal ledgers stay separate. ' +
      'Admin verification is required before any real salary payout.</p>'+
      (isSuper?'<button class="btn" id="sh-ag-policy-save">Save Agency Policy</button>':'')+
      '<h4>Host role assignment</h4>'+table(['Agency ID','Host ID','Name','State'],
        (agencyData.hosts||[]).map(h=>[esc(h.family_id),esc(h.public_id),
          esc(h.name),h.active?'Active':'Inactive']))+
      (isSuper?'<div class="sh-fam-cols"><label>Agency / Family ID'+
        '<input id="sh-ag-family-id" type="number" min="1" placeholder="Family #"></label>'+
        '<label>Approved adult Host ID<input id="sh-ag-host-id" maxlength="8" inputmode="numeric"></label>'+
        '<label>Host status<select id="sh-ag-host-state"><option value="on">Active</option>'+
        '<option value="off">Deactivate</option></select></label></div>'+
        '<button class="btn" id="sh-ag-host-save">Save Host Role</button>':''));
    parent.querySelector('.sh-fam-cols')?.insertAdjacentHTML('beforeend',agencyBox);
    const selected=byId('sh-fam-period');
    if(selected)selected.value=p.settlement_mode||'monthly';
    if(agencyData&&byId('sh-ag-period'))byId('sh-ag-period').value=ap.settlement_mode||'weekly';
    const reload=()=>P.family();
    const trySave=async(method,route,payload,confirmation)=>{
      if(confirmation&&!window.confirm(confirmation))return;
      notice('Saving to verified D1…');
      try{await api(method,route,payload);notice('Saved ✓');await reload();}
      catch(error){notice('Not saved: '+error.message);}
    };
    byId('sh-ag-policy-save')?.addEventListener('click',()=>{
      const host=Number(byId('sh-ag-host').value),agency=Number(byId('sh-ag-agency').value),
        bd=Number(byId('sh-ag-bd').value);
      if(![host,agency,bd].every(Number.isSafeInteger)||host<0||agency<0||bd<0||
        host+agency+bd>10000)return notice('Agency shares must be whole basis points, total maximum 100%.');
      trySave('PATCH','agency/policy',{enabled:byId('sh-ag-enabled').checked,
        host_bps:host,agency_bps:agency,bd_bps:bd,
        settlement_mode:byId('sh-ag-period').value},
      'Apply Host / Agency / BD percentages to FUTURE gifts only?');
    });
    byId('sh-ag-host-save')?.addEventListener('click',()=>{
      const family=Number(byId('sh-ag-family-id').value),id=byId('sh-ag-host-id').value.trim(),
        active=byId('sh-ag-host-state').value==='on';
      if(!Number.isSafeInteger(family)||family<1||!/^[0-9]{8}$/.test(id))
        return notice('Enter a valid Agency ID and 8-digit Host ID.');
      trySave('POST','agency/hosts/assign',{agency_id:family,host_public_id:id,active},
        'Change Host role for '+id+'? They must already be an approved adult Agency member.');
    });
    parent.querySelectorAll('[data-fam-approve-creation]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.famApproveCreation;
        const bd=parent.querySelector('[data-fam-assign-bd="'+id+'"]')?.value?.trim()||'';
        if(!/^[0-9]{8}$/.test(bd))return notice('Enter an active BD 8-digit ID first.');
        trySave('POST','family/creation/requests/'+id+'/approve',{bd_public_id:bd},
          'Approve Family application #'+id+' and create the Family under its applicant?');
      };
    });
    parent.querySelectorAll('[data-fam-reject-creation]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.famRejectCreation;
        const reason=window.prompt('Optional reason for declining Family application #'+id,'');
        if(reason===null)return;
        trySave('POST','family/creation/requests/'+id+'/reject',{reason:reason.trim()},
          'Reject Family application #'+id+'?');
      };
    });
    byId('sh-fam-bd-save')?.addEventListener('click',()=>{
      const id=byId('sh-fam-bd-id').value.trim();
      if(!/^[0-9]{8}$/.test(id))return notice('Enter a verified 8-digit user ID');
      trySave('POST','family/bd',{
        public_id:id,active:byId('sh-fam-bd-active').checked,
        can_grant:byId('sh-fam-bd-grant').checked
      },'Update BD permission for '+id+'?');
    });
    byId('sh-fam-create')?.addEventListener('click',()=>{
      const owner=byId('sh-fam-create-owner').value.trim(),bd=byId('sh-fam-create-bd').value.trim();
      const name=byId('sh-fam-create-name').value.trim();
      if(!/^[0-9]{8}$/.test(owner)||!/^[0-9]{8}$/.test(bd)||name.length<3)
        return notice('Enter valid Owner ID, active BD ID and Family Name.');
      trySave('POST','family/create',{owner_public_id:owner,bd_public_id:bd,name,
        request_id:'admin:'+crypto.randomUUID()},'Create '+name+' for '+owner+'?');
    });
    const familySelection=()=>String(byId('sh-fam-manage-id')?.value||'').trim();
    const familyMember=()=>String(byId('sh-fam-manage-user')?.value||'').trim();
    const validFamily=()=>/^[1-9][0-9]{0,9}$/.test(familySelection());
    const validMember=()=>/^[0-9]{8}$/.test(familyMember());
    const viewFamilyRoster=async()=>{
      if(!validFamily())return notice('Enter a valid Family ID.');
      notice('Loading Family members…');
      try{
        const r=await api('GET','family/'+familySelection()+'/members');
        const list=r.members||[];
        byId('sh-fam-roster').innerHTML='<h4>'+esc(r.family.name)+' · '+list.length+' members</h4>'+
          table(['ID','Name','Role','Action'],list.map(m=>[
            esc(m.public_id),esc(m.name),esc(m.role),
            '<button class="btn s" data-sh-fam-select-member="'+esc(m.public_id)+'">Select</button>']));
        byId('sh-fam-roster').querySelectorAll('[data-sh-fam-select-member]').forEach(b=>
          b.onclick=()=>{byId('sh-fam-manage-user').value=b.dataset.shFamSelectMember;});
        notice('Member list loaded ✓');
      }catch(error){notice('Members unavailable: '+error.message);}
    };
    byId('sh-fam-load-members')?.addEventListener('click',viewFamilyRoster);
    const chosenMember=()=>validFamily()&&validMember();
    byId('sh-fam-member-add')?.addEventListener('click',()=>{
      if(!chosenMember())return notice('Enter Family ID and 8-digit User ID.');
      trySave('POST','family/'+familySelection()+'/members/add',{public_id:familyMember()},
        'Admin add user '+familyMember()+' directly to Family #'+familySelection()+'?');
    });
    byId('sh-fam-member-remove')?.addEventListener('click',()=>{
      if(!chosenMember())return notice('Enter Family ID and 8-digit User ID.');
      trySave('POST','family/'+familySelection()+'/members/'+familyMember()+'/remove',{},
        'Remove member '+familyMember()+' from Family #'+familySelection()+'? Historical earnings remain.');
    });
    byId('sh-fam-owner-transfer')?.addEventListener('click',()=>{
      if(!chosenMember())return notice('Select an existing Family member.');
      trySave('POST','family/'+familySelection()+'/owner',{owner_public_id:familyMember()},
        'Transfer Family ownership to '+familyMember()+'? This changes future Owner commissions.');
    });
    byId('sh-fam-bd-transfer')?.addEventListener('click',()=>{
      const bd=byId('sh-fam-manage-bd').value.trim();
      if(!validFamily()||!/^[0-9]{8}$/.test(bd))return notice('Enter Family ID and new active BD ID.');
      trySave('POST','family/'+familySelection()+'/bd',{bd_public_id:bd},
        'Change assigned BD for Family #'+familySelection()+'? Historical earnings remain.');
    });
    parent.querySelectorAll('[data-sh-fam-manage]').forEach(btn=>{
      btn.onclick=()=>{
        byId('sh-fam-manage-id').value=btn.dataset.shFamManage;
        viewFamilyRoster();
        byId('sh-fam-manage-id').scrollIntoView({behavior:'smooth',block:'center'});
      };
    });
    parent.querySelectorAll('[data-sh-fam-bd-toggle]').forEach(btn=>{
      btn.onclick=()=>{
        const id=btn.dataset.shFamBdToggle,active=btn.dataset.next==='on';
        trySave('POST','family/bd',{public_id:id,active,can_grant:active},
          (active?'Restore':'Remove')+' BD status for '+id+'? Family ownership and old commissions remain.');
      };
    });
    byId('sh-fam-policy-save')?.addEventListener('click',()=>{
      const bd=Number(byId('sh-fam-bd-bps').value),owner=Number(byId('sh-fam-owner-bps').value);
      if(!Number.isSafeInteger(bd)||!Number.isSafeInteger(owner)||bd+owner>2500)
        return notice('Commission values must be integers with a combined maximum 25%.');
      trySave('PATCH','family/policy',{
        enabled:byId('sh-fam-enabled').checked,
        conversion_enabled:byId('sh-fam-conversion').checked,
        bd_bps:bd,owner_bps:owner,settlement_mode:byId('sh-fam-period').value,
        max_members:Number(byId('sh-fam-max-members').value),
        coins_per_crystal:Number(byId('sh-fam-rate').value)
      },'Save these rules for FUTURE gifts? Existing Crystal entries do not change.');
    });
    parent.querySelectorAll('[data-sh-fam-approve],[data-sh-fam-reject]').forEach(btn=>{
      btn.onclick=()=>{
        const yes=btn.dataset.shFamApprove;
        const id=yes||btn.dataset.shFamReject;
        trySave('POST','family/transfers/'+id+'/'+(yes?'approve':'reject'),{},
          yes?'Approve conversion of verified Crystal to seller coin stock?':
              'Reject this Crystal transfer and release the reserved balance?');
      };
    });
    parent.querySelectorAll('[data-sh-fam-status]').forEach(button=>{
      button.onclick=()=>{
        const id=button.dataset.shFamStatus,status=button.dataset.next;
        trySave('POST','family/'+id+'/status',{status},
          (status==='suspended'?'Suspend':'Reactivate')+' Family #'+id+
          '? Suspended Families receive no new Gift commissions.');
      };
    });
    byId('sh-fam-sync')?.addEventListener('click',()=>trySave('POST','family/sheets/sync',{},
      'Sync the verified staging ledger to the linked Google Sheet now?'));
    for(const [id,period] of [['sh-fam-report-day','day'],['sh-fam-report-week','week'],['sh-fam-report-month','month']]){
      byId(id)?.addEventListener('click',async()=>{
        notice('Loading verified '+period+' entries…');
        try{
          const result=await api('GET','family/report?period='+period);
          const view=byId('sh-fam-report-results');
          if(!view)return;
          const list=result.rows||[];
          view.innerHTML=box(period==='day'?'Daily Commission Statement':period==='week'?'Weekly Commission Statement':'Monthly Commission Statement',
            '<p class="n">'+esc(result.activity?.gift_events||0)+' Family gift events ('+
            esc(result.activity?.gift_coins||0)+' coins of gifts). '+
            list.length+' earned Crystal commission entries. '+
            (result.truncated?'Result capped at 1000; export paginated data before final accounting.':'')+'</p>'+
            table(['Date','Family','Sender ID','Beneficiary ID','Type','Crystal'],
              list.slice(-100).reverse().map(x=>[
                esc(x.created_at),esc(x.family_name),esc(x.sender_id),
                esc(x.beneficiary_id),esc(x.kind),esc(x.crystal_units/10000)]))+
            '<button class="btn" id="sh-fam-csv">Download CSV Evidence</button>');
          byId('sh-fam-csv').onclick=()=>{
            const header=['ledger_id','timestamp_utc','family_id','family_name','gift_tx_id',
              'sender_id','beneficiary_id','kind','rate_bps','crystal_units'];
            const cell=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
            const csv=[header.join(',')].concat(list.map(x=>[
              x.id,x.created_at,x.family_id,x.family_name,x.transaction_id,x.sender_id,
              x.beneficiary_id,x.kind,x.rate_bps,x.crystal_units].map(cell).join(','))).join('\r\n');
            const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
            const link=document.createElement('a');const url=URL.createObjectURL(blob);
            link.href=url;link.download='Sharika-Family-'+period+'-'+
              new Date().toISOString().slice(0,10)+'.csv';
            document.body.appendChild(link);link.click();link.remove();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
          };
          notice('Report loaded ✓');
        }catch(error){notice('Report unavailable: '+error.message);}
      });
    }
  };

  // A discoverable, permission-aware shortcut above the dashboard counters.
  // Sensitive Family and Google Sheets operations still require server-side roles.
  const verifiedFamilyDashboard=P.dash;
  P.dash=async function(){
    await verifiedFamilyDashboard();
    if(window.V!=='dash')return;
    const root=byId('pg');
    if(!root)return;
    if(role==='super'||role==='finance'){
      const shortcut=document.createElement('section');
      shortcut.className='card';
      shortcut.style.cssText='border:1px solid #d4ad59;background:linear-gradient(120deg,#35241a,#1b1526);margin-bottom:16px';
      shortcut.innerHTML='<h3>👑 BD · Agency · Host System</h3>'+
        '<p class="n">Family grants, 5% BD commission, Crystal ledger, weekly/monthly reports and Google Sheets Sync.</p>'+
        '<button type="button" class="btn" id="sh-open-family-admin">Open Family & BD System</button>';
      root.insertBefore(shortcut,root.firstChild);
      shortcut.querySelector('button').onclick=()=>{
        window.V='family';window.shell();
      };
    }
  };

  const verifiedPages=new Set([
    'family','dash','analytics','users','support','rooms','ledger','sellers','daily','events','premium','bonds','rech','money','store','md','gifts','cosmetics','luckyBox','profileDesigner','rank','audit','admins','system','banners','opening','levels','promo','themes','rr','games','winb','lucky','config','flags','push'
  ]);
  for(const entry of window.NAV||[]) {
    const key=entry[0];
    if(!key||verifiedPages.has(key))continue;
    P[key]=function(){
      const root=byId('pg');
      const label=entry[2]||key;
      const message=key==='rech'
        ?'Recharge requests are sent to the verified Support Inbox for manual checking. No automatic coins are credited.'
        :key==='money'
        ?'Verified diamond exchange rate: 100 diamonds = 70 coins. Package and rate editing are not yet enabled.'
        :'This module is not connected to the verified staging backend yet. Demo data and fake actions are disabled.';
      root.innerHTML=card(label,message);
      if(key==='rech'){
        const open=document.createElement('button');
        open.type='button';open.className='btn';open.textContent='Open verified Support Inbox';
        open.onclick=()=>{window.V='support';window.shell();};
        root.querySelector('.card')?.appendChild(open);
      }
    };
  }
  async function restore() {
    if (!session) {window.login();return;}
    try {await verifyAdmin();window.V='dash';window.shell();}
    catch (_) {save(null);window.login();}
  }
  restore();
})();
