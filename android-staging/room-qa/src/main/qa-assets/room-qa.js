/* Instrumented WebView fixture. Runs only in the isolated room-qa APK. */
(function () {
  'use strict';
  const bridge = window.RoomQaReporter;
  if (!bridge || window.__roomQaStarted) return;
  window.__roomQaStarted = true;
  const frame = document.getElementById('rf');
  if (!frame) { bridge.record('{"phase":"error","reason":"missing iframe"}'); return; }

  // Room Chat is now a deliberate separate action from Private DM. The text
  // composer begins hidden and has no tappable rectangle until Room Chat opens.
  // A layout snapshot taken immediately after iframe load is not an IME test.
  function waitForOpenComposer(attempt = 0) {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const input = doc?.getElementById('txt');
    const toggle = doc?.getElementById('sh-chat-toggle');
    const hasKeyboardApi = typeof win?.SharikaRoyalKeyboard?.setNativeIme === 'function';
    if (attempt === 20) {
      bridge.record(JSON.stringify({phase:'composer-probe',inputPresent:!!input,
        togglePresent:!!toggle,hasKeyboardApi,documentReadyState:doc?.readyState,
        composerPresent:!!doc?.querySelector('.sh-composer')}));
    }
    if (!input || !toggle) {
      if (attempt < 40) return setTimeout(() => waitForOpenComposer(attempt + 1), 250);
      bridge.record(JSON.stringify({phase:'error',reason:'room_chat_keyboard_not_ready',
        inputPresent:!!input,togglePresent:!!toggle,hasKeyboardApi}));
      report('before');
      return;
    }
    if (!doc.documentElement.dataset.qaComposerOpened) {
      doc.documentElement.dataset.qaComposerOpened = '1';
      toggle.click();
    }
    const rect = input.getBoundingClientRect();
    if ((rect.width < 20 || rect.height < 8) && attempt < 40)
      return setTimeout(() => waitForOpenComposer(attempt + 1), 250);
    if (!hasKeyboardApi) {
      bridge.record(JSON.stringify({phase:'error',reason:'room_keyboard_api_missing',
        inputPresent:true,togglePresent:true,documentReadyState:doc?.readyState,
        scripts:[...doc.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'))}));
    }
    report('before');
  }

  function report(phase) {
    const frameRect = frame.getBoundingClientRect();
    const w = frame.contentWindow;
    const doc = frame.contentDocument;
    const app = doc?.getElementById('app');
    if (!app) {
      bridge.record(JSON.stringify({phase, ready:false}));
      return;
    }
    const get = selector => {
      const r = doc.querySelector(selector)?.getBoundingClientRect();
      return r ? {top:Math.round(r.top),left:Math.round(r.left),
        height:Math.round(r.height),width:Math.round(r.width)} : null;
    };
    const input = get('#txt');
    const ratio = window.devicePixelRatio || 1;
    const nativeOffset = window.__roomQaOriginPx || [0, 0];
    const tapX = input ? Math.round(nativeOffset[0] +
      (frameRect.left + input.left + input.width / 2) * ratio) : 0;
    const tapY = input ? Math.round(nativeOffset[1] +
      (frameRect.top + input.top + input.height / 2) * ratio) : 0;
    bridge.record(JSON.stringify({phase,ready:true,
      keyboardClass:app.classList.contains('sh-keyboard-open'),
      hasKeyboardApi:typeof w?.SharikaRoyalKeyboard,
      focusTarget:doc?.activeElement?.id || doc?.activeElement?.tagName || '',
      iframeFocused:!!doc?.hasFocus(),
      owner:get('.host'),firstSeat:get('.grid .seat'),
      header:get('.top'),stage:get('.stage'),composer:get('.sh-composer'),
      dock:get('.dock'),input,tapX,tapY,
      imeInset:app.style.getPropertyValue('--sh-ime-inset'),
      viewportHeight:Math.round(w?.visualViewport?.height || 0),
      frameHeight:Math.round(frameRect.height),
      fingerprint:w?.getComputedStyle(doc.querySelector('.sh-settings'),'::after').content || ''}));
  }
  window.SharikaRoomQa = Object.freeze({report});

  // Show the same room iframe from the packaged application without logging
  // into a server: only markup, style, and keyboard anchoring are measured.
  document.getElementById('sp')?.style.setProperty('display','none','important');
  document.querySelectorAll('.auth.on').forEach(el => el.classList.remove('on'));
  frame.addEventListener('load', function onRoomReady() {
    if (!frame.contentDocument?.getElementById('app')) return;
    frame.removeEventListener('load', onRoomReady);
    waitForOpenComposer();
  });
  if (typeof window.openRoom !== 'function') {
    bridge.record('{"phase":"error","reason":"missing openRoom"}');
    return;
  }
  window.openRoom({id:'10000006', name:'Sharika WebView Layout QA',
    emoji:'💎', th:'mid'});
})();
