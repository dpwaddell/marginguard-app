const axios = require('axios');
const { query } = require('./db');

async function exchangeForOfflineToken(shop, idToken) {
  const body = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });

  const tokenRes = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, expires_in } = tokenRes.data;
  const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

  await query(
    'UPDATE shops SET access_token=$1, token_expires_at=$2, updated_at=now() WHERE shop=$3',
    [access_token, expiresAt, shop]
  );

  console.log(`[Shopify] Token exchanged for ${shop}: ${access_token.slice(0, 10)}... expires=${expiresAt}`);

  try {
    await registerWebhooks(shop, access_token);
  } catch (err) {
    console.error(`[Shopify] Webhook registration failed after token exchange for ${shop}:`, err.message);
  }

  return access_token;
}

async function getValidToken(shop) {
  const { rows } = await query(
    'SELECT access_token, token_expires_at FROM shops WHERE shop=$1',
    [shop]
  );
  if (!rows.length || !rows[0].access_token) return null;
  const { access_token, token_expires_at } = rows[0];
  if (token_expires_at && new Date(token_expires_at) < new Date(Date.now() + 10 * 60 * 1000)) {
    return null;
  }
  return access_token;
}

async function graphqlRequest(shop, accessToken, gqlQuery, variables = {}) {
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';
  const url = `https://${shop}/admin/api/${version}/graphql.json`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.post(url, { query: gqlQuery, variables }, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      if (res.data.errors?.length) {
        throw new Error(`GraphQL errors: ${res.data.errors.map(e => e.message).join(', ')}`);
      }
      return res.data.data;
    } catch (err) {
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '2', 10);
        console.warn(`[Shopify] GraphQL 429 rate limit, waiting ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const WEBHOOK_TOPIC_MAP = {
  'app/uninstalled': 'APP_UNINSTALLED',
  'orders/create': 'ORDERS_CREATE',
  'orders/updated': 'ORDERS_UPDATED',
  'products/update': 'PRODUCTS_UPDATE',
  'inventory_items/update': 'INVENTORY_ITEMS_UPDATE',
};

const LIST_WEBHOOKS_QUERY = `
  query ListWebhooks {
    webhookSubscriptions(first: 100) {
      nodes { id topic uri }
    }
  }
`;

const CREATE_WEBHOOK_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_WEBHOOK_MUTATION = `
  mutation webhookSubscriptionUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

async function registerWebhooks(shop, accessToken) {
  const appUrl = process.env.APP_BASE_URL || process.env.SHOPIFY_APP_URL;
  const token = accessToken || await getValidToken(shop);
  if (!token) {
    console.error(`[Webhooks] No valid token for ${shop}, skipping webhook registration`);
    return;
  }

  const desired = [
    { topic: 'app/uninstalled', address: `${appUrl}/webhooks/app/uninstalled` },
    { topic: 'orders/create', address: `${appUrl}/webhooks/orders/create` },
    { topic: 'orders/updated', address: `${appUrl}/webhooks/orders/updated` },
    { topic: 'products/update', address: `${appUrl}/webhooks/products/update` },
    { topic: 'inventory_items/update', address: `${appUrl}/webhooks/inventory_items/update` },
  ];

  let existingByTopic = {};
  try {
    const data = await graphqlRequest(shop, token, LIST_WEBHOOKS_QUERY);
    for (const node of (data?.webhookSubscriptions?.nodes || [])) {
      existingByTopic[node.topic] = { id: node.id, uri: node.uri };
    }
  } catch (err) {
    console.error(`[Webhooks] Failed to fetch existing webhooks for ${shop}:`, err.message);
  }

  for (const wh of desired) {
    const gqlTopic = WEBHOOK_TOPIC_MAP[wh.topic];
    if (!gqlTopic) continue;

    const existing = existingByTopic[gqlTopic];
    if (existing?.uri === wh.address) {
      console.log(`[Webhooks] Already registered: ${wh.topic}`);
      continue;
    }

    try {
      if (existing) {
        const result = await graphqlRequest(shop, token, UPDATE_WEBHOOK_MUTATION, {
          id: existing.id,
          webhookSubscription: { callbackUrl: wh.address },
        });
        const errors = result?.webhookSubscriptionUpdate?.userErrors || [];
        if (errors.length) throw new Error(errors.map(e => e.message).join(', '));
        console.log(`[Webhooks] Updated: ${wh.topic}`);
      } else {
        const result = await graphqlRequest(shop, token, CREATE_WEBHOOK_MUTATION, {
          topic: gqlTopic,
          webhookSubscription: { callbackUrl: wh.address },
        });
        const errors = result?.webhookSubscriptionCreate?.userErrors || [];
        if (errors.length) throw new Error(errors.map(e => e.message).join(', '));
        console.log(`[Webhooks] Registered: ${wh.topic}`);
      }
    } catch (err) {
      console.error(`[Webhooks] Failed to register ${wh.topic}:`, err.message);
    }
  }
}

const GET_ORDER_TAGS_QUERY = `
  query GetOrderTags($id: ID!) {
    order(id: $id) { tags }
  }
`;

const ORDER_UPDATE_MUTATION = `
  mutation orderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id tags }
      userErrors { field message }
    }
  }
`;

async function addOrderTag(shop, accessToken, orderId, tag) {
  const gid = `gid://shopify/Order/${orderId}`;

  const tagData = await graphqlRequest(shop, accessToken, GET_ORDER_TAGS_QUERY, { id: gid });
  const existingTags = tagData?.order?.tags || [];
  if (existingTags.includes(tag)) return;

  const result = await graphqlRequest(shop, accessToken, ORDER_UPDATE_MUTATION, {
    input: { id: gid, tags: [...existingTags, tag] },
  });
  const errors = result?.orderUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => e.message).join(', '));
}

module.exports = { graphqlRequest, registerWebhooks, addOrderTag, getValidToken, exchangeForOfflineToken };
