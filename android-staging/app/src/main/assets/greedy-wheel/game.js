/* =========================================================
   Greedy Wheel — coin betting wheel game
   Two modes:
     • ONLINE  (?server=https://game.your-app.com&token=JWT)  → rounds, results and coins come from the game server
     • DEMO    (no server)                                    → everything runs on the phone with fake players
   Embed in any app via WebView / iframe. See README.md.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- CONFIG ---------------- */
  const CONFIG = {
    bettingSeconds: 30,
    spinSeconds: 6,
    resultSeconds: 5,
    chips: [10, 100, 1000, 5000, 10000],
    maxBetPerRound: 1000000,
    startBalance: 50000,          // demo mode only
    simulateOtherPlayers: true,   // demo mode only
    // Order matters: first 4 = right side (meat ×10 ×15 ×25 ×45, top→bottom), last 4 = left side (veg ×5).
    // weight = relative chance (out of 1000 together with specials). Demo mode only — online the server decides.
    items: [
      { id: 'shrimp',  img: 'img/shrimp.webp',  mult: 10, type: 'meat', weight: 96.94,  name: { bn: 'চিংড়ি',   en: 'Shrimp'  } },
      { id: 'fish',    img: 'img/fish.webp',    mult: 15, type: 'meat', weight: 63.96,  name: { bn: 'মাছ',     en: 'Fish'    } },
      { id: 'chicken', img: 'img/chicken.webp', mult: 25, type: 'meat', weight: 37.58,  name: { bn: 'চিকেন',   en: 'Chicken' } },
      { id: 'steak',   img: 'img/steak.webp',   mult: 45, type: 'meat', weight: 19.99,  name: { bn: 'স্টেক',   en: 'Steak'   } },
      { id: 'cabbage', img: 'img/cabbage.webp', mult: 5,  type: 'veg',  weight: 193.88, name: { bn: 'বাঁধাকপি', en: 'Cabbage' } },
      { id: 'carrot',  img: 'img/carrot.webp',  mult: 5,  type: 'veg',  weight: 193.88, name: { bn: 'গাজর',    en: 'Carrot'  } },
      { id: 'corn',    img: 'img/corn.webp',    mult: 5,  type: 'veg',  weight: 193.88, name: { bn: 'ভুট্টা',   en: 'Corn'    } },
      { id: 'tomato',  img: 'img/tomato.webp',  mult: 5,  type: 'veg',  weight: 193.88, name: { bn: 'টমেটো',   en: 'Tomato'  } },
    ],
    // Special results (cannot be bet on directly). wins = indexes of items that ALL win together.
    specials: [
      { id: 'salad', img: 'img/salad.webp', type: 'veg',  wins: [4, 5, 6, 7], weight: 4, name: { bn: 'সালাদ', en: 'Salad' }, desc: { bn: 'সব সবজি জিতবে', en: 'All veg win' } },
      { id: 'pizza', img: 'img/pizza.webp', type: 'meat', wins: [0, 1, 2, 3], weight: 2, name: { bn: 'পিৎজা', en: 'Pizza' }, desc: { bn: 'সব মাংস জিতবে', en: 'All meat win' } },
    ],
    resultProvider: null,   // demo-mode hook (optional)
    betValidator: null,     // demo-mode hook (optional)
  };

  const T = {
    bn: {
      lastWin: 'শেষ জয়', round: 'রাউন্ড', placeBet: 'বেট করো', spinning: 'ঘুরছে', result: 'ফলাফল', waiting: 'অপেক্ষা',
      today: 'আজকের আয়', repeat: 'আবার', auto: 'অটো', online: 'জন খেলছে', veg: 'সবজি ×5', meat: 'মাংস ×10–×45',
      resSuffix: 'ফলাফল', earn: 'এই রাউন্ডে জয়', bets: 'এই রাউন্ডে বেট',
      rank: 'এই রাউন্ডের সেরা', noCoins: 'পর্যাপ্ত কয়েন নেই', betClosed: 'বেট বন্ধ, পরের রাউন্ডের অপেক্ষা করো',
      maxBet: 'এই রাউন্ডের সর্বোচ্চ বেট হয়ে গেছে', noLast: 'আগের রাউন্ডে কোনো বেট নেই', you: 'তুমি',
      helpTitle: 'কীভাবে খেলবে', tabResults: 'ফলাফল হিস্ট্রি', tabRecords: 'আমার রেকর্ড',
      last20: 'শেষ ২০ রাউন্ডে কতবার এসেছে', noRecords: 'এখনো কোনো বেট করোনি',
      thRound: 'রাউন্ড', thResult: 'ফলাফল', thBet: 'বেট', thWin: 'জয়',
      connecting: 'সার্ভারে যুক্ত হচ্ছে…', offline: 'সংযোগ বিচ্ছিন্ন, আবার চেষ্টা হচ্ছে…', walletErr: 'কয়েন কাটা যায়নি, আবার চেষ্টা করো',
      authErr: 'লগইন যাচাই হয়নি, অ্যাপ থেকে আবার খোলো', bigWin: 'বড় জয়!',
      help: [
        'নিচ থেকে একটি কয়েন চিপ বাছাই করো।',
        'যে খাবারে বেট করতে চাও, সেটায় ট্যাপ করো। একসাথে একাধিক খাবারে বেট করা যায়।',
        'বাম পাশের সবজিগুলোতে ×5, ডান পাশের মাংসে ×10, ×15, ×25, ×45।',
        'সময় শেষ হলে আলো ঘুরে একটি খাবারে থামবে। সেখানে বেট থাকলে বেট × গুণ কয়েন পাবে।',
        'সালাদ এলে বাম পাশের ৪টি সবজির সব বেট একসাথে জিতবে।',
        'পিৎজা এলে ডান পাশের ৪টি মাংসের (×10, ×15, ×25, ×45) সব বেট একসাথে জিতবে।',
        '“আবার” চাপলে আগের বেট আবার বসবে, “অটো” চালু থাকলে প্রতি রাউন্ডে নিজে থেকে বসবে।',
        'উপরের ঘড়ি বাটনে আগের ফলাফল ও তোমার রেকর্ড দেখা যাবে।'
      ]
    },
    en: {
      lastWin: 'Last win', round: 'Round', placeBet: 'Place bets', spinning: 'Spinning', result: 'Result', waiting: 'Waiting',
      today: "Today's revenue", repeat: 'Repeat', auto: 'Auto', online: 'playing', veg: 'Veg ×5', meat: 'Meat ×10–×45',
      resSuffix: 'result', earn: 'Won this round', bets: 'Bet this round',
      rank: 'Top winners', noCoins: 'Not enough coins', betClosed: 'Betting closed — wait for next round',
      maxBet: 'Max bet for this round reached', noLast: 'No bets in last round', you: 'You',
      helpTitle: 'How to play', tabResults: 'Result history', tabRecords: 'My records',
      last20: 'Hits in last 20 rounds', noRecords: 'No bets yet',
      thRound: 'Round', thResult: 'Result', thBet: 'Bet', thWin: 'Win',
      connecting: 'Connecting to server…', offline: 'Connection lost, retrying…', walletErr: 'Could not take coins, try again',
      authErr: 'Login check failed, reopen from the app', bigWin: 'BIG WIN!',
      help: [
        'Pick a coin chip at the bottom.',
        'Tap any food to bet on it. You can bet on several at once.',
        'Vegetables on the left pay ×5; meats on the right pay ×10, ×15, ×25, ×45.',
        'When time is up the light spins and stops on one item. If you bet on it you win bet × multiplier.',
        'SALAD: every vegetable bet wins at once.',
        'PIZZA: every meat bet (×10, ×15, ×25, ×45) wins at once.',
        '"Repeat" places last bets again; "Auto" repeats them every round.',
        'Tap the clock button to see past results and your records.'
      ]
    }
  };

  /* ---------------- STATE ---------------- */
  const qs = new URLSearchParams(location.search);
  const N = CONFIG.items.length;
  let OUT = [];  // outcomes: 0..7 = single items, 8 = salad, 9 = pizza
  function buildOutcomes() {
    OUT = CONFIG.items.map((it, i) => ({ ...it, wins: [i], special: false })).concat(CONFIG.specials.map((s) => ({ ...s, special: true })));
  }
  buildOutcomes();
  const outIdx = (id) => OUT.findIndex((o) => o.id === id);
  const payoutOf = (o, bets) => OUT[o].wins.reduce((a, w) => a + bets[w] * CONFIG.items[w].mult, 0);

  const S = {
    lang: T[qs.get('lang')] ? qs.get('lang') : 'bn',
    user: { id: qs.get('uid') || 'guest', name: qs.get('name') || 'Player', avatar: qs.get('avatar') || '' },
    balance: qs.has('balance') ? Math.max(0, parseInt(qs.get('balance'), 10) || 0) : CONFIG.startBalance,
    round: parseInt(qs.get('round'), 10) || 580,
    phase: 'betting', endsAt: 0, timeLeft: CONFIG.bettingSeconds,
    chipIdx: 1,
    myBets: new Array(N).fill(0), allBets: new Array(N).fill(0), lastBets: null,
    auto: false, todayRev: 0, lastWin: 0,
    history: [], records: [],
    lit: -1, sound: qs.get('sound') !== '0',
    bots: [], online: 0,
    mode: 'demo', ws: null, clockOffset: 0, reqSeq: 0, pending: new Map(), lastResult: null,
  };
  if (qs.get('sheet') === '1') document.body.classList.add('sheet-mode');
  const t = (k) => T[S.lang][k];

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const wheel = $('wheel');
  const slots = [];
  const specialEls = [];

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  function short(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  const imgTag = (o, cls = '') => `<img src="${o.img}" alt="${o.name[S.lang]}" class="${cls}" draggable="false">`;
  const angleOf = (i) => (-67.5 + i * 45) * Math.PI / 180;

  function buildWheel() {
    const spokes = $('spokeLines');
    const R = 37.5;
    CONFIG.items.forEach((it, i) => {
      const a = angleOf(i);
      const x = 50 + Math.cos(a) * R, y = 50 + Math.sin(a) * R;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 50); line.setAttribute('y1', 50);
      line.setAttribute('x2', 50 + Math.cos(a) * (R - 10)); line.setAttribute('y2', 50 + Math.sin(a) * (R - 10));
      spokes.appendChild(line);
      const b = document.createElement('button');
      b.className = 'slot ' + it.type;
      b.style.left = x + '%'; b.style.top = y + '%';
      b.setAttribute('aria-label', it.name.en + ' x' + it.mult);
      b.innerHTML = `<div class="medal"><div class="medal-in">${imgTag(it)}</div></div>
        <span class="total">0</span><span class="mult">×${it.mult}</span><span class="mine">0</span>`;
      b.addEventListener('click', () => placeBet(i, b));
      wheel.appendChild(b);
      slots.push(b);
    });
    // specials: salad (top), pizza (bottom) in the gaps between the two halves
    CONFIG.specials.forEach((sp, k) => {
      const d = document.createElement('div');
      d.className = 'special ' + sp.type;
      d.style.left = '50%'; d.style.top = (k === 0 ? 30 : 70) + '%';
      d.innerHTML = `<div class="sp-medal">${imgTag(sp)}</div><span class="sp-name">${sp.name[S.lang]}</span>`;
      d.addEventListener('click', () => toast(sp.name[S.lang] + ' — ' + sp.desc[S.lang]));
      wheel.appendChild(d);
      specialEls.push(d);
    });
    const bulbs = $('bulbs');
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const i = document.createElement('i');
      i.style.left = (50 + Math.cos(a) * 49.2) + '%';
      i.style.top = (50 + Math.sin(a) * 49.2) + '%';
      bulbs.appendChild(i);
    }
  }

  let bulbPhase = 0, bulbTimer = null;
  function runBulbs(speed) {
    clearInterval(bulbTimer);
    const list = $('bulbs').children;
    bulbTimer = setInterval(() => {
      bulbPhase++;
      for (let k = 0; k < list.length; k++) list[k].classList.toggle('off', (k + bulbPhase) % 3 === 0);
    }, speed);
  }
  function fitWheel() {
    const st = $('stage');
    const w = Math.min(st.clientWidth - 8, st.clientHeight - 6, 460);
    document.documentElement.style.setProperty('--W', Math.max(220, w) + 'px');
  }

  function buildChips() {
    const colors = [['#2f9a3a', '#7fe06f'], ['#1f63d1', '#7fb8ff'], ['#c4262a', '#ff8a7a'], ['#7f2ac4', '#d49aff'], ['#cf7f00', '#ffd36a']];
    const box = $('chips'); box.innerHTML = '';
    CONFIG.chips.forEach((v, i) => {
      const c = document.createElement('button');
      c.className = 'chip';
      const [c1, c2] = colors[i % colors.length];
      c.style.setProperty('--c', c1); c.style.setProperty('--c2', c2);
      c.innerHTML = `<span>${short(v)}</span>`;
      c.addEventListener('click', () => { S.chipIdx = i; sfx('chip'); renderChips(); });
      box.appendChild(c);
    });
    renderChips();
  }
  function renderChips() {
    [...$('chips').children].forEach((c, i) => {
      c.classList.toggle('active', i === S.chipIdx);
      c.classList.toggle('disabled', CONFIG.chips[i] > S.balance);
    });
  }

  function applyLang() {
    document.documentElement.lang = S.lang;
    $('lblWin').textContent = t('lastWin');
    $('lblRoundTop').firstChild.textContent = t('round') + ' ';
    $('lblResult').textContent = t('result');
    $('lblToday').textContent = t('today');
    $('lblOnline').textContent = t('online');
    $('tagLeft').textContent = t('veg');
    $('tagRight').textContent = t('meat');
    $('btnRepeat').textContent = t('repeat');
    $('btnAuto').textContent = t('auto');
    $('lblRoundRes').textContent = t('round');
    $('lblResSuffix').textContent = t('resSuffix');
    $('lblEarn').textContent = t('earn');
    $('lblBets').textContent = t('bets');
    $('lblRank').textContent = t('rank');
    $('tabResults').textContent = t('tabResults');
    $('tabRecords').textContent = t('tabRecords');
    $('helpTitle').textContent = t('helpTitle');
    $('helpList').innerHTML = t('help').map((h) => `<li>${h}</li>`).join('');
    $('oddsTable').innerHTML = CONFIG.items.map((it) => `<div>${imgTag(it)} ${it.name[S.lang]} <b>×${it.mult}</b></div>`).join('') +
      CONFIG.specials.map((sp) => `<div class="wide">${imgTag(sp)} ${sp.name[S.lang]} <b>${sp.desc[S.lang]}</b></div>`).join('');
    specialEls.forEach((d, k) => (d.querySelector('.sp-name').textContent = CONFIG.specials[k].name[S.lang]));
  }

  function avatarData(name) {
    const ch = (name || '?').trim().charAt(0).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f5a623"/><text x="20" y="27" font-size="20" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${ch}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function renderUser() {
    $('userName').textContent = S.user.name;
    $('userAvatar').src = S.user.avatar || avatarData(S.user.name);
  }
  function renderBalance() {
    $('balance').textContent = fmt(S.balance);
    $('todayRev').textContent = (S.todayRev > 0 ? '+' : '') + fmt(S.todayRev);
    $('todayRev').parentElement.classList.toggle('neg', S.todayRev < 0);
    $('lastWin').textContent = fmt(S.lastWin);
    renderChips();
  }
  function renderBets() {
    slots.forEach((b, i) => {
      b.querySelector('.mine').textContent = short(S.myBets[i]);
      b.querySelector('.total').textContent = short(S.allBets[i]);
      b.classList.toggle('has-bet', S.myBets[i] > 0);
    });
    $('btnRepeat').disabled = S.phase !== 'betting' || !S.lastBets;
  }
  function renderHub() {
    const hub = $('hub');
    if (S.phase === 'betting') {
      $('hubLabel').textContent = t('placeBet');
      $('hubTime').textContent = Math.max(0, S.timeLeft);
      hub.classList.toggle('urgent', S.timeLeft <= 5);
    } else if (S.phase === 'connecting') {
      hub.classList.remove('urgent');
      $('hubLabel').textContent = t('waiting'); $('hubTime').textContent = '…';
    } else {
      hub.classList.remove('urgent');
      $('hubLabel').textContent = S.phase === 'spinning' ? t('spinning') : t('result');
      if (S.phase === 'spinning' || !S.history[0]) $('hubTime').textContent = '•••';
      else $('hubTime').innerHTML = imgTag(OUT[S.history[0].idx]);
    }
    $('roundNo').textContent = S.round;
  }
  function renderHistory(fresh) {
    $('history').innerHTML = S.history.slice(0, 10).map((h, k) => {
      const o = OUT[h.idx];
      return `<span class="${o.type} ${o.special ? 'sp' : ''} ${k === 0 && fresh ? 'new' : ''}" title="${t('round')} ${h.round}">${imgTag(o)}</span>`;
    }).join('');
  }
  function setLit(list) {
    const set = new Set(Array.isArray(list) ? list : [list]);
    slots.forEach((b, k) => b.classList.toggle('lit', set.has(k)));
  }

  let toastTimer;
  function toast(msg, ms = 1600) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms);
  }

  /* ---------------- HISTORY PANEL ---------------- */
  function openHistory(tab) {
    if (S.mode === 'online') wsSend({ t: 'records' });
    renderHistoryPanel();
    switchTab(tab || 'results');
    $('historyModal').hidden = false;
  }
  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('histResults').hidden = tab !== 'results';
    $('histRecords').hidden = tab !== 'records';
  }
  function renderHistoryPanel() {
    const last = S.history.slice(0, 20);
    const counts = OUT.map((_, i) => last.filter((h) => h.idx === i).length);
    $('histResults').innerHTML =
      `<div class="res-grid">${last.map((h) => {
        const o = OUT[h.idx];
        return `<div class="res-cell"><div class="ball ${o.type} ${o.special ? 'sp' : ''}">${imgTag(o)}</div>#${h.round}</div>`;
      }).join('')}</div>
      <div class="stats-row" style="margin-top:14px"><b style="width:100%">${t('last20')}</b>${OUT.map((o, i) => `<span>${imgTag(o)}${o.special ? o.name[S.lang] : '×' + o.mult}: ${counts[i]}</span>`).join('')}</div>`;
    if (!S.records.length) { $('histRecords').innerHTML = `<div class="empty-note">${t('noRecords')}</div>`; return; }
    $('histRecords').innerHTML = `<table class="rec-table"><thead><tr><th>${t('thRound')}</th><th>${t('thResult')}</th><th>${t('thBet')}</th><th>${t('thWin')}</th></tr></thead><tbody>${
      S.records.slice(0, 50).map((r) => {
        const o = OUT[r.idx];
        if (!o) return '';
        return `<tr><td>#${r.round}</td><td>${imgTag(o)} ${o.special ? o.name[S.lang] : '×' + o.mult}</td><td>${fmt(r.bet)}</td><td class="${r.win > 0 ? 'pos' : 'neg'}">${r.win > 0 ? '+' + fmt(r.win) : '0'}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  /* ---------------- BETTING (both modes) ---------------- */
  const sumMy = () => S.myBets.reduce((a, b) => a + b, 0);

  async function placeBet(i, el, amountOverride, silent) {
    if (S.phase !== 'betting') { if (!silent) toast(t('betClosed')); return false; }
    const amount = amountOverride || CONFIG.chips[S.chipIdx];
    const pendingSum = [...S.pending.values()].reduce((a, p) => a + p.amount, 0);
    if (amount > S.balance - pendingSum) { if (!silent) { toast(t('noCoins')); emit('insufficient_balance', { need: amount, balance: S.balance }); } return false; }
    if (sumMy() + pendingSum + amount > CONFIG.maxBetPerRound) { if (!silent) toast(t('maxBet')); return false; }
    const it = CONFIG.items[i];
    if (!silent) { sfx('bet'); flyChip(el); }

    if (S.mode === 'online') {
      const reqId = ++S.reqSeq;
      S.pending.set(reqId, { i, amount });
      wsSend({ t: 'bet', reqId, round: S.round, itemId: it.id, amount });
      return true;
    }
    if (CONFIG.betValidator) {
      try { const ok = await CONFIG.betValidator({ round: S.round, itemId: it.id, amount, userId: S.user.id }); if (!ok) return false; }
      catch (e) { return false; }
      if (S.phase !== 'betting') return false;
    }
    S.balance -= amount;
    S.myBets[i] += amount;
    S.allBets[i] += amount;
    bump(el);
    renderBets(); renderBalance();
    emit('bet', { round: S.round, itemId: it.id, itemIndex: i, amount, totalOnItem: S.myBets[i], balance: S.balance });
    return true;
  }
  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  function flyChip(target) {
    const chipEl = $('chips').children[S.chipIdx];
    if (!chipEl || !target) return;
    const app = $('app').getBoundingClientRect();
    const a = chipEl.getBoundingClientRect(), b = target.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'chip-fly';
    d.style.background = getComputedStyle(chipEl).getPropertyValue('--c');
    d.style.boxShadow = '0 0 0 3px #fff inset, 0 2px 6px rgba(0,0,0,.4)';
    d.style.left = (a.left - app.left + a.width / 2 - 12) + 'px';
    d.style.top = (a.top - app.top + a.height / 2 - 12) + 'px';
    $('app').appendChild(d);
    requestAnimationFrame(() => {
      d.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(.6)`;
      d.style.opacity = '0.2';
    });
    setTimeout(() => d.remove(), 380);
  }

  function repeatBets(silent) {
    if (!S.lastBets) { if (!silent) toast(t('noLast')); return; }
    const need = S.lastBets.reduce((a, b) => a + b, 0);
    if (need > S.balance) { toast(t('noCoins')); if (silent) { S.auto = false; renderAuto(); } return; }
    // split each amount into chip values so the server accepts them
    S.lastBets.forEach((amt, i) => {
      let left = amt;
      for (const c of CONFIG.chips.slice().sort((a, b) => b - a)) while (left >= c) { placeBet(i, slots[i], c, true); left -= c; }
    });
    sfx('bet');
  }
  function renderAuto() { $('btnAuto').classList.toggle('on', S.auto); }

  /* ---------------- SPIN + RESULT VISUALS (shared) ---------------- */
  let spinTimer = null;
  function animateSpin(outcome, durationMs, done) {
    clearTimeout(spinTimer);
    const o = OUT[outcome];
    const land = o.special ? o.wins[Math.floor(Math.random() * o.wins.length)] : outcome;
    const start = S.lit < 0 ? 0 : S.lit;
    const dist = ((land - start) % N + N) % N;
    const steps = 3 * N + dist;
    // total time of the eased steps ≈ durationMs
    const delays = []; let sum = 0;
    for (let k = 1; k <= steps; k++) { const d = 45 + Math.pow(k / steps, 3) * 400; delays.push(d); sum += d; }
    const scale = Math.min(1.6, Math.max(0.4, (durationMs - 600) / sum));
    let k = 0; S.lit = start;
    const step = () => {
      k++;
      S.lit = (S.lit + 1) % N;
      setLit(S.lit);
      sfx('tick');
      if (k >= steps) {
        if (o.special) { // flash the whole group + the special badge
          spinTimer = setTimeout(() => { setLit(o.wins); specialEls[outcome - N].classList.add('win'); sfx('special'); }, 250);
          spinTimer = setTimeout(done, 900);
        } else spinTimer = setTimeout(done, 400);
        return;
      }
      spinTimer = setTimeout(step, delays[k] * scale);
    };
    runBulbs(90);
    step();
  }

  function showRoundEnd(outcome, winAmt, myTotal, top) {
    const o = OUT[outcome];
    setLit(-1);
    slots.forEach((b, k) => { const w = o.wins.includes(k); b.classList.toggle('win', w); b.classList.toggle('dim', !w); });
    specialEls.forEach((d, k) => d.classList.toggle('win', outcome === N + k));
    runBulbs(160);
    renderHub(); renderHistory(true); renderBalance();
    if (winAmt > 0) { sfx('win'); floatWin((winAmt >= myTotal * 10 && myTotal > 0 ? t('bigWin') + ' ' : '') + '+' + fmt(winAmt)); coinRain(o.special ? 40 : 22); }
    else sfx('end');
    setTimeout(() => showResultCard(o, winAmt, myTotal, top), 1200);
  }

  function showResultCard(o, win, bet, top) {
    $('resIcon').src = o.img;
    $('resRound').textContent = S.round;
    $('resName').textContent = o.special ? `${o.name[S.lang]} — ${o.desc[S.lang]}` : `${o.name[S.lang]} ×${o.mult}`;
    $('resEarn').textContent = fmt(win);
    $('resBet').textContent = fmt(bet);
    $('resEarn').closest('div').parentElement.classList.toggle('win', win > 0);
    const order = [top[1], top[0], top[2]];
    const cls = ['r2', 'r1', 'r3'], pos = [2, 1, 3];
    $('ranks').innerHTML = order.map((r, k) => {
      if (!r) return `<div class="rank ${cls[k]} empty"><div class="ph" style="background:#b9a7d6">–<span class="pos">${pos[k]}</span></div><div class="nm">—</div><div class="amt">0</div></div>`;
      const ph = r.avatar ? `<img src="${escapeHtml(r.avatar)}" alt="">` : escapeHtml((r.name || '?').charAt(0).toUpperCase());
      return `<div class="rank ${cls[k]} ${r.me ? 'me' : ''}"><div class="ph" style="background:${r.color || '#f5a623'}">${k === 1 ? '<span class="crown">👑</span>' : ''}${ph}<span class="pos">${pos[k]}</span></div>
        <div class="nm">${r.me ? t('you') : escapeHtml(r.name)}</div><div class="amt"><span class="coin"></span>${fmt(r.amt)}</div></div>`;
    }).join('');
    $('resultModal').hidden = false;
  }
  function resetBoardForBetting() {
    slots.forEach((b) => b.classList.remove('win', 'locked', 'dim'));
    specialEls.forEach((d) => d.classList.remove('win'));
    setLit(-1);
    $('resultModal').hidden = true;
    runBulbs(500);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function floatWin(text) {
    const d = document.createElement('div');
    d.className = 'float-win'; d.textContent = text;
    $('app').appendChild(d); setTimeout(() => d.remove(), 1700);
  }
  function coinRain(n) {
    const app = $('app'), h = app.clientHeight;
    for (let k = 0; k < n; k++) {
      const c = document.createElement('span');
      c.className = 'coin coin-rain';
      c.style.left = (5 + Math.random() * 90) + '%';
      c.style.top = (-5 + Math.random() * 20) + '%';
      c.style.setProperty('--dy', (h * (0.5 + Math.random() * 0.4)) + 'px');
      c.style.animationDelay = (Math.random() * 0.4) + 's';
      app.appendChild(c); setTimeout(() => c.remove(), 1800);
    }
  }

  /* =====================================================
     DEMO MODE (no server)
     ===================================================== */
  const BOT_NAMES = ['Mano777', 'Zeenova', 'Rasel', 'Sultan_OM', 'Nadia', 'Kiran', 'Fahad99', 'Mitu', 'Arif', 'Layla', 'Tanvir', 'Hamad', 'Sumi', 'Rakib'];
  const BOT_COLORS = ['#e9452f', '#2a6fd1', '#2f9a3a', '#7f2ac4', '#cf7f00', '#13917f'];
  let timer = null, botTimer = null;

  function newBots() {
    S.bots = BOT_NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 8).map((n, k) => ({
      name: n, color: BOT_COLORS[k % BOT_COLORS.length], bets: new Array(N).fill(0),
      budget: [500, 2000, 5000, 20000, 60000][Math.floor(Math.random() * 5)]
    }));
    S.online = 40 + Math.floor(Math.random() * 120);
    $('onlineCount').textContent = S.online;
  }
  function botTick() {
    if (!CONFIG.simulateOtherPlayers || S.phase !== 'betting') return;
    S.bots.forEach((bot) => {
      if (Math.random() > 0.35) return;
      const spent = bot.bets.reduce((a, b) => a + b, 0);
      if (spent >= bot.budget) return;
      const i = Math.random() < 0.7 ? 4 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 4);
      const amt = [10, 100, 100, 1000, 1000, 5000][Math.floor(Math.random() * 6)];
      if (spent + amt > bot.budget) return;
      bot.bets[i] += amt; S.allBets[i] += amt;
    });
    renderBets();
  }
  function pickRandom() {
    const total = OUT.reduce((a, o) => a + o.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < OUT.length; i++) { r -= OUT[i].weight; if (r < 0) return i; }
    return 0;
  }
  function demoStartBetting() {
    S.phase = 'betting';
    S.timeLeft = CONFIG.bettingSeconds;
    S.myBets = new Array(N).fill(0);
    S.allBets = new Array(N).fill(0);
    newBots(); resetBoardForBetting();
    renderBets(); renderHub(); renderHistory(false);
    emit('round_start', { round: S.round, bettingSeconds: CONFIG.bettingSeconds, balance: S.balance });
    if (S.auto) setTimeout(() => repeatBets(true), 300);
    clearInterval(timer); clearInterval(botTimer);
    botTimer = setInterval(botTick, 700);
    timer = setInterval(() => {
      S.timeLeft--;
      if (S.timeLeft <= 5 && S.timeLeft > 0) sfx('count');
      renderHub();
      if (S.timeLeft <= 0) { clearInterval(timer); clearInterval(botTimer); demoSpin(); }
    }, 1000);
  }
  async function demoSpin() {
    S.phase = 'spinning';
    slots.forEach((b) => b.classList.add('locked'));
    renderHub(); renderBets();
    const bets = {}; CONFIG.items.forEach((it, i) => { if (S.myBets[i]) bets[it.id] = S.myBets[i]; });
    emit('betting_closed', { round: S.round, bets, totalBet: sumMy() });
    let result;
    if (CONFIG.resultProvider) {
      try {
        const r = await CONFIG.resultProvider({ round: S.round, bets, userId: S.user.id });
        result = typeof r === 'number' ? r : outIdx(r);
      } catch (e) { result = -1; }
      if (!(result >= 0 && result < OUT.length)) result = pickRandom();
    } else result = pickRandom();
    animateSpin(result, CONFIG.spinSeconds * 1000 - 1000, () => demoFinish(result));
  }
  function demoFinish(result) {
    S.phase = 'result';
    const myTotal = sumMy();
    const winAmt = payoutOf(result, S.myBets);
    S.balance += winAmt; S.lastWin = winAmt; S.todayRev += winAmt - myTotal;
    if (myTotal > 0) { S.lastBets = S.myBets.slice(); S.records.unshift({ round: S.round, idx: result, bet: myTotal, win: winAmt }); }
    S.history.unshift({ round: S.round, idx: result });
    if (S.history.length > 100) S.history.length = 100;
    const rows = S.bots.map((b) => ({ name: b.name, color: b.color, amt: payoutOf(result, b.bets) }));
    if (winAmt > 0) rows.push({ name: S.user.name, me: true, amt: winAmt, avatar: S.user.avatar || avatarData(S.user.name) });
    const top = rows.filter((r) => r.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 3);
    showRoundEnd(result, winAmt, myTotal, top);
    emit('round_result', { round: S.round, resultId: OUT[result].id, resultIndex: result, totalBet: myTotal, win: winAmt, net: winAmt - myTotal, balance: S.balance });
    let left = CONFIG.resultSeconds + 1;
    timer = setInterval(() => {
      left--;
      $('resTimer').textContent = Math.max(Math.min(left, CONFIG.resultSeconds), 0);
      if (left <= 0) { clearInterval(timer); S.round++; demoStartBetting(); }
    }, 1000);
  }

  /* =====================================================
     ONLINE MODE (game server decides everything)
     ===================================================== */
  let wsRetry = 0, clockTimer = null, server = '', token = '';
  const now = () => Date.now() + S.clockOffset;
  function wsUrl(base) {
    const local = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (/^wss?:\/\//.test(base)) return base.replace(/\/$/, '') + '/ws';
    if (/^https?:\/\//.test(base)) return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
    // relative proxy path (preview hosting)
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (local.has(location.hostname) && base.startsWith('__PORT_')) return `${proto}//${location.host}/ws`;
    return `${proto}//${location.host}${location.pathname.replace(/\/[^/]*$/, '')}/${base.replace(/^\//, '')}/ws`;
  }
  function wsSend(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }

  function connect() {
    S.mode = 'online';
    clearInterval(timer); clearInterval(botTimer);
    if (S.phase !== 'betting' || !S.ws) { S.phase = 'connecting'; renderHub(); }
    const q = new URLSearchParams();
    if (token) q.set('token', token);
    else { q.set('demo', '1'); q.set('name', S.user.name); if (S.user.id !== 'guest') q.set('uid', S.user.id); }
    const ws = new WebSocket(wsUrl(server) + '?' + q.toString());
    S.ws = ws;
    ws.onopen = () => { wsRetry = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onServer(m); };
    ws.onclose = (e) => {
      if (S.ws !== ws) return;
      if (e.code === 4001) { toast(t('authErr'), 5000); emit('auth_failed', {}); return; }
      toast(t('offline'), 2500);
      S.pending.clear();
      setTimeout(connect, Math.min(10000, 800 * Math.pow(1.6, wsRetry++)));
    };
  }

  function syncClock(serverTime) { if (serverTime) S.clockOffset = serverTime - Date.now(); }
  function startClock() {
    clearInterval(clockTimer);
    let lastSec = null;
    clockTimer = setInterval(() => {
      if (S.phase === 'betting') {
        S.timeLeft = Math.max(0, Math.ceil((S.endsAt - now()) / 1000));
        if (S.timeLeft !== lastSec) { if (S.timeLeft <= 5 && S.timeLeft > 0) sfx('count'); lastSec = S.timeLeft; renderHub(); }
      } else if (S.phase === 'result') {
        $('resTimer').textContent = Math.max(0, Math.ceil((S.endsAt - now()) / 1000));
      }
    }, 200);
  }

  function onBetting(st) {
    const newRound = st.round !== S.round || S.phase !== 'betting';
    S.round = st.round; S.phase = 'betting'; S.endsAt = st.endsAt;
    if (newRound) {
      S.myBets = st.myBets || new Array(N).fill(0);
      S.pending.clear();
      resetBoardForBetting();
      if (S.auto) setTimeout(() => repeatBets(true), 300);
      emit('round_start', { round: S.round, balance: S.balance });
    }
    S.allBets = st.totals || S.allBets;
    S.online = st.online; $('onlineCount').textContent = st.online;
    renderBets(); renderHub();
  }

  function onServer(m) {
    syncClock(m.serverTime || (m.state && m.state.serverTime));
    switch (m.t) {
      case 'hello': {
        Object.assign(S.user, m.user); renderUser();
        S.balance = m.balance;
        if (m.config) {
          if (m.config.chips) { CONFIG.chips = m.config.chips; S.chipIdx = Math.min(S.chipIdx, CONFIG.chips.length - 1); buildChips(); }
          if (m.config.maxBetPerRound) CONFIG.maxBetPerRound = m.config.maxBetPerRound;
        }
        S.history = (m.history || []).map((h) => ({ round: h.round, idx: outIdx(h.itemId) })).filter((h) => h.idx >= 0);
        renderHistory(false); renderBalance();
        const st = m.state;
        if (st.phase === 'betting') onBetting({ ...st, myBets: m.myBets });
        else { // joined mid-spin/result: just show the outcome
          S.round = st.round; S.phase = st.phase; S.endsAt = st.endsAt; S.myBets = m.myBets; S.allBets = st.totals;
          resetBoardForBetting(); slots.forEach((b) => b.classList.add('locked'));
          const o = outIdx(st.resultId);
          if (o >= 0) { const w = OUT[o].wins; slots.forEach((b, k) => { b.classList.toggle('win', w.includes(k)); b.classList.toggle('dim', !w.includes(k)); }); }
          renderBets(); renderHub();
        }
        startClock();
        emit('ready', { version: API.version, mode: 'online' });
        break;
      }
      case 'state': if (m.phase === 'betting') onBetting(m); break;
      case 'totals': if (m.round === S.round) { S.allBets = m.totals; S.online = m.online; $('onlineCount').textContent = m.online; renderBets(); } break;
      case 'bet_ok': {
        const p = S.pending.get(m.reqId); S.pending.delete(m.reqId);
        S.myBets = m.myBets; S.balance = m.balance;
        if (p) { S.allBets[p.i] = Math.max(S.allBets[p.i], S.myBets[p.i]); bump(slots[p.i]); }
        renderBets(); renderBalance();
        emit('bet', { round: m.round, itemId: m.itemId, amount: m.amount, balance: m.balance });
        break;
      }
      case 'bet_err': {
        S.pending.delete(m.reqId);
        if (typeof m.balance === 'number') { S.balance = m.balance; renderBalance(); }
        const map = { INSUFFICIENT_BALANCE: t('noCoins'), BETTING_CLOSED: t('betClosed'), ROUND_CHANGED: t('betClosed'), MAX_BET: t('maxBet') };
        toast(map[m.code] || t('walletErr'));
        if (m.code === 'INSUFFICIENT_BALANCE') emit('insufficient_balance', { balance: S.balance });
        break;
      }
      case 'spin': {
        S.phase = 'spinning'; S.endsAt = m.endsAt; S.allBets = m.totals || S.allBets;
        slots.forEach((b) => b.classList.add('locked'));
        renderHub(); renderBets();
        const o = outIdx(m.resultId);
        S.lastResult = { round: m.round, o, shown: false };
        animateSpin(o, Math.max(1500, m.endsAt - now() - 300), () => { S.lastResult.shown = true; });
        emit('betting_closed', { round: m.round, totalBet: sumMy() });
        break;
      }
      case 'result': {
        S.phase = 'result'; S.endsAt = m.endsAt;
        const o = outIdx(m.resultId);
        clearTimeout(spinTimer);
        const you = m.you || { bet: 0, win: 0 };
        if (typeof you.balance === 'number') S.balance = you.balance;
        S.lastWin = you.win; S.todayRev += you.win - you.bet;
        if (you.bet > 0) { S.lastBets = S.myBets.slice(); S.records.unshift({ round: m.round, idx: o, bet: you.bet, win: you.win }); }
        S.history.unshift({ round: m.round, idx: o });
        const top = (m.top || []).map((r) => ({ name: r.name, avatar: r.avatar, amt: r.win, me: r.userId === S.user.id }));
        showRoundEnd(o, you.win, you.bet, top);
        emit('round_result', { round: m.round, resultId: m.resultId, totalBet: you.bet, win: you.win, net: you.win - you.bet, balance: S.balance, seed: m.seed, hash: m.hash });
        break;
      }
      case 'balance': S.balance = m.balance; renderBalance(); break;
      case 'records':
        S.records = (m.list || []).map((r) => ({ round: r.round, idx: outIdx(r.itemId), bet: r.bet, win: r.win })).filter((r) => r.idx >= 0);
        if (!$('historyModal').hidden) renderHistoryPanel();
        break;
      case 'error': toast(m.message || 'Error', 3000); break;
    }
  }

  /* ---------------- SOUND ---------------- */
  let ac = null;
  function sfx(kind) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const tone = (f, d, type = 'square', v = 0.06, delay = 0) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f;
        const t0 = ac.currentTime + delay;
        g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
      };
      if (kind === 'tick') tone(880, 0.05, 'square', 0.03);
      else if (kind === 'bet') { tone(1200, 0.06, 'triangle', 0.08); tone(1600, 0.06, 'triangle', 0.05, 0.04); }
      else if (kind === 'chip') tone(700, 0.05, 'triangle', 0.06);
      else if (kind === 'count') tone(520, 0.12, 'sine', 0.1);
      else if (kind === 'win') [523, 659, 784, 1046, 1318].forEach((f, k) => tone(f, 0.22, 'triangle', 0.1, k * 0.1));
      else if (kind === 'special') [392, 523, 659, 784, 1046, 784, 1046, 1318].forEach((f, k) => tone(f, 0.18, 'square', 0.06, k * 0.08));
      else if (kind === 'end') tone(300, 0.25, 'sine', 0.08);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- HOST APP BRIDGE ---------------- */
  function emit(type, payload) {
    const msg = { source: 'greedy-game', type, payload, userId: S.user.id, ts: Date.now() };
    const json = JSON.stringify(msg);
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(json); } catch (e) {}
    try { window.GreedyBridge && window.GreedyBridge.onEvent && window.GreedyBridge.onEvent(json); } catch (e) {}
    try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.greedy && window.webkit.messageHandlers.greedy.postMessage(msg); } catch (e) {}
    try { window.flutter_inappwebview && window.flutter_inappwebview.callHandler && window.flutter_inappwebview.callHandler('greedy', msg); } catch (e) {}
    try { window.GreedyFlutter && window.GreedyFlutter.postMessage && window.GreedyFlutter.postMessage(json); } catch (e) {}
    if (typeof API.onEvent === 'function') { try { API.onEvent(msg); } catch (e) {} }
  }

  const API = {
    version: '3.0.0',
    onEvent: null,
    /** Online mode: GreedyGame.connect({ server:'https://game.your-app.com', token:'<JWT from your app>' }) */
    connect(opts = {}) { server = opts.server || server; token = opts.token || token; if (S.ws) { const old = S.ws; S.ws = null; old.close(); } connect(); },
    init(opts = {}) {
      if (opts.user) Object.assign(S.user, opts.user);
      if (typeof opts.balance === 'number' && S.mode === 'demo') S.balance = Math.max(0, opts.balance);
      if (opts.lang && T[opts.lang]) API.setLang(opts.lang);
      if (typeof opts.sound === 'boolean') API.setSound(opts.sound);
      if (opts.config) API.config(opts.config);
      renderUser(); renderBalance();
      if (opts.server) API.connect(opts);
    },
    config(c = {}) {
      Object.assign(CONFIG, c);
      if (c.items || c.specials) buildOutcomes();
      if (c.chips) { S.chipIdx = Math.min(S.chipIdx, CONFIG.chips.length - 1); buildChips(); }
    },
    /** Demo mode only. Online the balance always comes from the server. */
    setBalance(n) { if (S.mode === 'demo') { S.balance = Math.max(0, Number(n) || 0); renderBalance(); } else API.refreshBalance(); },
    addCoins(n) { if (S.mode === 'demo') { S.balance += Number(n) || 0; renderBalance(); } else API.refreshBalance(); },
    /** Online: ask the server to re-read the balance from your wallet (call after a top-up). */
    refreshBalance() { wsSend({ t: 'balance' }); },
    setHistory(list) {
      S.history = (list || []).map((h) => ({ round: h.round, idx: outIdx(h.itemId) })).filter((h) => h.idx >= 0);
      renderHistory(false);
    },
    setOnline(n) { S.online = n; $('onlineCount').textContent = n; },
    getState() { return { mode: S.mode, round: S.round, phase: S.phase, timeLeft: S.timeLeft, balance: S.balance, myBets: S.myBets.slice(), history: S.history.slice(0, 20).map((h) => ({ round: h.round, itemId: OUT[h.idx].id })), records: S.records.slice(0, 20) }; },
    setLang(l) { if (T[l]) { S.lang = l; applyLang(); renderHub(); renderHistory(false); } },
    setSound(on) { S.sound = !!on; renderSound(); },
  };
  window.GreedyGame = API;

  window.addEventListener('message', (e) => {
    let d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
    if (!d || d.target !== 'greedy-game' || typeof API[d.cmd] !== 'function') return;
    API[d.cmd](d.value);
  });
  document.addEventListener('message', (e) => {
    try { const d = JSON.parse(e.data); if (d.target === 'greedy-game' && typeof API[d.cmd] === 'function') API[d.cmd](d.value); } catch (_) {}
  });

  /* ---------------- UI wiring ---------------- */
  function renderSound() { $('icoSoundOn').style.display = S.sound ? '' : 'none'; $('icoSoundOff').style.display = S.sound ? 'none' : ''; }
  $('btnSound').addEventListener('click', () => { S.sound = !S.sound; renderSound(); sfx('chip'); });
  $('btnHelp').addEventListener('click', () => ($('helpModal').hidden = false));
  $('btnHelpClose').addEventListener('click', () => ($('helpModal').hidden = true));
  $('btnHistory').addEventListener('click', () => openHistory('results'));
  $('btnHistory2').addEventListener('click', () => openHistory('results'));
  $('btnHistoryClose').addEventListener('click', () => ($('historyModal').hidden = true));
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  ['helpModal', 'historyModal'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target.id === id) $(id).hidden = true; }));
  $('btnBack').addEventListener('click', () => emit('close', { balance: S.balance }));
  $('btnTopup').addEventListener('click', () => emit('topup', { balance: S.balance }));
  $('btnRepeat').addEventListener('click', () => repeatBets(false));
  $('btnAuto').addEventListener('click', () => {
    S.auto = !S.auto; renderAuto();
    if (S.auto && S.phase === 'betting' && sumMy() === 0) repeatBets(true);
  });
  window.addEventListener('resize', fitWheel);

  /* ---------------- BOOT ---------------- */
  buildWheel(); buildChips(); applyLang(); renderUser(); renderSound(); renderBalance();
  fitWheel();
  server = qs.get('server') || '';
  token = qs.get('token') || '';
  const preset = (window.GREEDY_SERVER || '');
  const presetOk = preset && !(preset.startsWith('__PORT_') && !['localhost', '127.0.0.1'].includes(location.hostname));
  if (!server && presetOk && qs.get('demo') !== 'offline') server = preset;
  if (server) {
    S.balance = 0; renderBalance();
    toast(t('connecting'));
    connect();
  } else {
    S.history = Array.from({ length: 20 }, (_, k) => ({ round: S.round - 1 - k, idx: pickRandom() })).filter((h) => h.round > 0);
    emit('ready', { version: API.version, mode: 'demo' });
    demoStartBetting();
  }
})();
