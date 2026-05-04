const { query } = require('./db');
const { shopifyClient } = require('./shopify-client');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchInventoryCost(client, inventoryItemId, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await client.get(`/inventory_items/${inventoryItemId}.json`);
      return res.data?.inventory_item?.cost ?? null;
    } catch (err) {
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '2', 10);
        console.warn(`[ProductSync] 429 on inventory item ${inventoryItemId}, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
      } else {
        break;
      }
    }
  }
  return null;
}

async function syncProducts(shop, accessToken) {
  const client = shopifyClient(shop, accessToken);
  console.log(`[ProductSync] Starting for ${shop}`);

  let page = 1;
  let pageInfo = null;
  let hasMore = true;
  let synced = 0;

  while (hasMore) {
    let params = 'limit=250&fields=id,title,tags,variants';
    if (pageInfo) params = `limit=250&page_info=${pageInfo}&fields=id,title,tags,variants`;

    const { data, headers } = await client.get(`/products.json?${params}`);
    const products = data.products || [];
    if (products.length === 0) break;

    for (const product of products) {
      const productTags = (product.tags || '').split(',').map(t => t.trim()).filter(Boolean);

      for (const variant of (product.variants || [])) {
        let shopifyCost = null;

        if (variant.inventory_item_id) {
          await sleep(500);
          const cost = await fetchInventoryCost(client, variant.inventory_item_id);
          shopifyCost = cost ? parseFloat(cost) : null;
        }

        const missingCost = shopifyCost === null || shopifyCost === 0;

        await query(
          `INSERT INTO variant_costs
             (shop, product_id, variant_id, inventory_item_id, sku, product_title, variant_title,
              shopify_unit_cost, effective_unit_cost, source, missing_cost, product_tags, synced_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())
           ON CONFLICT (shop, variant_id) DO UPDATE SET
             product_id=EXCLUDED.product_id,
             inventory_item_id=EXCLUDED.inventory_item_id,
             sku=EXCLUDED.sku,
             product_title=EXCLUDED.product_title,
             variant_title=EXCLUDED.variant_title,
             shopify_unit_cost=EXCLUDED.shopify_unit_cost,
             effective_unit_cost=COALESCE(variant_costs.manual_unit_cost, EXCLUDED.shopify_unit_cost),
             source=CASE WHEN variant_costs.manual_unit_cost IS NOT NULL THEN 'manual' ELSE 'shopify' END,
             missing_cost=EXCLUDED.missing_cost,
             product_tags=EXCLUDED.product_tags,
             synced_at=now(),
             updated_at=now()`,
          [shop, String(product.id), String(variant.id), String(variant.inventory_item_id || ''),
           variant.sku || '', product.title || '', variant.title || '',
           shopifyCost, shopifyCost, missingCost ? 'shopify' : 'shopify', missingCost, productTags]
        );
        synced++;
      }
    }

    // Cursor-based pagination
    const linkHeader = headers['link'] || '';
    const nextMatch = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      pageInfo = nextMatch[1];
    } else {
      hasMore = false;
    }
    page++;
  }

  console.log(`[ProductSync] Complete for ${shop}: ${synced} variants synced`);
  return synced;
}

async function syncProductById(shop, accessToken, productId) {
  const client = shopifyClient(shop, accessToken);
  const { data } = await client.get(`/products/${productId}.json?fields=id,title,tags,variants`);
  const product = data.product;
  if (!product) return;

  const productTags = (product.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  for (const variant of (product.variants || [])) {
    let shopifyCost = null;
    if (variant.inventory_item_id) {
      await sleep(500);
      const cost = await fetchInventoryCost(client, variant.inventory_item_id);
      shopifyCost = cost ? parseFloat(cost) : null;
    }

    const missingCost = shopifyCost === null || shopifyCost === 0;

    await query(
      `INSERT INTO variant_costs
         (shop, product_id, variant_id, inventory_item_id, sku, product_title, variant_title,
          shopify_unit_cost, effective_unit_cost, source, missing_cost, product_tags, synced_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())
       ON CONFLICT (shop, variant_id) DO UPDATE SET
         shopify_unit_cost=EXCLUDED.shopify_unit_cost,
         effective_unit_cost=COALESCE(variant_costs.manual_unit_cost, EXCLUDED.shopify_unit_cost),
         source=CASE WHEN variant_costs.manual_unit_cost IS NOT NULL THEN 'manual' ELSE 'shopify' END,
         missing_cost=EXCLUDED.missing_cost,
         product_tags=EXCLUDED.product_tags,
         synced_at=now(),
         updated_at=now()`,
      [shop, String(product.id), String(variant.id), String(variant.inventory_item_id || ''),
       variant.sku || '', product.title || '', variant.title || '',
       shopifyCost, shopifyCost, 'shopify', missingCost, productTags]
    );
  }
}

module.exports = { syncProducts, syncProductById };
