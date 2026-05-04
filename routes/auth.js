const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { query } = require('../lib/db');
const { generateNonce, buildInstallUrl, verifyHmac } = require('../lib/auth');
const { registerWebhooks } = require('../lib/shopify-client');
const { syncProducts } = require('../lib/product-sync');
const { syncOrders } = require('../lib/order-sync');
const { seedDefaultRules } = require('../lib/cost-rules');

const nonces = new Map();

function isValidShop(shop) {
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

// Entry point — redirect to Shopify OAuth
router.get('/', (req, res) => {
  const shop = req.query.shop;
  if (!shop || !isValidShop(shop)) return res.status(400).send('Invalid shop parameter.');

  const nonce = generateNonce();
  nonces.set(nonce, { shop, ts: Date.now() });

  const installUrl = buildInstallUrl(shop, nonce);
  res.redirect(installUrl);
});

// OAuth callback
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  if (!shop || !code || !state || !hmac) {
    return res.status(400).send('Missing required parameters');
  }

  if (!isValidShop(shop)) {
    return res.status(400).send('Invalid shop parameter.');
  }

  // Verify nonce
  const nonceEntry = nonces.get(state);
  if (!nonceEntry || nonceEntry.shop !== shop) {
    return res.status(403).send('Invalid state parameter');
  }
  nonces.delete(state);

  // Verify HMAC
  if (!verifyHmac(req.query)) {
    return res.status(403).send('HMAC verification failed');
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    });
    const { access_token } = tokenRes.data;

    // Check if this is a new install or a reconnect
    const existing = await query(`SELECT shop FROM shops WHERE shop = $1`, [shop]);
    const isNewInstall = existing.rows.length === 0;

    // Store shop + token
    await query(
      `INSERT INTO shops (shop, access_token, installed_at, updated_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (shop) DO UPDATE SET access_token=$2, updated_at=now()`,
      [shop, access_token]
    );

    if (isNewInstall) {
      console.log(`[Auth] New install for ${shop} — running post-install tasks`);

      // Seed default margin settings
      await query(
        `INSERT INTO margin_settings (shop) VALUES ($1) ON CONFLICT (shop) DO NOTHING`,
        [shop]
      );

      // Seed default cost rules
      await seedDefaultRules(shop);

      // Register webhooks (non-blocking)
      registerWebhooks(shop, access_token).catch(err =>
        console.error(`[Auth] Webhook registration failed for ${shop}:`, err.message)
      );

      // Initial syncs (non-blocking)
      syncProducts(shop, access_token).catch(err =>
        console.error(`[Auth] Product sync failed for ${shop}:`, err.message)
      );
      setTimeout(() => {
        syncOrders(shop, access_token).catch(err =>
          console.error(`[Auth] Order sync failed for ${shop}:`, err.message)
        );
      }, 5000);
    } else {
      console.log(`[Auth] Reconnect for ${shop} — skipping post-install tasks`);

      // Still re-register webhooks in case they were lost (non-blocking)
      registerWebhooks(shop, access_token).catch(err =>
        console.error(`[Auth] Webhook registration failed for ${shop}:`, err.message)
      );
    }

    // Redirect into embedded app, preserving host for App Bridge
    const host = req.query.host || '';
    res.redirect(`/app?shop=${shop}&host=${host}`);
  } catch (err) {
    console.error(`[Auth] Callback error for ${shop}:`, err.message);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Shopify alt callback path
router.get('/shopify/callback', (req, res) => {
  res.redirect(`/auth/callback?${new URLSearchParams(req.query).toString()}`);
});

module.exports = router;
