const { query } = require('./db');
const { shopifyClient } = require('./shopify-client');

async function createSubscription(shop, accessToken) {
  const client = shopifyClient(shop, accessToken);
  const appUrl = process.env.APP_BASE_URL;
  const price = process.env.BILLING_PRO_PRICE || '29';
  const currency = process.env.BILLING_PRO_CURRENCY || 'GBP';
  const name = process.env.BILLING_PRO_NAME || 'MarginGuard Pro';

  const { data } = await client.post('/recurring_application_charges.json', {
    recurring_application_charge: {
      name,
      price,
      return_url: `${appUrl}/billing/callback`,
      test: process.env.NODE_ENV !== 'production',
    },
  });

  const charge = data.recurring_application_charge;
  await query('UPDATE shops SET billing_subscription_id=$1, updated_at=now() WHERE shop=$2',
    [String(charge.id), shop]);

  return charge.confirmation_url;
}

async function confirmSubscription(shop, accessToken, chargeId) {
  const client = shopifyClient(shop, accessToken);
  const { data } = await client.get(`/recurring_application_charges/${chargeId}.json`);
  const charge = data.recurring_application_charge;

  if (charge.status === 'active') {
    await query(
      `UPDATE shops SET plan_name='Pro', plan_status='active', billing_confirmed_at=now(), updated_at=now() WHERE shop=$1`,
      [shop]
    );
    return { success: true };
  }

  return { success: false, status: charge.status };
}

async function requiresPro(req, res, next) {
  const { rows } = await query('SELECT plan_name FROM shops WHERE shop=$1', [req.shop]);
  req.shopRecord = rows[0] || {};
  if (req.shopRecord.plan_name === 'Pro') return next();
  return res.status(403).json({ error: 'Pro plan required', upgrade: true, upgradeUrl: '/app/billing' });
}

module.exports = { createSubscription, confirmSubscription, requiresPro };
