const express = require('express');
const router = express.Router();
const { query } = require('../lib/db');

// Middleware: ensure shop is embedded & authenticated
router.use((req, res, next) => {
  const shop = req.query.shop || req.session?.shop;
  if (!shop) {
    return res.redirect(`/auth?shop=${req.query.shop || ''}&host=${req.query.host || ''}`);
  }
  req.embeddedShop = shop;
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
  console.log('[App] / host param:', req.query.host);
  renderWithShop(res, 'dashboard', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Dashboard' });
});

router.get('/orders', (req, res) => {
  renderWithShop(res, 'orders', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Orders' });
});

router.get('/orders/:id', (req, res) => {
  renderWithShop(res, 'order-detail', { shop: req.embeddedShop, host: req.query.host || '', orderId: req.params.id, pageTitle: 'Order Detail' });
});

router.get('/products', (req, res) => {
  renderWithShop(res, 'products', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Product Costs' });
});

router.get('/costs', (req, res) => {
  renderWithShop(res, 'costs', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Cost Rules' });
});

router.get('/settings', (req, res) => {
  renderWithShop(res, 'settings', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Settings' });
});

router.get('/billing', (req, res) => {
  renderWithShop(res, 'billing', { shop: req.embeddedShop, host: req.query.host || '', pageTitle: 'Billing' });
});

module.exports = router;
