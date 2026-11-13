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
    if (overlayId === 'sh-room-game-overlay') {
      overlay.classList.remove('on');
    } else if (doc === document && typeof window.closeSheet === 'function') {
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

    // An opening spotlight is a single dismissible screen, not navigation.
    var opening = get('sh-opening');
    if (opening) {
      var skip = opening.querySelector('.sh-o-skip');
      if (skip) skip.click();
      return 'handled';
    }

    // Never navigate through the application behind the login screen.
    if (isOpen(get('au'))) {
      if (window.amode && window.amode !== 'login' &&
          window.amode !== 'welcome' && typeof window.showAuth === 'function') {
        window.showAuth('login');
        return 'handled';
      }
      return 'exit';
    }

    // The dedicated search and CP screens must close before the home page
    // behind them can navigate or exit.
    var rankReward = get('sh-rank-reward-center');
    if (rankReward) {
      var rankBack = get('sh-rw-back');
      if (rankBack) rankBack.click();
      else rankReward.remove();
      return 'handled';
    }
    var search = get('sh-global-search');
    if (search && !search.hidden) {
      var searchBack = get('sh-search-back');
      if (searchBack) searchBack.click();
      else search.hidden = true;
      return 'handled';
    }
    var cpCenter = get('sh-cp-center');
    if (cpCenter) {
      var cpBack = get('sh-cp-back');
      if (cpBack) cpBack.click();
      else cpCenter.remove();
      return 'handled';
    }

    // Agency screens have an internal BD -> Agency -> Host report stack.
    var agency = get('sh-agency-panel');
    if (agency && !agency.hidden && typeof window.sharikaAgencyBack === 'function') {
      window.sharikaAgencyBack();
      return 'handled';
    }

    // Keep Android Back inside the new Royal Shop/Backpack before navigating
    // the profile/home screen behind the full-screen collection.
    var royalMarket = get('sh-royal-market');
    if (royalMarket && !royalMarket.hidden) {
      if (typeof window.sharikaCloseRoyalMarket === 'function') {
        window.sharikaCloseRoyalMarket();
      } else {
        royalMarket.hidden = true;
      }
      return 'handled';
    }

    // Full-screen Account/Safety/Policies settings has its own back stack.
    var settings = get('sh-settings-page');
    if (settings && !settings.hidden && typeof window.sharikaSettingsBack === 'function') {
      window.sharikaSettingsBack();
      return 'handled';
    }

    var notifications = document.querySelector('.sh-notify-panel.on');
    if (notifications) {
      notifications.classList.remove('on');
      return 'handled';
    }
    if (dismissSheet(document, 'sh-room-game-overlay', 'sh-room-game-sheet')) return 'handled';
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
      var cancelPin = get('sh-room-password-prompt')?.querySelector('button[type="button"]');
      if (cancelPin) {
        cancelPin.click();
        return 'handled';
      }
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
          if (minimize && !minimize.disabled) {
            minimize.click();
            return 'handled';
          }
        }
      } catch (_) {
        // A frame can be briefly unavailable while a room loads.
      }
      // Before membership is confirmed, Back cancels the pending visit.
      if (typeof window.leaveRoom === 'function') window.leaveRoom();
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
