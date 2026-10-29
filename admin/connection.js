/* Sharika admin backend adapter. Original admin HTML/CSS are unchanged.
 * The demo password, fake records and local-only financial actions are not trusted.
 */
(function () {
  'use strict';
  const BASE = 'https://rfrmcmeyamndghtiheci.supabase.co';
  const PUBLISHABLE = 'sb_publishable_hMmbkkboIJhuhRCd6FORuQ_j8y8Kkrh';
  const SESSION_KEY = 'sharika_admin_auth_v1';
  let session = null;
  let activeRole = null;
  let users = [];
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}

  function esc(text) { return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function fmt(number) { return Number(number || 0).toLocaleString('en-US'); }
  function authSave(s) {
    session = s ? { access_token:s.access_token,refresh_token:s.refresh_token,
      expires_at: Math.floor(Date.now()/1000)+(s.expires_in || 3600) } : null;
    if (session) sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  }
  async function query(url, method, body, token) {
    const res = await fetch(url,{ method,
      headers: { apikey:PUBLISHABLE, 'content-type':'application/json',
        ...(token ? { authorization:'Bearer '+token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.message || data.msg || data.error || 'Server unavailable');
    return data;
  }
  async function token() {
    if (!session) throw new Error('Please sign in');
    if (session.expires_at > Date.now()/1000 + 60) return session.access_token;
    if (!session.refresh_token) throw new Error('Admin session expired');
    const refreshed = await query(BASE+'/auth/v1/token?grant_type=refresh_token','POST',{
      refresh_token:session.refresh_token,
    });
    authSave(refreshed);
    return session.access_token;
  }
  async function api(method,path,body) {
    return query(BASE+'/functions/v1/sharika-api'+path,method,body,await token());
  }

  const originalLogin = window.login;
  window.login = function () {
    originalLogin();
    const email = document.getElementById('em');
    const password = document.getElementById('pw');
    const code = document.getElementById('tf');
    if (email) email.value = '';
    if (password) password.value = '';
    if (code) { code.value = ''; code.disabled = true; code.placeholder = '2FA will require provider setup'; }
    const note = document.querySelector('#lf p:last-child');
    if (note) note.textContent = 'Only an approved Sharika administrator can sign in. Never use demo credentials.';
    const button = document.getElementById('go');
    if (button) button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await query(BASE+'/auth/v1/token?grant_type=password','POST',{
          email:email.value.trim(),password:password.value,
        });
        authSave(result);
        const status = await api('GET','/admin/status');
        activeRole = status.role;
        window.ME = result.user?.email || email.value.trim();
        window.V = 'dash';
        await loadSettings();
        window.shell();
      } catch (error) {
        authSave(null);
        document.getElementById('le').textContent = error.message;
      } finally { button.disabled = false; }
    };
  };

  async function loadSettings() {
    const settings = await api('GET','/admin/config');
    const kv = settings.kv || {};
    if (kv.lucky && typeof kv.lucky === 'object') Object.assign(window.D.lucky, kv.lucky);
    if (kv.rr && typeof kv.rr === 'object') Object.assign(window.D.rr, kv.rr);
  }

  const P = window.P;
  const fallback = title => () => {
    document.getElementById('pg').innerHTML = '<div class="card"><h3>'+esc(title)+'</h3><p class="n">The original layout is preserved. This module needs its verified server connection before it can be used.</p></div>';
  };
  for (const name of Object.keys(P)) P[name] = fallback(name);

  P.dash = async function () {
    document.getElementById('pg').innerHTML = '<div class="card">Loading verified dashboard…</div>';
    try {
      const [usr,rooms,requests] = await Promise.all([
        api('GET','/admin/users'),api('GET','/admin/rooms'),
        activeRole === 'finance' || activeRole === 'super' ? api('GET','/admin/recharge-requests') : Promise.resolve({requests:[]}),
      ]);
      users = usr.users || [];
      const activeRooms = (rooms.rooms || []).filter(r => r.is_live).length;
      const coinTotal = users.reduce((sum,u) => sum+Number(u.coins || 0),0);
      const items = [ ['Registered users',users.length],['Live rooms',activeRooms],
        ['Recharge requests',(requests.requests || []).length],['Coins (loaded users)',fmt(coinTotal)] ];
      document.getElementById('pg').innerHTML = '<div class="kp">'+items.map(([key,value]) =>
        '<div class="k"><small>'+esc(key)+'</small><b>'+esc(value)+'</b></div>'
      ).join('')+'</div><div class="card"><p class="n">Only server-verified records are shown. User results are limited to the first 300.</p></div>';
    } catch (error) { document.getElementById('pg').textContent = error.message; }
  };

  P.users = async function () {
    const root = document.getElementById('pg');
    root.innerHTML = '<div class="card"><div class="row"><input id="q" placeholder="Search by ID or name" aria-label="Search users"></div><div id="ul">Loading…</div></div>';
    try {
      users = (await api('GET','/admin/users')).users || [];
      function render() {
        const q = document.getElementById('q').value.toLowerCase();
        const filtered = users.filter(u => !q || String(u.public_id).includes(q) || u.name.toLowerCase().includes(q));
        document.getElementById('ul').innerHTML = window.T(['ID','Name','Country','Level','Coins','Diamonds','Status',''],filtered.map(u => [
          esc(u.public_id),esc(u.name),esc(u.country),fmt(u.wealth_level),fmt(u.coins),fmt(u.diamonds),
          esc(u.status),'<button class="btn s" data-user="'+esc(u.public_id)+'">Manage</button>',
        ]));
        document.querySelectorAll('[data-user]').forEach(button => {
          button.onclick = () => manageUser(button.dataset.user);
        });
      }
      document.getElementById('q').oninput = render;
      render();
    } catch (error) { document.getElementById('ul').textContent = error.message; }
  };

  function manageUser(publicId) {
    const user = users.find(u => u.public_id === publicId);
    if (!user) return;
    const dialog = window.modal('<h3>'+esc(user.name)+' · '+esc(publicId)+'</h3>'+
      '<label>Adjust coins (+ or -, max 100,000 per request)</label><input id="am" type="number">'+
      '<label>Reason (required)</label><input id="rs" placeholder="Reason">'+
      '<div class="row"><button class="btn k" id="ap">Apply</button><button class="btn r" id="bn">'+
      (user.status === 'active' ? 'Block user' : 'Unblock user')+'</button><button class="btn o" id="cl">Close</button></div>');
    dialog.querySelector('#cl').onclick = () => dialog.remove();
    dialog.querySelector('#ap').onclick = async () => {
      try {
        const delta = Number(dialog.querySelector('#am').value);
        const reason = dialog.querySelector('#rs').value.trim();
        if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000 || reason.length < 4) {
          throw new Error('Enter an amount within 100,000 and a clear reason');
        }
        await api('POST','/admin/users/'+publicId+'/wallet',{ delta,reason,request_id:crypto.randomUUID() });
        dialog.remove();window.toast('Server wallet updated');P.users();
      } catch (error) { window.toast(error.message); }
    };
    dialog.querySelector('#bn').onclick = async () => {
      try {
        const reason = dialog.querySelector('#rs').value.trim();
        await api('PATCH','/admin/users/'+publicId+'/status',{
          status:user.status==='active'?'blocked':'active',reason,
        });
        dialog.remove();window.toast('User status saved');P.users();
      } catch (error) { window.toast(error.message); }
    };
  }

  P.rech = async function () {
    const root = document.getElementById('pg');
    root.innerHTML = '<div class="card">Loading actual recharge requests…</div>';
    try {
      const [pending,allUsers] = await Promise.all([
        api('GET','/admin/recharge-requests'), api('GET','/admin/users'),
      ]);
      const lookups = new Map((allUsers.users || []).map(u => [u.user_id,u]));
      root.innerHTML = '<div class="card"><p class="n">Coins are credited only after admin approval on the server.</p>'+
        window.T(['Request','User','Coins','Status',''],(pending.requests || []).map(r => [
          '#'+r.id,esc(lookups.get(r.user_id)?.public_id || r.user_id),fmt(r.coins),
          'pending','<button class="btn k s" data-approve="'+r.id+'">Approve</button> '+
          '<button class="btn r s" data-reject="'+r.id+'">Reject</button>',
        ]))+'</div>';
      root.querySelectorAll('[data-approve],[data-reject]').forEach(button => {
        button.onclick = async () => {
          const approve = button.hasAttribute('data-approve');
          const id = approve ? button.dataset.approve : button.dataset.reject;
          if (!window.confirm((approve ? 'Approve and credit' : 'Reject') + ' recharge #'+id+'?')) return;
          button.disabled = true;
          try {
            await api('POST','/admin/recharge-requests/'+id+'/review',{approve});
            window.toast('Recharge decision saved');P.rech();
          } catch (error) { window.toast(error.message);button.disabled = false; }
        };
      });
    } catch (error) { root.textContent = error.message; }
  };

  P.rooms = async function () {
    const root = document.getElementById('pg');
    root.innerHTML = '<div class="card">Loading rooms…</div>';
    try {
      const data = await api('GET','/admin/rooms');
      root.innerHTML = '<div class="card">'+window.T(['Room ID','Name','Owner','Live'],(data.rooms || []).map(r => [
        esc(r.id),esc(r.name),esc(r.owner_id),r.is_live ? 'Live':'Offline',
      ]))+'</div>';
    } catch (error) { root.textContent = error.message; }
  };

  P.audit = async function () {
    const root = document.getElementById('pg');
    root.innerHTML = '<div class="card">Loading audit history…</div>';
    try {
      const data = await api('GET','/admin/audit');
      root.innerHTML = '<div class="card">'+window.T(['Time','Admin','Action','Details'],(data.audit || []).map(a => [
        esc(a.created_at),esc(a.actor_id),esc(a.action),esc(JSON.stringify(a.details)),
      ]))+'</div>';
    } catch (error) { root.textContent = error.message; }
  };

  const originalShell = window.shell;
  window.shell = function () {
    originalShell();
    const who = document.querySelector('.top .who');
    if (who) who.innerHTML = 'Signed in as<br><b>'+esc(window.ME)+'</b> · '+esc(activeRole || 'Admin');
    const logout = document.getElementById('lo');
    if (logout) logout.onclick = () => { authSave(null);activeRole=null;window.login(); };
  };

  // Fresh session restoration requires role verification; the old localStorage
  // demo login flag cannot grant access to this connected admin panel.
  async function restore() {
    if (!session) { window.login(); return; }
    try {
      const status = await api('GET','/admin/status');
      activeRole = status.role;
      const user = await query(BASE+'/auth/v1/user','GET',undefined,await token());
      window.ME = user.email || 'Admin';
      window.V = 'dash';
      await loadSettings();
      window.shell();
    } catch (_) { authSave(null);window.login(); }
  }
  restore();
})();
