// public/pwaInstall.js
//
// Makes the site's "Install App" option visible and one-tap, instead of
// relying on people finding Chrome's own menu item. Two separate flows:
//   1. Android / desktop Chrome & Edge: these fire `beforeinstallprompt`,
//      which we capture and trigger from our own button.
//   2. iOS Safari: never fires `beforeinstallprompt` and has no
//      programmatic install API at all -- the only way to install is the
//      user manually tapping Share -> Add to Home Screen. We can't trigger
//      that for them, so we just show a one-time tip instead of a button.

(function () {
  // Already running as an installed app -- nothing to offer.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

  function injectStyles() {
    if (document.getElementById('mm-pwa-install-styles')) return;
    const style = document.createElement('style');
    style.id = 'mm-pwa-install-styles';
    style.textContent = `
      .mm-install-btn {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 9998;
        display: flex;
        align-items: center;
        gap: 8px;
        background: #664638;
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 12px 20px;
        font-family: inherit;
        font-weight: 700;
        font-size: 0.95rem;
        box-shadow: 0 6px 18px rgba(102, 70, 56, 0.35);
        cursor: pointer;
      }
      .mm-install-btn:hover { background: #543627; }
      .mm-ios-tip {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 16px;
        z-index: 9998;
        background: #FFF5F4;
        border: 1px solid #F2D9D6;
        border-radius: 16px;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.12);
        font-family: inherit;
        color: #4a3427;
        font-size: 0.9rem;
      }
      .mm-ios-tip button {
        margin-left: auto;
        background: none;
        border: none;
        font-size: 1.1rem;
        color: #8a6f61;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
      }
      @media (max-width: 480px) {
        .mm-install-btn { right: 16px; bottom: 84px; padding: 10px 16px; font-size: 0.88rem; }
      }
    `;
    document.head.appendChild(style);
  }

  // --- Android / desktop Chrome & Edge ---------------------------------
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('mmInstallBtn');
    if (btn) btn.remove();
  });

  function showInstallButton() {
    if (document.getElementById('mmInstallBtn')) return;
    injectStyles();

    const btn = document.createElement('button');
    btn.id = 'mmInstallBtn';
    btn.type = 'button';
    btn.className = 'mm-install-btn';
    btn.innerHTML = '<i class="fa-solid fa-arrow-down-to-line"></i> Install App';

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      btn.disabled = true;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (e) {}
      deferredPrompt = null;
      btn.remove();
    });

    document.body.appendChild(btn);
  }

  // --- iOS Safari: no install API, so just a one-time tip --------------
  function showIosTip() {
    if (localStorage.getItem('mm_ios_install_tip_dismissed') === '1') return;
    injectStyles();

    const tip = document.createElement('div');
    tip.className = 'mm-ios-tip';
    tip.innerHTML = `
      <span>Install this app: tap <strong>Share</strong>
      <i class="fa-solid fa-arrow-up-from-bracket"></i> then
      <strong>Add to Home Screen</strong>.</span>
      <button type="button" aria-label="Dismiss">&times;</button>
    `;
    tip.querySelector('button').addEventListener('click', () => {
      localStorage.setItem('mm_ios_install_tip_dismissed', '1');
      tip.remove();
    });

    document.body.appendChild(tip);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (isSafari) showIosTip();
  });
})();
