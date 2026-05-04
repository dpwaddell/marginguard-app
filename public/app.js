(function () {
  'use strict';

  // App Bridge session token retrieval
  async function getSessionToken() {
    if (typeof shopify !== 'undefined' && shopify.idToken) {
      return shopify.idToken();
    }
    // Fallback: App Bridge 3.x
    if (window.__shopify_app_bridge__) {
      const bridge = window.__shopify_app_bridge__;
      const { getSessionToken } = bridge;
      if (typeof getSessionToken === 'function') {
        return getSessionToken(bridge);
      }
    }
    // Dev fallback — not for production
    console.warn('[MarginGuard] No App Bridge found, using empty token');
    return 'dev-token';
  }

  window.getSessionToken = getSessionToken;

  // Simple navigation highlight
  document.addEventListener('DOMContentLoaded', function () {
    const path = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('href') === path) {
        link.classList.add('active');
      }
    });
  });
})();
