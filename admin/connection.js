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
  async function verifyAdmin() {
    const status = await api('GET','status');
    if (!['super','support','finance','staff'].includes(status.role))
      throw new Error('Admin role not assigned');
    role = status.role;
    identity = status;
    window.NAV=role==='staff'?NAV_ALL.filter(item=>
      !item[0]||Object.prototype.hasOwnProperty.call(allowedStaffPage,item[0])&&
      (!allowedStaffPage[item[0]]||status.permissions?.includes(allowedStaffPage[item[0]]))
    ):(role==='super'?NAV_ALL.slice():NAV_ALL.filter(item=>item[0]!=='specialIds'));
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
    .sid-plate strong{font-size:clamp(30px,4vw,55px);line-height:1.25;color:#f6f0ff;
      letter-spacing:.08em;text-shadow:0 0 18px #93d5ff}
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
      '<p class="sid-caption">Neon ID displayed on profile and room seats</p>'+
      '<div class="sid-room"><div class="sid-seat"><div class="sid-seat-ring" id="sid-seat-face">?</div>'+
      '<span id="sid-seat-id">—</span></div>'+
      '<div class="sid-hint">Room seat preview · permanent account remains unchanged</div></div>'+
      '</section><section class="sid-editor"><h2 class="sid-edit-title">Assign Special ID</h2>'+
      '<p class="sid-hint">Only verified Sharika accounts can receive a unique ID.</p>'+
      '<label for="sid-account">Permanent Account ID</label>'+
      '<input id="sid-account" readonly placeholder="Select a verified member">'+
      '<label for="sid-value">Special ID (4–7 digits)</label>'+
      '<input id="sid-value" inputmode="numeric" maxlength="7" autocomplete="off" placeholder="777777">'+
      '<label for="sid-days">Duration</label><select id="sid-days">'+
      '<option value="30">30 days</option><option value="7">7 days</option>'+
      '<option value="90">90 days</option><option value="">Permanent</option></select>'+
      '<label>Frame</label><input readonly value="Neon Purple–Blue">'+
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
      save.disabled=!selected||selected.status!=='active'||!/^[0-9]{4,7}$/.test(value.value.trim());
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
      if(!/^[0-9]{4,7}$/.test(proposed)){status.textContent='Use 4–7 numeric digits.';return;}
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
      '<p class="n">Current rates are shown below. Only future verified grants use updated settings; historical coin and USD receipts remain unchanged.</p>'+
      '<div id="daily-invite-report">Loading verified referrals…</div></div>'+
      '<div class="card"><h3>⚙️ Invitation, recharge & payout settings</h3>'+
      '<p class="n">Super Admin may edit all reward values. USD options are in cents (5000 = $50). Changes apply to future transactions only.</p>'+
      '<div class="row" id="daily-invite-rules-fields">Loading…</div>'+
      (role==='super'?'<button class="btn s" id="daily-invite-rules-save" type="button">Save all invite rules</button>':'')+
      '<p class="n" id="daily-invite-rules-status"></p></div>'+
      '<div class="card"><h3>💵 Invite USD review & withdrawals</h3>'+
      '<p class="n">Dollar earnings must be screened for fake accounts. Do NOT mark a withdrawal paid before external payout and identity verification. Coin balances do not convert to cash.</p>'+
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
        window.T(['Cash earning state','US cents','Referrals'],
          (invites.usd_earning_totals||[]).map(r=>[esc(r.status),fmt(r.cents),fmt(r.count)]))+table;
    }catch(error){byId('daily-invite-report').textContent=error.message;}
    const ruleSpecs=[
      ['inviter_coins','Inviter coins',0,1000000],
      ['invitee_coins','New member coins',2000,1000000],
      ['invite_usd_cents','Inviter USD cents',0,10000],
      ['inviter_recharge_percent','Referrer recharge %',0,50],
      ['first_recharge_percent','First recharge bonus %',0,100],
      ['recharge_coins_per_usd','Coins per $1',1000,1000000],
      ['withdrawal_option_1_cents','Withdrawal #1 cents',1000,1000000],
      ['withdrawal_option_2_cents','Withdrawal #2 cents',1000,1000000],
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
        if(next.withdrawal_option_1_cents>=next.withdrawal_option_2_cents){
          note('Withdrawal option #1 must be less than #2');return;
        }
        if(!window.confirm('Apply these rates to all FUTURE Sharika invitations, first recharges and withdrawal requests?'))return;
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
      const [earningData,withdrawData,inboxData]=await Promise.all([
        api('GET','invites/earnings'),api('GET','invites/withdrawals'),
        api('GET','invites/inbox')
      ]);
      const earn=(earningData.earnings||[]).filter(x=>x.status==='pending');
      const withdrawals=(withdrawData.withdrawals||[]).filter(x=>x.status==='pending');
      const unread=(inboxData.messages||[]).filter(x=>x.status==='pending');
      reviewPanel.innerHTML='<h4>🔔 Owner finance inbox · '+fmt(unread.length)+
        ' waiting bank withdrawal messages</h4>'+
        (unread.length?window.T(['Message','User ID','Requested'],unread.map(x=>[
          '🏦 Bank withdrawal #'+fmt(x.withdrawal_id)+' · $'+
          (Number(x.amount_cents)/100).toFixed(2),esc(x.user_id),
          esc(x.created_at||'')])):'<p class="n">No new bank withdrawal requests.</p>')+
        '<h4>Pending referral cash earnings</h4>'+
        window.T(['Inviter','New user','USD','Review'],earn.map(x=>[
          esc(x.inviter_id),esc(x.referred_id),'$'+(x.amount_cents/100).toFixed(2),
          '<button class="btn s" type="button" data-invite-verify="'+esc(x.referred_id)+
          '" data-approve="yes">Approve</button> '+
          '<button class="btn s" type="button" data-invite-verify="'+esc(x.referred_id)+
          '" data-approve="no">Reject</button>'
        ]))+'<h4>Pending withdrawal requests</h4>'+
        window.T(['Request','User ID','USD','Bank / finance review'],withdrawals.map(x=>[
          fmt(x.id),esc(x.public_id),'$'+(x.amount_cents/100).toFixed(2),
          '<span>🏦 •••• '+esc(x.bank_account_last4||'not supplied')+'</span> ' +
          '<button class="btn s" type="button" data-invite-bank="'+fmt(x.id)+'">View bank details</button> '+
          '<button class="btn s" type="button" data-invite-withdraw-review="'+fmt(x.id)+
          '" data-review-status="paid">Confirm paid</button> '+
          '<button class="btn s" type="button" data-invite-withdraw-review="'+fmt(x.id)+
          '" data-review-status="rejected">Reject</button>'
        ]))+'<p class="n">Only completed external payments may be marked paid. '+
        'This panel does not initiate a bank or mobile-money transfer.</p>'+
        '<div id="sh-invite-bank-detail" class="n" aria-live="polite"></div>';
      reviewPanel.onclick=async event=>{
        const earning=event.target.closest('[data-invite-verify]');
        const payout=event.target.closest('[data-invite-withdraw-review]');
        const bank=event.target.closest('[data-invite-bank]');
        if(!earning&&!payout&&!bank)return;
        const button=earning||payout||bank;if(button.disabled)return;
        button.disabled=true;
        try{
          if(bank){
            const detail=await api('GET','invites/withdrawals/'+bank.dataset.inviteBank);
            const record=detail.bank||{};
            byId('sh-invite-bank-detail').innerHTML='<div class="card">'+
              '<b>🔐 Restricted bank transfer instructions · #'+fmt(detail.id)+'</b>'+
              '<p>Name: '+esc(detail.name)+' · User '+esc(detail.user_id)+'</p>'+
              '<p>Bank: '+esc(record.bank_name)+'</p>'+
              '<p>Account holder: '+esc(record.account_holder)+'</p>'+
              '<p>Account number: '+esc(record.account_number)+'</p>'+
              '<p>Branch: '+esc(record.branch)+'</p>'+
              '<p>Amount: $'+(Number(detail.amount_cents)/100).toFixed(2)+'</p>'+
              '<p>Transfer manually outside Sharika, then record the payment reference.</p></div>';
          }else if(earning){
            const approved=earning.dataset.approve==='yes';
            if(!window.confirm((approved?'Approve':'Reject')+' USD earning from '+
              earning.dataset.inviteVerify+' after checking the real account?'))return;
            await api('POST','invites/earnings/verify',{
              referred_public_id:earning.dataset.inviteVerify,approved
            });
          }else{
            const paid=payout.dataset.reviewStatus==='paid';
            let reference='';
            if(paid){
              if(!window.confirm('Have you VERIFIED the identity and ALREADY PAID this '+
                'withdrawal outside Sharika? This will NOT transfer funds.'))return;
              reference=(window.prompt('Enter the confirmed external payment transaction ID')||'').trim();
              if(!/^[A-Za-z0-9:/._-]{8,120}$/.test(reference))throw Error('Valid payment reference required');
            }else if(!window.confirm('Reject this withdrawal and release its reserved USD?'))return;
            await api('POST','invites/withdrawals/review',{
              withdrawal_id:Number(payout.dataset.inviteWithdrawReview),
              status:paid?'paid':'rejected',payment_reference:reference,
              confirm_identity_verified:paid,confirm_external_payment:paid
            });
          }
          await P.daily();
        }catch(error){note('Cash review failed: '+error.message);}
        finally{button.disabled=false;}
      };
    }catch(error){reviewPanel.textContent='Cash review unavailable: '+error.message;}
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
        'vip5-animated',...numbered('svip-frame',8),'noble-gold-microphone',...roleFrames],
      entry_style:['phoenix','dragon-queen','ice-king','castle-flag','lion-queen','phoenix-queen','tiger-queen'],
      medal_style:['bronze','silver','gold','top-host',...numbered('svip-medal',8)],
      name_tag_style:['legend',...numbered('svip-tag',17)]
    };
    const kinds=Object.keys(art);
    const options=(list,selected)=>list.map(v=>'<option value="'+esc(v)+'"'+
      (v===selected?' selected':'')+'>'+esc(v.replaceAll('_',' '))+'</option>').join('');
    root.innerHTML=card('Verified cosmetic inventory',
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
      '<div id="sh-cosmetic-list">Loading server catalogue…</div>'+
      '<div class="card"><h3>Add new catalog item</h3>'+
      '<div class="row"><select class="field" id="sh-cos-kind">'+options(kinds,'entry_style')+'</select>'+
      '<input class="field" id="sh-cos-slug" maxlength="39" placeholder="New item ID (e.g. royal-arrival)"></div>'+
      '<div class="row"><input class="field" id="sh-cos-name" maxlength="80" placeholder="Display name">'+
      '<input class="field" id="sh-cos-price" type="number" min="1" max="1000000" placeholder="Coin price"></div>'+
      '<div class="row"><label>Existing bundled artwork <select class="field" id="sh-cos-art"></select></label>'+
      '<button class="btn s" type="button" id="sh-cos-create">Add item</button></div>'+
      '<p class="n">New catalogue IDs may reuse a bundled entry/frame asset. Truly new art requires including its animation or image in an app update.</p></div>';
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
        '</select></label><label>Days <input id="sh-premium-grant-days" class="field" '+
        'type="number" min="1" max="365" value="30"></label></div>'+
        '<button class="btn s" id="sh-premium-grant" type="button">Confirm admin assignment</button>':'')+
      '<div id="sh-premium-result" role="status" class="n"></div></div>';
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
      if(!window.confirm('Save premium purchase, grant and automatic qualification rules?'))return;
      button.disabled=true;
      try{await api('PATCH','premium',{policy,tiers});
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
          ' · '+person.source+' · Wealth Lv.'+person.wealth_level+
          ' · Sent gifts '+fmt(person.gift_coins)+' coins':'Member unavailable';
      }catch(error){member.textContent='Member unavailable: '+error.message;}
    }
    byId('sh-premium-lookup').onclick=lookup;
    byId('sh-premium-grant')?.addEventListener('click',async event=>{
      const id=byId('sh-premium-id')?.value.trim()||'';
      const tier=byId('sh-premium-grant-tier')?.value;
      const days=Number(byId('sh-premium-grant-days')?.value);
      if(!/^[0-9]{8}$/.test(id)||!['vip','svip','noble','none'].includes(tier)||
        (tier!=='none'&&(!Number.isInteger(days)||days<1||days>365))){
        result.textContent='Check the ID and duration (1–365 days).';return;
      }
      if(!window.confirm(tier==='none'?'Revoke the assigned membership for '+id+'?':
        'Grant '+tier.toUpperCase()+' to '+id+' for '+days+' days?'))return;
      event.currentTarget.disabled=true;
      try{await api('POST','premium/grant',{public_id:id,tier,duration_days:days});
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
    root.innerHTML=(canEdit?'<div class="card"><h3>Add gift to real catalog</h3>'+
      '<p class="n">Regular gifts are settled through the verified wallet ledger. Lucky payouts are still disabled.</p>'+
      '<div class="row"><input id="gift-name" maxlength="80" placeholder="Gift name" aria-label="Gift name">'+
      '<input id="gift-emoji" maxlength="16" placeholder="🎁" aria-label="Gift emoji">'+
      '<input id="gift-price" type="number" min="1" step="1" placeholder="Coin price" aria-label="Coin price">'+
      '<select id="gift-category" aria-label="Gift category"><option value="0">Gifts</option>'+
      '<option value="1">Luxury</option><option value="2">Lucky</option></select>'+
      '<button type="button" id="gift-create" class="btn s">Add gift</button></div></div>':'')+
      '<div class="card"><h3>Real gift catalog</h3><div id="gift-list">Loading…</div></div>'+
      '<div class="card"><h3>Verified gift transactions</h3><div id="gift-event-list">Loading…</div></div>'+
      '<div class="card"><h3>Gift wallet settlement audit</h3>'+
      '<p class="n">Read-only D1 transaction audit. Recipient diamonds may include fractional accrual; room shares are not credited to the owner wallet.</p>'+
      '<div id="gift-settlement-list">Loading…</div></div>';
    const list=byId('gift-list');
    async function refresh() {
      list.textContent='Loading catalog…';
      try{
        const data=await api('GET','gifts');
        list.innerHTML=window.T(['ID','Gift','Category','Coins','State','Admin action'],
          (data.gifts||[]).map(g=>[
            fmt(g.id),esc(g.emoji)+' '+esc(g.name),
            ['Gifts','Luxury','Lucky'][g.tab]||'Other',fmt(g.price_coins),
            g.active?'Active':'Disabled',
            canEdit?'<button type="button" class="btn s" data-gift-id="'+esc(g.id)+
              '" data-gift-active="'+(g.active?1:0)+'">'+
              (g.active?'Disable':'Activate')+'</button>':'—'
          ]));
      }catch(error){list.textContent=error.message;}
    }
    if(canEdit){
      byId('gift-create').onclick=async ()=>{
        const button=byId('gift-create');
        const name=byId('gift-name').value.trim();
        const price=Number(byId('gift-price').value);
        const emoji=byId('gift-emoji').value.trim()||'🎁';
        const tab=Number(byId('gift-category').value);
        if(!name||!Number.isSafeInteger(price)||price<=0){note('Enter gift name and valid coin price');return;}
        button.disabled=true;
        try{
          await api('POST','gifts',{name,emoji,tab,price_coins:price,active:false});
          byId('gift-name').value='';byId('gift-price').value='';byId('gift-emoji').value='';
          note('Gift added. Activate it when ready.');await refresh();
        }catch(error){note('Gift not created: '+error.message);}
        finally{button.disabled=false;}
      };
      list.onclick=async e=>{
        const button=e.target.closest('button[data-gift-id]');
        if(!button||button.disabled)return;
        const enabled=button.dataset.giftActive!=='1';
        if(!window.confirm((enabled?'Activate':'Disable')+' gift #'+button.dataset.giftId+'?'))return;
        button.disabled=true;
        try{
          await api('PATCH','gifts/'+encodeURIComponent(button.dataset.giftId),{active:enabled});
          note('Gift catalog updated');await refresh();
        }catch(error){note('Gift update failed: '+error.message);button.disabled=false;}
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
        '<h4>'+esc(item.name)+' · '+esc(item.email)+'</h4>'+
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
    let kind='rich',period='weekly',requestNo=0;
    const kinds={rich:'Rich · sent',charm:'Charm · received',room:'Rooms',recharge:'Top Recharge'};
    const periods={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};
    root.innerHTML='<div class="card"><h3>Verified wallet rankings</h3>'+
      '<p>Gift ranks reflect settled transfers; Top Recharge counts only approved seller or finance recharge coins. No simulated players or payouts.</p>'+
      '<div class="row" id="rank-kinds">'+Object.entries(kinds).map(([key,label])=>
        '<button class="btn" type="button" data-rkind="'+esc(key)+'">'+esc(label)+'</button>'
      ).join('')+'</div>'+
      '<div class="row" id="rank-periods">'+Object.entries(periods).map(([key,label])=>
        '<button class="btn" type="button" data-rperiod="'+esc(key)+'">'+esc(label)+'</button>'
      ).join('')+'</div><div id="rank-results">Loading verified rankings…</div></div>';
    const results=byId('rank-results');
    async function reload(){
      const current=++requestNo;
      root.querySelectorAll('[data-rkind]').forEach(b=>b.disabled=b.dataset.rkind===kind);
      root.querySelectorAll('[data-rperiod]').forEach(b=>b.disabled=b.dataset.rperiod===period);
      results.textContent='Loading verified rankings…';
      try{
        const data=await api('GET','rankings?kind='+kind+'&period='+period);
        if(current!==requestNo)return;
        const leaders=Array.isArray(data.leaders)?data.leaders:[];
        if(!leaders.length){
          results.textContent=kind==='recharge'?'No approved recharges recorded for this period.':'No settled gifts recorded for this period.';
          return;
        }
        const labels=kind==='room'?['Rank','Room ID','Room','Gift coins']:
          ['Rank','User ID','Name',kind==='recharge'?'Approved recharge coins':'Gift coins'];
        const rows=leaders.map(item=>kind==='room'
          ?[fmt(item.rank),esc(item.room_id),esc(item.name),fmt(item.total)]
          :[fmt(item.rank),esc(item.public_id),esc(item.name),fmt(item.total)]);
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
  };
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
      '<div class="row"><input id="direct-user" maxlength="8" inputmode="numeric" placeholder="Recipient 8-digit user ID" aria-label="User ID">'+
      '<input id="direct-coins" inputmode="numeric" placeholder="Coins (Super Admin: up to 1 trillion)" aria-label="Coin amount"></div>'+
      '<div class="row"><input id="direct-reason" maxlength="200" placeholder="Reason (8–200 characters)" aria-label="Reason">'+
      '<button id="direct-submit" class="btn s" type="button">Credit user wallet</button></div>'+
      '<p id="direct-note" class="n" aria-live="polite"></p>'+
      '<h4>Verified direct credit history</h4><div id="direct-history">Loading…</div>';
    root.insertBefore(section,root.firstChild);
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
      if(!/^[0-9]{8}$/.test(target)||!/^[0-9]+$/.test(raw)||
         !Number.isSafeInteger(amount)||amount<1||amount>(role==='super'?1000000000000:1000000)||
         reason.length<8||reason.length>200){
        note.textContent='Enter 8-digit ID, positive coins within the wallet cap and an 8–200 character reason.';return;
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
        return '<div class="card" style="margin:10px 0">'+
          '<div style="padding:10px;border-radius:12px;background:linear-gradient(135deg,'+
          esc(row.color_a)+','+esc(row.color_b)+');color:#fff">'+
          '<b>'+esc(row.emoji)+' '+esc(row.title)+'</b><small style="display:block">'+
          esc(row.subtitle)+'</small></div>'+
          '<p class="n">Banner #'+esc(row.id)+' · '+(row.active?'Visible in app':'Hidden')+'</p>'+
          (canEdit?'<div class="row"><input data-bf="title" data-id="'+row.id+'" maxlength="80" value="'+esc(row.title)+'" aria-label="Banner title">'+
          '<input data-bf="subtitle" data-id="'+row.id+'" maxlength="160" value="'+esc(row.subtitle||'')+'" aria-label="Banner subtitle"></div>'+
          '<div class="row"><select data-bf="action" data-id="'+row.id+'">'+choices(row.action)+'</select>'+
          '<input type="number" min="0" max="100" data-bf="sort_order" data-id="'+row.id+'" value="'+Number(row.sort_order)+'" aria-label="Display order">'+
          '<label><input type="checkbox" data-bf="active" data-id="'+row.id+'"'+(row.active?' checked':'')+'> Active</label>'+
          '<button class="btn s" type="button" data-bsave="'+row.id+'">Save</button></div>':'')+
          '</div>';
      }).join('');
      const create=role==='super'?'<div class="card"><h3>➕ Add home banner</h3>'+
        '<p class="n">Banner text, color and action are controlled here. Image uploads need a separate verified media-store integration.</p>'+
        '<div class="row"><input id="new-banner-title" maxlength="80" placeholder="Banner headline">'+
        '<input id="new-banner-subtitle" maxlength="160" placeholder="Subtitle"></div>'+
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
          await api('POST','banners',{
            title:byId('new-banner-title').value.trim(),
            subtitle:byId('new-banner-subtitle').value.trim(),
            emoji:byId('new-banner-emoji').value.trim()||'🎉',
            action:byId('new-banner-action').value,
            color_a:picked[0],color_b:picked[1],
            active:byId('new-banner-active').checked,sort_order:rows.length
          });
          await P.banners();
        }catch(error){if(note)note.textContent='Banner not created: '+error.message;}
        finally{if(add.isConnected)add.disabled=false;}
      };
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
    const root=byId('pg');root.innerHTML=card('Games','Loading settled game records…');
    try{
      const data=await readGameMonitor();
      root.innerHTML='<div class="card"><h3>Verified game activity</h3>'+
        '<p class="n">Real stored bets and settlements only. Gameplay settings cannot be edited here yet.</p>'+
        window.T(['Engine','Game','Bets','Settled','Winning bets'],
          (data.games||[]).map(g=>[
            esc(g.source),esc(g.game),fmt(g.bets),fmt(g.settled),fmt(g.winning_bets)
          ]))+'<button type="button" id="game-winners" class="btn s">Show settled winners</button></div>';
      byId('game-winners').onclick=()=>openVerifiedPage('winb');
    }catch(error){root.innerHTML=card('Game monitoring unavailable',error.message);}
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
  const verifiedPages=new Set([
    'dash','analytics','users','support','rooms','ledger','sellers','daily','events','premium','bonds','rech','money','store','md','gifts','cosmetics','rank','audit','admins','system','banners','opening','levels','promo','themes','rr','games','winb','lucky','config','flags','push'
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
