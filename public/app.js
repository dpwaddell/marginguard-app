(function () {
  'use strict';

  // App Bridge session token retrieval (App Bridge 4.x)
  window.getSessionToken = async function () {
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await window.shopify.idToken();
    }
    // Wait up to 3 seconds for App Bridge to initialise
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.shopify && typeof window.shopify.idToken === 'function') {
        return await window.shopify.idToken();
      }
    }
    throw new Error('App Bridge not available after timeout');
  };

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
