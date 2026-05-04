const axios = require('axios');

function shopifyClient(shop, accessToken) {
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';
  const base = `https://${shop}/admin/api/${version}`;

  const client = axios.create({
    baseURL: base,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  client.interceptors.response.use(
    r => r,
    err => {
      const status = err.response?.status;
      const url = err.config?.url;
      if (status === 429) {
        console.warn(`[Shopify] 429 rate limit ${url}`);
      } else {
        console.error(`[Shopify] ${status} ${url}`, err.response?.data?.errors || err.message);
      }
      return Promise.reject(err);
    }
  );

  return client;
}

async function registerWebhooks(shop, accessToken) {
  const client = shopifyClient(shop, accessToken);
  const appUrl = process.env.APP_BASE_URL || process.env.SHOPIFY_APP_URL;

  const desired = [
    { topic: 'app/uninstalled', address: `${appUrl}/webhooks/app/uninstalled` },
    { topic: 'orders/create', address: `${appUrl}/webhooks/orders/create` },
    { topic: 'orders/updated', address: `${appUrl}/webhooks/orders/updated` },
    { topic: 'products/update', address: `${appUrl}/webhooks/products/update` },
    { topic: 'inventory_items/update', address: `${appUrl}/webhooks/inventory_items/update` },
  ];

  let existingAddressByTopic = {};
  try {
    const { data } = await client.get('/webhooks.json?limit=250');
    for (const wh of (data.webhooks || [])) {
      existingAddressByTopic[wh.topic] = wh.address;
    }
  } catch (err) {
    console.error(`[Webhooks] Failed to fetch existing webhooks for ${shop}:`, err.message);
  }

  for (const wh of desired) {
    if (existingAddressByTopic[wh.topic] === wh.address) {
      console.log(`[Webhooks] Already registered: ${wh.topic}`);
      continue;
    }
    try {
      await client.post('/webhooks.json', {
        webhook: { topic: wh.topic, address: wh.address, format: 'json' },
      });
      console.log(`[Webhooks] Registered: ${wh.topic}`);
    } catch (err) {
      console.error(`[Webhooks] Failed to register ${wh.topic}:`, err.message);
    }
  }
}

async function addOrderTag(shop, accessToken, orderId, tag) {
  const client = shopifyClient(shop, accessToken);
  const { data } = await client.get(`/orders/${orderId}.json?fields=id,tags`);
  const existingTags = data.order.tags ? data.order.tags.split(', ').map(t => t.trim()) : [];
  if (existingTags.includes(tag)) return;
  const newTags = [...existingTags, tag].join(', ');
  await client.put(`/orders/${orderId}.json`, { order: { id: orderId, tags: newTags } });
}

module.exports = { shopifyClient, registerWebhooks, addOrderTag };
