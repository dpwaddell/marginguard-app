const { query } = require('./db');
const { graphqlRequest } = require('./shopify-client');

async function createSubscription(shop, accessToken) {
  const appUrl = process.env.APP_BASE_URL;
  const price = process.env.BILLING_PRO_PRICE || '49';
  const currency = process.env.BILLING_PRO_CURRENCY || 'USD';
  const name = process.env.BILLING_PRO_NAME || 'MarginGuard Pro';

  const mutation = `
    mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, trialDays: $trialDays, test: $test, lineItems: $lineItems) {
        appSubscription {
          id
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    name,
    returnUrl: `${appUrl}/billing/confirm`,
    trialDays: 14,
    test: process.env.NODE_ENV !== 'production',
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: price, currencyCode: currency },
          },
        },
      },
    ],
  };

  const data = await graphqlRequest(shop, accessToken, mutation, variables);
  const { appSubscription, confirmationUrl, userErrors } = data.appSubscriptionCreate;

  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }
  if (!appSubscription) throw new Error('No subscription returned from Shopify');

  await query('UPDATE shops SET billing_subscription_id=$1, updated_at=now() WHERE shop=$2',
    [appSubscription.id, shop]);

  return confirmationUrl;
}

async function confirmSubscription(shop, accessToken, chargeId) {
  const gid = `gid://shopify/AppSubscription/${chargeId}`;

  const gqlQuery = `
    query getSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          status
        }
      }
    }
  `;

  const data = await graphqlRequest(shop, accessToken, gqlQuery, { id: gid });
  const charge = data.node;

  if (!charge) return { success: false, status: 'not_found' };

  if (charge.status === 'ACTIVE') {
    await query(
      `UPDATE shops SET plan_name='Pro', plan_status='active', billing_confirmed_at=now(), updated_at=now() WHERE shop=$1`,
      [shop]
    );
    return { success: true };
  }

  if (charge.status === 'DECLINED') {
    return { success: false, status: 'declined' };
  }

  if (charge.status === 'PENDING') {
    return { success: false, status: 'pending' };
  }

  return { success: false, status: charge.status.toLowerCase() };
}

async function requiresPro(req, res, next) {
  try {
    const { rows } = await query('SELECT plan_name FROM shops WHERE shop=$1', [req.shop]);
    req.shopRecord = rows[0] || {};
    if (req.shopRecord.plan_name === 'Pro') return next();
    return res.status(403).json({ error: 'Pro plan required', upgrade: true, upgradeUrl: '/app/billing' });
  } catch (err) {
    next(err);
  }
}

async function cancelSubscription(shop, accessToken) {
  const { rows } = await query('SELECT billing_subscription_id FROM shops WHERE shop=$1', [shop]);
  const subscriptionId = rows[0]?.billing_subscription_id;
  if (!subscriptionId) throw new Error('No active subscription found');

  const mutation = `
    mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription { id status }
        userErrors { field message }
      }
    }
  `;

  const data = await graphqlRequest(shop, accessToken, mutation, { id: subscriptionId });
  const { userErrors } = data.appSubscriptionCancel;

  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }

  await query(
    `UPDATE shops SET plan_name='Free', plan_status='cancelled', billing_subscription_id=NULL, updated_at=now() WHERE shop=$1`,
    [shop]
  );
}

module.exports = { createSubscription, confirmSubscription, requiresPro, cancelSubscription };
