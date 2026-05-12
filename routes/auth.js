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
  if (!shop) return res.redirect('https://admin.shopify.com');
  if (!isValidShop(shop)) return res.status(400).send('Invalid shop parameter.');

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

    // Offline tokens start with shpat_. An online/per-user token (shpua_) means the
    // Shopify Partner Dashboard app is configured for online access mode.
    // Log a warning but continue — redirecting back to OAuth would cause an infinite loop
    // because Shopify will keep issuing shpua_ tokens until the Partner Dashboard is fixed.
    //
    // NOTE: We cannot call exchangeForOfflineToken here because that function expects an
    // App Bridge id_token (JWT), not an OAuth access token. Token Exchange via
    // subject_token_type=id_token only accepts App Bridge session tokens, which are only
    // available once the merchant loads the embedded app page. The proactiveTokenExchange()
    // call in requireSessionToken() handles the exchange on first page load instead.
    if (access_token.startsWith('shpua_')) {
      console.warn(`[Auth] Got online token (shpua_) for ${shop} — app may be configured for per-user access in Partner Dashboard. Continuing anyway.`);
    }

    const merchant = await fetchMerchantContact(shop, access_token);

    // Check if this is a new install or a reconnect
    const existing = await query(`SELECT shop FROM shops WHERE shop = $1`, [shop]);
    const isNewInstall = existing.rows.length === 0;

    // Store shop + token
    await query(
      `INSERT INTO shops (
         shop,
         access_token,
         merchant_email,
         merchant_contact_email,
         shop_owner_name,
         merchant_details_captured_at,
         installed_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN now() ELSE NULL END,
         now(),
         now()
       )
       ON CONFLICT (shop) DO UPDATE SET
         access_token=$2,
         merchant_email = COALESCE(EXCLUDED.merchant_email, shops.merchant_email),
         merchant_contact_email = COALESCE(EXCLUDED.merchant_contact_email, shops.merchant_contact_email),
         shop_owner_name = COALESCE(EXCLUDED.shop_owner_name, shops.shop_owner_name),
         merchant_details_captured_at = COALESCE(EXCLUDED.merchant_details_captured_at, shops.merchant_details_captured_at),
         updated_at=now()`,
      [
        shop,
        access_token,
        merchant.merchantEmail || null,
        merchant.merchantContactEmail || null,
        merchant.shopOwnerName || null
      ]
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

// Manual re-auth escape hatch: clears the stored token and restarts the OAuth flow.
// Useful when the stored token has expired or been revoked.
router.get('/reauth', async (req, res) => {
  const shop = req.query.shop || req.cookies?.mg_shop;
  if (!shop || !isValidShop(shop)) return res.redirect('https://admin.shopify.com');
  try {
    await query(`UPDATE shops SET access_token = NULL, updated_at = now() WHERE shop = $1`, [shop]);
    console.log(`[Auth] /reauth for ${shop} — token cleared, restarting OAuth`);
  } catch (err) {
    console.error(`[Auth] /reauth DB error for ${shop}:`, err.message);
  }
  const nonce = generateNonce();
  nonces.set(nonce, { shop, ts: Date.now() });
  res.redirect(buildInstallUrl(shop, nonce));
});

module.exports = router;
