const express = require('express');
const router = express.Router();
const { verifyWebhookHmac } = require('../lib/auth');
const { query } = require('../lib/db');
const { syncProductById } = require('../lib/product-sync');
const { processOrder } = require('../lib/order-sync');
const { getActiveRules } = require('../lib/cost-rules');

// All webhook routes use express.raw() — mounted in server.js with raw body parser

function verifyWebhook(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) return res.status(401).send('Missing HMAC');

  const rawBody = req.body;
  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    console.warn('[Webhook] HMAC verification failed');
    return res.status(401).send('HMAC verification failed');
  }

  try {
    req.webhookBody = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  req.shop = req.headers['x-shopify-shop-domain'];
  next();
}

router.post('/app/uninstalled', verifyWebhook, async (req, res) => {
  const shop = req.shop;
  console.log(`[Webhook] app/uninstalled for ${shop}`);
  try {
    await query('DELETE FROM shops WHERE shop=$1', [shop]);
    // Keep margin data for analytics — shops can reinstall
  } catch (err) {
    console.error(`[Webhook] Uninstall cleanup failed for ${shop}:`, err.message);
  }
  res.sendStatus(200);
});

router.post('/orders/create', verifyWebhook, async (req, res) => {
  const shop = req.shop;
  const order = req.webhookBody;
  try {
    const { rows: settingsRows } = await query('SELECT * FROM margin_settings WHERE shop=$1', [shop]);
    const settings = settingsRows[0] || {};
    const costRules = await getActiveRules(shop);
    await processOrder(shop, order, costRules, settings);
  } catch (err) {
    console.error(`[Webhook] orders/create failed for ${shop} order ${order?.id}:`, err.message);
  }
  res.sendStatus(200);
});

router.post('/orders/updated', verifyWebhook, async (req, res) => {
  const shop = req.shop;
  const order = req.webhookBody;
  try {
    const { rows: settingsRows } = await query('SELECT * FROM margin_settings WHERE shop=$1', [shop]);
    const settings = settingsRows[0] || {};
    const costRules = await getActiveRules(shop);
    await processOrder(shop, order, costRules, settings);
  } catch (err) {
    console.error(`[Webhook] orders/updated failed for ${shop} order ${order?.id}:`, err.message);
  }
  res.sendStatus(200);
});

router.post('/products/update', verifyWebhook, async (req, res) => {
  const shop = req.shop;
  const product = req.webhookBody;
  try {
    const { rows: shopRows } = await query('SELECT access_token FROM shops WHERE shop=$1', [shop]);
    if (shopRows[0]?.access_token) {
      await syncProductById(shop, shopRows[0].access_token, product.id);
    }
  } catch (err) {
    console.error(`[Webhook] products/update failed for ${shop}:`, err.message);
  }
  res.sendStatus(200);
});

router.post('/inventory_items/update', verifyWebhook, async (req, res) => {
  const shop = req.shop;
  const item = req.webhookBody;
  try {
    const cost = item.cost;
    if (cost !== undefined) {
      await query(
        `UPDATE variant_costs SET shopify_unit_cost=$1,
           effective_unit_cost=COALESCE(manual_unit_cost,$1),
           missing_cost=($1 IS NULL OR $1=0),
           updated_at=now()
         WHERE shop=$2 AND inventory_item_id=$3`,
        [cost ? parseFloat(cost) : null, shop, String(item.id)]
      );
    }
  } catch (err) {
    console.error(`[Webhook] inventory_items/update failed for ${shop}:`, err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
