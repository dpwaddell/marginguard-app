(function () {
  'use strict';

  // App Bridge session token retrieval (App Bridge 4.x)
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function(_, reject) { setTimeout(function() { reject(new Error('idToken timeout')); }, ms); }),
    ]);
  }

  window.getSessionToken = async function () {
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await withTimeout(window.shopify.idToken(), 2000);
    }
    // Wait up to 3 seconds for App Bridge to initialise
    for (var i = 0; i < 30; i++) {
      await new Promise(function(r) { setTimeout(r, 100); });
      if (window.shopify && typeof window.shopify.idToken === 'function') {
        return await withTimeout(window.shopify.idToken(), 2000);
      }
    }
    throw new Error('App Bridge not available after timeout');
  };

  async function getShopFromBridge() {
    try {
      if (window.shopify && typeof window.shopify.idToken === 'function') {
        var token = await window.shopify.idToken();
        var parts = token.split('.');
        if (parts.length >= 2) {
          var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.dest) {
            return payload.dest.replace('https://', '');
          }
        }
      }
    } catch(e) {}
    return '';
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : '';
  }
  window.getCookie = getCookie;

  function getNavParams() {
    var shop = (window.__MARGINGUARD__ && window.__MARGINGUARD__.shop) ||
               getCookie('mg_shop') ||
               new URLSearchParams(window.location.search).get('shop') || '';
    var host = new URLSearchParams(window.location.search).get('host') ||
               getCookie('mg_host') ||
               (window.__MARGINGUARD__ && window.__MARGINGUARD__.host) || '';
    return { shop: shop, host: host };
  }

  async function navigateTo(path) {
    var p = getNavParams();
    if (!p.shop) {
      p.shop = await getShopFromBridge();
    }
    var base = path.split('?')[0];
    window.location.href = p.shop
      ? base + '?shop=' + p.shop + '&host=' + p.host
      : base;
  }

  // Expose for use by inline scripts (e.g. clickable table rows)
  window.__appNavigate = navigateTo;

  async function initNavPlanBadge() {
    var el = document.getElementById('nav-plan-badge');
    if (!el) return;
    try {
      var shop = getNavParams().shop;
      var headers = {};
      try { headers['Authorization'] = 'Bearer ' + await withTimeout(window.shopify && window.shopify.idToken ? window.shopify.idToken() : Promise.reject(), 2000); } catch(e) {}
      var res = await fetch('/api/billing/status?shop=' + shop, { headers });
      if (!res.ok) { el.className = 'nav-plan-badge free'; el.textContent = 'Free'; return; }
      var data = await res.json();
      if (data.plan === 'Pro') {
        el.className = 'nav-plan-badge pro';
        el.textContent = 'Pro';
      } else {
        el.className = 'nav-plan-badge free';
        el.textContent = 'Free';
      }
    } catch(e) {
      el.className = 'nav-plan-badge free';
      el.textContent = 'Free';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var currentPath = window.location.pathname;

    initNavPlanBadge();

    // Nav active state (data-href matching)
    document.querySelectorAll('.nav-link[data-href]').forEach(function (link) {
      var href = link.getAttribute('data-href');
      var isActive = href === '/app'
        ? currentPath === '/app' || currentPath === '/app/'
        : currentPath.startsWith(href);
      if (isActive) link.classList.add('active');
    });

    // Nav click handler
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        navigateTo(link.getAttribute('data-href') || link.getAttribute('href'));
      });
    });

    // General interceptor: all /app/* anchor clicks not handled by nav-link
    document.addEventListener('click', function (e) {
      var el = e.target.closest('a[href]');
      if (!el || el.classList.contains('nav-link')) return;
      var href = el.getAttribute('href');
      if (!href || !href.startsWith('/app')) return;
      e.preventDefault();
      navigateTo(href);
    });
  });
})();
