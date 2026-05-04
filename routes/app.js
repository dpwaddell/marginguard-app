const express = require('express');
const router = express.Router();
const { query } = require('../lib/db');

// Middleware: ensure shop context is available
router.use((req, res, next) => {
  const shop = req.query.shop || req.cookies?.mg_shop;
  const host = req.query.host || req.cookies?.mg_host || '';

  if (!shop) {
    // No shop context yet — render layout so App Bridge can initialise from the meta tag
    const appUrl = process.env.APP_BASE_URL || '';
    let appOrigin = '';
    try { appOrigin = new URL(appUrl).origin; } catch {}
    res.setHeader('Content-Security-Policy', `frame-ancestors https://admin.shopify.com ${appOrigin};`);
    return res.render('dashboard', { apiKey: process.env.SHOPIFY_API_KEY, shop: '', host, appUrl, pageTitle: 'Dashboard' });
  }

  req.embeddedShop = shop;
  console.log('[App] embeddedShop:', req.embeddedShop);
  // Persist shop/host in cookies so subsequent requests without query params still work
  res.cookie('mg_shop', shop, { sameSite: 'None', secure: true, maxAge: 86400000 });
  if (host) res.cookie('mg_host', host, { sameSite: 'None', secure: true, maxAge: 86400000 });
  next();
});

function renderWithShop(res, view, extras = {}) {
  const shop = extras.shop || '';
  const appUrl = process.env.APP_BASE_URL || '';
  // Extract the host origin from APP_BASE_URL for CSP (e.g. https://marginguard.sample-guard.com)
  let appOrigin = '';
  try { appOrigin = new URL(appUrl).origin; } catch {}

  res.setHeader(
    'Content-Security-Policy',
    `frame-ancestors https://admin.shopify.com https://${shop} ${appOrigin};`
  );

  res.render(view, {
    apiKey: process.env.SHOPIFY_API_KEY,
    shop,
    appUrl,
    ...extras,
  });
}

router.get('/', (req, res) => {
  renderWithShop(res, 'dashboard', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Dashboard' });
});

router.get('/orders', (req, res) => {
  renderWithShop(res, 'orders', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Orders' });
});

router.get('/orders/:id', (req, res) => {
  renderWithShop(res, 'order-detail', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', orderId: req.params.id, pageTitle: 'Order Detail' });
});

router.get('/products', (req, res) => {
  renderWithShop(res, 'products', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Product Costs' });
});

router.get('/costs', (req, res) => {
  renderWithShop(res, 'costs', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Cost Rules' });
});

router.get('/settings', (req, res) => {
  renderWithShop(res, 'settings', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Settings' });
});

router.get('/billing', (req, res) => {
  renderWithShop(res, 'billing', { shop: req.embeddedShop, host: req.query.host || req.cookies?.mg_host || '', pageTitle: 'Billing' });
});

module.exports = router;
