/*
 * Sharika Royal Premium visual layer. Android staging only.
 * No transport hooks, event replacements, balances, navigation or room state writes.
 */
(function () {
  'use strict';
  if (document.documentElement.dataset.sharikaRoyalMounted === '1') return;
  document.documentElement.dataset.sharikaRoyalMounted = '1';

  var SHEET_URL = 'file:///android_asset/royal-premium.css';
  var FRAME_ID = 'rf';
  var frameObserver = null;

  function installSheet(doc, role) {
    if (!doc || !doc.documentElement || !doc.head) return;
    doc.documentElement.classList.add('royal-premium', role);
    if (doc.getElementById('sharika-royal-premium-style')) return;
    var stylesheet = doc.createElement('link');
    stylesheet.id = 'sharika-royal-premium-style';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = SHEET_URL;
    doc.head.appendChild(stylesheet);
  }

  function styleRoom() {
    var iframe = document.getElementById(FRAME_ID);
    if (!iframe) return;
    try {
      var doc = iframe.contentDocument;
      if (!doc || !doc.head) return;
      if (frameObserver) {
        frameObserver.disconnect();
        frameObserver = null;
      }
      installSheet(doc, 'royal-room');

      var roomApp = doc.getElementById('app');
      if (!roomApp) return;
      function syncOwnerTheme() {
        var settings = null;
        try { settings = iframe.contentWindow && iframe.contentWindow.S; } catch (e) {}
        // The palace wallpaper is only an enhancement to the default Midnight
        // room. Room owners' themes or uploaded wall backgrounds always win.
        var usePalace = !!(settings && settings.theme === 'mid' && !settings.bg);
        roomApp.classList.toggle('royal-default-room', usePalace);
      }
      syncOwnerTheme();
      if (typeof MutationObserver === 'function') {
        frameObserver = new MutationObserver(syncOwnerTheme);
        frameObserver.observe(roomApp, {
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }
    } catch (e) {
      // A room that does not permit document access retains its native styles.
    }
  }

  function boot() {
    installSheet(document, 'royal-root');
    var iframe = document.getElementById(FRAME_ID);
    if (iframe) {
      iframe.addEventListener('load', styleRoom, false);
      styleRoom();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
