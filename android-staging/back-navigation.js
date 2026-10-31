/* Android-only back navigation for the unchanged Sharika web UI. */
(function () {
  'use strict';

  function isOpen(node) {
    return !!(node && node.classList && node.classList.contains('on'));
  }

  function dismissSheet(doc, overlayId, sheetId) {
    var overlay = doc.getElementById(overlayId);
    if (!isOpen(overlay)) return false;
    var sheet = doc.getElementById(sheetId);
    // Return from a game to its game list, or a nested settings page to its parent.
    var back = sheet && sheet.querySelector(
      '#sh-original-back, #sh-event-back, #pbk, #ubk, button.back, button.back2'
    );
    if (back && !back.disabled) {
      back.click();
      return true;
    }
    // Closing a game must stop its hidden frame and background polling.
    var view = doc.defaultView;
    if (view && typeof view.__sharikaOriginalGameCleanup === 'function') {
      view.__sharikaOriginalGameCleanup();
    }
    if (doc === document && typeof window.closeSheet === 'function') {
      window.closeSheet();
    } else if (view && typeof view.close === 'function') {
      view.close();
    } else {
      overlay.classList.remove('on');
    }
    return true;
  }

  function handleBack() {
    var get = function (id) { return document.getElementById(id); };

    // Never navigate through the application behind the login screen.
    if (isOpen(get('au'))) {
      if (window.amode && window.amode !== 'login' &&
          window.amode !== 'welcome' && typeof window.showAuth === 'function') {
        window.showAuth('login');
        return 'handled';
      }
      return 'exit';
    }

    if (dismissSheet(document, 'shb', 'sh')) return 'handled';
    if (isOpen(get('pfo'))) {
      get('pfo').classList.remove('on');
      return 'handled';
    }
    if (isOpen(get('rcp'))) {
      get('rcp').classList.remove('on');
      return 'handled';
    }
    if (isOpen(get('th'))) {
      get('th').classList.remove('on');
      return 'handled';
    }

    var room = get('rw');
    if (isOpen(room)) {
      var iframe = get('rf');
      try {
        var inside = iframe && iframe.contentDocument;
        if (inside) {
          var viewer = inside.getElementById('viewer');
          if (isOpen(viewer)) {
            viewer.classList.remove('on');
            return 'handled';
          }
          if (dismissSheet(inside, 'bg', 'sheet')) return 'handled';
          var tray = inside.getElementById('tray');
          if (isOpen(tray)) {
            tray.classList.remove('on');
            return 'handled';
          }
          // Reuse the room's minimize action; do not leave the voice channel.
          var minimize = inside.getElementById('min');
          if (minimize) {
            minimize.click();
            return 'handled';
          }
        }
      } catch (_) {
        // A frame can be briefly unavailable while a room loads.
      }
      room.classList.remove('on');
      var mini = get('mini');
      if (mini) mini.classList.add('on');
      if (get('minib') && window.cur) get('minib').textContent = window.cur.emoji || '🎙️';
      return 'handled';
    }

    var active = document.querySelector('.view.on');
    if (active && active.id !== 'v-home' && typeof window.go === 'function') {
      window.go('home');
      return 'handled';
    }
    // On home, native Android shows a confirmation before exiting.
    return 'exit';
  }

  window.sharikaHandleAndroidBack = handleBack;
})();
