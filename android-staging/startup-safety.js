/* Android staging startup watchdog.
 * An exception in the large embedded page/adapter must not trap members behind
 * the branded opening screen. Does not sign out or change Firebase/D1 state.
 */
(function () {
  'use strict';

  const LOGO_URL = './sharika_logo.jpg';
  const MAX_STARTUP_MS = 12000;

  function usePackagedLogo() {
    // A damaged inline image can display the "Sharika" alt text in WebView.
    // The exact app icon is bundled as a local JPEG.
    if (window.BRAND) window.BRAND.logo = LOGO_URL;
    const image = document.querySelector('#sp img[data-logo]');
    if (image && image.getAttribute('src') !== LOGO_URL) image.src = LOGO_URL;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', usePackagedLogo, { once: true });
  } else {
    usePackagedLogo();
  }

  function releaseStuckOpening() {
    const app = document.getElementById('app');
    const splash = document.getElementById('sp');
    if (!app || !splash) return;

    const stuck = app.classList.contains('sharika-startup-verifying') ||
      splash.classList.contains('sharika-opening-pending') ||
      (!splash.classList.contains('off') &&
       !splash.classList.contains('sharika-opening-featured'));
    if (!stuck) return;

    // A verified account may be viewing its deliberately timed opening card.
    // Never interrupt that screen, or a visible connection-recovery dialog.
    if (document.getElementById('sh-opening') ||
        document.getElementById('sh-login-recovery')) return;
    try {
      if (window.SharikaServer &&
          typeof window.SharikaServer.connected === 'function' &&
          window.SharikaServer.connected()) return;
    } catch (_) {}

    splash.classList.remove('sharika-opening-pending');
    splash.classList.add('off');
    app.classList.remove('sharika-startup-verifying');

    if (typeof window.showAuth === 'function') {
      // Restore/sign-in may still complete later. This only exposes the
      // existing secure Firebase login view; it never clears credentials.
      const auth = document.getElementById('au');
      if (auth && !auth.classList.contains('on')) window.showAuth('welcome');
      return;
    }

    // If the embedded application itself failed before defining showAuth,
    // offer an actionable recovery instead of a blank or frozen page.
    if (document.getElementById('sh-startup-recovery')) return;
    const panel = document.createElement('section');
    panel.id = 'sh-startup-recovery';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483640;display:flex;' +
      'align-items:center;justify-content:center;padding:24px;background:#100721;' +
      'color:#ffe5a3;font:600 16px system-ui;text-align:center';
    const content = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Sharika could not finish opening';
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = 'Retry opening Sharika';
    action.style.cssText = 'margin-top:20px;padding:14px 22px;border-radius:14px;' +
      'border:2px solid #d8ae5a;background:#f1c878;color:#2c1435;font-weight:800';
    action.onclick = function () { window.location.reload(); };
    content.append(title, action);
    panel.appendChild(content);
    document.body.appendChild(panel);
  }

  window.setTimeout(releaseStuckOpening, MAX_STARTUP_MS);
})();
