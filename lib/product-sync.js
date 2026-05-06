const { query } = require('./db');
const { graphqlRequest } = require('./shopify-client');

const SYNC_PRODUCTS_QUERY = `
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          tags
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                inventoryItem {
                  id
                  unitCost { amount }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const SYNC_PRODUCT_BY_ID_QUERY = `
  query SyncProductById($id: ID!) {
    product(id: $id) {
      id
      title
      tags
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            inventoryItem {
              id
              unitCost { amount }
            }
          }
        }
      }
    }
  }
`;

function gidToId(gid) {
  if (!gid) return '';
  return String(gid).split('/').pop();
}

async function upsertVariant(shop, product, variantNode) {
  const productId = gidToId(product.id);
  const variantId = gidToId(variantNode.id);
  const inventoryItemId = gidToId(variantNode.inventoryItem?.id);
  const shopifyCost = variantNode.inventoryItem?.unitCost?.amount != null
    ? parseFloat(variantNode.inventoryItem.unitCost.amount)
    : null;
  const missingCost = shopifyCost === null || shopifyCost === 0;
  const productTags = (product.tags || []);

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
    [shop, productId, variantId, inventoryItemId,
     variantNode.sku || '', product.title || '', variantNode.title || '',
     shopifyCost, shopifyCost, 'shopify', missingCost, productTags]
  );
}

async function syncProducts(shop, accessToken) {
  console.log(`[ProductSync] Starting for ${shop}`);

  let cursor = null;
  let hasNextPage = true;
  let synced = 0;

  while (hasNextPage) {
    const data = await graphqlRequest(shop, accessToken, SYNC_PRODUCTS_QUERY, { cursor });
    const edges = data?.products?.edges || [];

    for (const { node: product } of edges) {
      const tags = (product.tags || []);
      const productWithTags = { ...product, tags };
      for (const { node: variant } of (product.variants?.edges || [])) {
        await upsertVariant(shop, productWithTags, variant);
        synced++;
      }
    }

    hasNextPage = data?.products?.pageInfo?.hasNextPage || false;
    cursor = data?.products?.pageInfo?.endCursor || null;
  }

  console.log(`[ProductSync] Complete for ${shop}: ${synced} variants synced`);
  return synced;
}

async function syncProductById(shop, accessToken, productId) {
  const gid = `gid://shopify/Product/${productId}`;
  const data = await graphqlRequest(shop, accessToken, SYNC_PRODUCT_BY_ID_QUERY, { id: gid });
  const product = data?.product;
  if (!product) return;

  const tags = (product.tags || []);
  const productWithTags = { ...product, tags };
  for (const { node: variant } of (product.variants?.edges || [])) {
    await upsertVariant(shop, productWithTags, variant);
  }
}

module.exports = { syncProducts, syncProductById };
