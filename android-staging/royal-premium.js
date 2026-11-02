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

  function ensureSheet(doc,id,url) {
    var existing=doc.getElementById(id);
    if(existing)return existing;
    var link=doc.createElement('link');
    link.id=id;link.rel='stylesheet';link.href=url;
    doc.head.appendChild(link);
    return link;
  }

  function installSheet(doc,role) {
    if(!doc||!doc.documentElement||!doc.head)return [];
    doc.documentElement.classList.add('royal-premium',role);
    return [
      ensureSheet(doc,'sharika-royal-premium-style',SHEET_URL),
      ensureSheet(doc,'sharika-winged-theme-style',
        'file:///android_asset/royal-winged-theme.css')
    ];
  }

  // Load the final room theme as part of the iframe's initial HTML parse.
  // Adding it only after the iframe load event caused a visible old/new flash.
  function preloadRoomStyles() {
    if(typeof window.ROOM_HTML!=='string' ||
       window.ROOM_HTML.includes('sharika-winged-theme-style'))return;
    var head='<script>document.documentElement.classList.add("royal-premium","royal-room")<\/script>'+
      '<link id="sharika-royal-premium-style" rel="stylesheet" href="'+SHEET_URL+'">'+
      '<link id="sharika-winged-theme-style" rel="stylesheet" href="file:///android_asset/royal-winged-theme.css">';
    window.ROOM_HTML=window.ROOM_HTML.replace('</head>',head+'</head>');
  }

  function waitForSheet(link) {
    return new Promise(function(resolve){
      if(!link){resolve();return;}
      var done=false,timer;
      function finish(){
        if(done)return;
        done=true;clearTimeout(timer);
        link.removeEventListener('load',finish);
        link.removeEventListener('error',finish);
        resolve();
      }
      link.addEventListener('load',finish,{once:true});
      link.addEventListener('error',finish,{once:true});
      timer=setTimeout(finish,4500);
      try{if(link.sheet)finish();}catch(_){}
    });
  }

  function revealAndroidApp() {
    if(window.SharikaNative&&typeof window.SharikaNative.call==='function')
      window.SharikaNative.call('0','visualReady','{}');
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
    preloadRoomStyles();
    Promise.all(installSheet(document,'royal-root').map(waitForSheet))
      .then(revealAndroidApp);
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
