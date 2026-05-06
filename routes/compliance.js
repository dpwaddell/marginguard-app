const express = require('express');
const router = express.Router();
const { verifyWebhookHmac } = require('../lib/auth');
const { query } = require('../lib/db');

function verifyCompliance(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) return res.status(401).send('Missing HMAC');

  if (!verifyWebhookHmac(req.body, hmacHeader)) {
    console.warn('[Compliance] HMAC verification failed');
    return res.status(401).send('HMAC verification failed');
  }

  try {
    req.webhookBody = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  req.shop = req.headers['x-shopify-shop-domain'];
  next();
}

// We store no personal customer data beyond transactional order margins
router.post('/customers/data_request', verifyCompliance, (req, res) => {
  const { customer } = req.webhookBody;
  console.log(`[Compliance] customers/data_request shop=${req.shop} customer=${customer?.id}`);
  res.sendStatus(200);
});

router.post('/customers/redact', verifyCompliance, async (req, res) => {
  const shop = req.shop;
  const { customer, orders_to_redact } = req.webhookBody;
  console.log(`[Compliance] customers/redact shop=${shop} customer=${customer?.id} orders=${orders_to_redact?.length ?? 0}`);
  try {
    if (orders_to_redact?.length) {
      const ids = orders_to_redact.map(String);
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
      await query(`DELETE FROM order_margin_lines WHERE shop=$1 AND order_id IN (${placeholders})`, [shop, ...ids]);
      await query(`DELETE FROM order_margins WHERE shop=$1 AND order_id IN (${placeholders})`, [shop, ...ids]);
    }
  } catch (err) {
    console.error(`[Compliance] customers/redact error for ${shop}:`, err.message);
  }
  res.sendStatus(200);
});

router.post('/shop/redact', verifyCompliance, async (req, res) => {
  const shop = req.shop;
  console.log(`[Compliance] shop/redact shop=${shop}`);
  try {
    await query('DELETE FROM order_margin_lines WHERE shop=$1', [shop]);
    await query('DELETE FROM order_margins WHERE shop=$1', [shop]);
    await query('DELETE FROM variant_costs WHERE shop=$1', [shop]);
    await query('DELETE FROM cost_rules WHERE shop=$1', [shop]);
    await query('DELETE FROM margin_settings WHERE shop=$1', [shop]);
    await query('DELETE FROM shops WHERE shop=$1', [shop]);
    console.log(`[Compliance] shop/redact complete for ${shop}`);
  } catch (err) {
    console.error(`[Compliance] shop/redact error for ${shop}:`, err.message);
  }
  res.sendStatus(200);
});

module.exports = router;
