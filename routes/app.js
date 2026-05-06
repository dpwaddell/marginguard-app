const express = require('express');
const router = express.Router();
const { requireSessionToken } = require('../lib/auth');

function renderWithShop(res, view, extras = {}) {
  const shop = extras.shop || '';
  const appUrl = process.env.APP_BASE_URL || '';
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

router.get('/', requireSessionToken, (req, res) => {
  renderWithShop(res, 'dashboard', { shop: req.shop, host: req.query.host || '', pageTitle: 'Dashboard' });
});

router.get('/orders', requireSessionToken, (req, res) => {
  renderWithShop(res, 'orders', { shop: req.shop, host: req.query.host || '', pageTitle: 'Orders' });
});

router.get('/orders/:id', requireSessionToken, (req, res) => {
  renderWithShop(res, 'order-detail', { shop: req.shop, host: req.query.host || '', orderId: req.params.id, pageTitle: 'Order Detail' });
});

router.get('/products', requireSessionToken, (req, res) => {
  renderWithShop(res, 'products', { shop: req.shop, host: req.query.host || '', pageTitle: 'Product Costs' });
});

router.get('/costs', requireSessionToken, (req, res) => {
  renderWithShop(res, 'costs', { shop: req.shop, host: req.query.host || '', pageTitle: 'Cost Rules' });
});

router.get('/settings', requireSessionToken, (req, res) => {
  renderWithShop(res, 'settings', { shop: req.shop, host: req.query.host || '', pageTitle: 'Settings' });
});

router.get('/billing', requireSessionToken, (req, res) => {
  renderWithShop(res, 'billing', { shop: req.shop, host: req.query.host || '', pageTitle: 'Billing' });
});

module.exports = router;
