const express = require('express');
const router = express.Router();
const { requireSessionToken } = require('../lib/auth');
const { query } = require('../lib/db');
const { createSubscription, confirmSubscription, cancelSubscription } = require('../lib/billing');

router.post('/subscribe', requireSessionToken, async (req, res) => {
  try {
    const { rows } = await query('SELECT access_token FROM shops WHERE shop=$1', [req.shop]);
    if (!rows[0]?.access_token) return res.status(400).json({ error: 'Shop not found' });

    const confirmationUrl = await createSubscription(req.shop, rows[0].access_token);
    res.json({ confirmation_url: confirmationUrl });
  } catch (err) {
    console.error('[Billing] Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

router.get('/confirm', async (req, res) => {
  const { charge_id, shop } = req.query;
  if (!shop || !charge_id) {
    return res.status(400).send('Missing parameters');
  }

  try {
    const { rows } = await query('SELECT access_token, billing_subscription_id FROM shops WHERE shop=$1', [shop]);
    if (!rows[0]?.access_token) return res.status(400).send('Shop not found');
    if (!rows[0].billing_subscription_id?.endsWith(`/${charge_id}`)) {
      return res.status(400).send('Invalid charge');
    }

    const result = await confirmSubscription(shop, rows[0].access_token, charge_id);
    if (result.success) {
      res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=success`);
    } else {
      res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=declined`);
    }
  } catch (err) {
    console.error('[Billing] Callback error:', err.message);
    res.status(500).send('Billing confirmation failed');
  }
});

router.post('/cancel', requireSessionToken, async (req, res) => {
  try {
    const { rows } = await query('SELECT access_token FROM shops WHERE shop=$1', [req.shop]);
    if (!rows[0]?.access_token) return res.status(400).json({ error: 'Shop not found' });

    await cancelSubscription(req.shop, rows[0].access_token);
    res.json({ success: true });
  } catch (err) {
    console.error('[Billing] Cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

module.exports = router;
