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
    if (!['super','support','finance'].includes(status.role))
      throw new Error('Admin role not assigned');
    role = status.role;
    identity = status;
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
    const root=byId('pg');root.innerHTML=card('Rooms','Loading verified rooms…');
    try {
      const data=await api('GET','rooms');
      root.innerHTML='<div class="card"><p class="n">Real D1 rooms and saved members. Live presence is not tracked yet.</p>'+
        window.T(['Room ID','Name','Owner ID','Members','Seats','Inspect'],
          (data.rooms||[]).map(r=>[
            esc(r.id),esc(r.name),esc(r.owner_public_id||''),
            fmt(r.members),fmt(r.seat_count),
            '<button type="button" class="btn s" data-room-id="'+esc(r.id)+'">Members</button>'
          ]))+'<div id="room-members-detail"></div></div>';
      root.onclick=async e=>{
        const button=e.target.closest('button[data-room-id]');
        if(!button||button.disabled)return;
        button.disabled=true;
        const detail=byId('room-members-detail');
        detail.textContent='Loading members…';
        try{
          const data=await api('GET','rooms/'+encodeURIComponent(button.dataset.roomId)+'/members');
          detail.innerHTML='<h3>Members of '+esc(data.room.name)+' ('+esc(data.room.id)+')</h3>'+
            '<p class="n">Room membership only; online status is not measured.</p>'+
            window.T(['User ID','Name','Room role','Seat','Muted','Joined'],
              (data.members||[]).map(m=>[
                esc(m.public_id),esc(m.name),esc(m.role),
                m.seat_no==null?'Audience':fmt(m.seat_no),
                m.muted?'Yes':'No',esc(m.joined_at)
              ]));
        }catch(error){detail.textContent=error.message;}
        finally{button.disabled=false;}
      };
    }catch(error){root.innerHTML=card('Rooms unavailable',error.message);}
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
      '<p class="n">Gift transfers remain disabled until wallet settlement is tested.</p>'+
      '<div class="row"><input id="gift-name" maxlength="80" placeholder="Gift name" aria-label="Gift name">'+
      '<input id="gift-emoji" maxlength="16" placeholder="🎁" aria-label="Gift emoji">'+
      '<input id="gift-price" type="number" min="1" step="1" placeholder="Coin price" aria-label="Coin price">'+
      '<select id="gift-category" aria-label="Gift category"><option value="0">Gifts</option>'+
      '<option value="1">Luxury</option><option value="2">Lucky</option></select>'+
      '<button type="button" id="gift-create" class="btn s">Add gift</button></div></div>':'')+
      '<div class="card"><h3>Real gift catalog</h3><div id="gift-list">Loading…</div></div>';
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
    try {
      const data=await api('GET','roles');
      root.innerHTML='<div class="card"><p class="n">Roles are assigned by the trusted Cloudflare operator. Self-promotion is disabled.</p>'+
        window.T(['User ID','Name','Role','Assigned'],(data.admins||[]).map(a=>[
          esc(a.public_id),esc(a.name),esc(a.role),esc(a.assigned_at)]))+'</div>';
    }catch(error){root.innerHTML=card('Admin roles unavailable',error.message);}
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
  P.system=async function () {
    const root=byId('pg');
    root.innerHTML=card('Sharika staging','Firebase login and D1 role enforcement active. Financial writes remain locked.');
  };

  // The original visual-only dashboard includes demo pages. Replace every
  // unconnected page with an honest staging status while retaining its card
  // layout and menu. No fake sellers, payouts, or active games are displayed.
  const verifiedPages=new Set([
    'dash','analytics','users','support','rooms','ledger','gifts','audit','admins','system'
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
