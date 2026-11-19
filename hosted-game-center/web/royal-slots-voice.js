/* Royal Slots premium English female voice on entry.
 * This script executes in the existing sandboxed game iframe.
 * It cannot access or mutate Sharika wallet state. */
(() => {
  'use strict';
  const game = window.SharikaGame;
  if (!game) return;
  // Existing win effects remain intact; replace only the available verified female recording.
  if (typeof game.setSounds === 'function') {
    game.setSounds({voice_big: '/games/royal-slots/voice-big-female.mp3'});
  }
  const greeting = new Audio('/games/royal-slots/welcome-female.mp3');
  greeting.preload='auto';
  greeting.volume=0.85;
  let spoken=false, attempting=false;
  function announceWelcome() {
    if (spoken || attempting) return;
    attempting=true;
    const attempt = greeting.play();
    if (attempt && typeof attempt.then==='function') {
      attempt.then(()=>{spoken=true;}).catch(()=>{attempting=false;});
    } else spoken=true;
  }
  // Try when loaded; if autoplay is blocked, first touch/click unlocks audio.
  if (document.readyState==='complete') announceWelcome();
  else window.addEventListener('load',announceWelcome,{once:true});
  window.addEventListener('pointerdown',announceWelcome,{passive:true});
  window.addEventListener('touchstart',announceWelcome,{passive:true});
  window.addEventListener('keydown',announceWelcome);
})();