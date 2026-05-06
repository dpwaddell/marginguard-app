const { query } = require('./db');
const { graphqlRequest } = require('./shopify-client');
const { calculateOrderMargin } = require('./margin-engine');
const { getActiveRules } = require('./cost-rules');
const { processAlerts } = require('./alerts');

const SYNC_ORDERS_QUERY = `
  query SyncOrders($cursor: String, $queryFilter: String) {
    orders(first: 50, after: $cursor, query: $queryFilter) {
      edges {
        node {
          id
          name
          processedAt
          totalPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount } }
          lineItems(first: 50) {
            edges {
              node {
                id
                name
                sku
                quantity
                originalTotalSet { shopMoney { amount } }
                discountAllocations { allocatedAmountSet { shopMoney { amount } } }
                variant { id }
                product { id }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function gidToId(gid) {
  if (!gid) return '';
  return String(gid).split('/').pop();
}

function normalizeOrder(node) {
  return {
    id: gidToId(node.id),
    name: node.name,
    processed_at: node.processedAt,
    currency: node.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    total_discounts: node.totalDiscountsSet?.shopMoney?.amount || '0',
    line_items: (node.lineItems?.edges || []).map(({ node: li }) => {
      const qty = li.quantity || 1;
      const lineTotal = parseFloat(li.originalTotalSet?.shopMoney?.amount || 0);
      return {
        id: gidToId(li.id),
        product_id: gidToId(li.product?.id),
        variant_id: gidToId(li.variant?.id),
        title: li.name || '',
        sku: li.sku || '',
        quantity: qty,
        price: qty > 0 ? lineTotal / qty : 0,
        discount_allocations: (li.discountAllocations || []).map(a => ({
          amount: a.allocatedAmountSet?.shopMoney?.amount || '0',
        })),
      };
    }),
  };
}

async function syncOrders(shop, accessToken) {
  console.log(`[OrderSync] Starting for ${shop}`);

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const queryFilter = `processed_at:>=${since}`;

  const { rows: settingsRows } = await query('SELECT * FROM margin_settings WHERE shop=$1', [shop]);
  const settings = settingsRows[0] || {};
  const costRules = await getActiveRules(shop);

  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const data = await graphqlRequest(shop, accessToken, SYNC_ORDERS_QUERY, {
      cursor,
      queryFilter,
    });

    const edges = data?.orders?.edges || [];
    for (const { node } of edges) {
      const order = normalizeOrder(node);
      await processOrder(shop, order, costRules, settings);
      processed++;
    }

    hasNextPage = data?.orders?.pageInfo?.hasNextPage || false;
    cursor = data?.orders?.pageInfo?.endCursor || null;
  }

  console.log(`[OrderSync] Complete for ${shop}: ${processed} orders processed`);
  return processed;
}

async function processOrder(shop, order, costRules, settings) {
  const variantIds = (order.line_items || []).map(l => String(l.variant_id)).filter(Boolean);

  let variantCosts = [];
  if (variantIds.length > 0) {
    const { rows } = await query(
      'SELECT * FROM variant_costs WHERE shop=$1 AND variant_id = ANY($2)',
      [shop, variantIds]
    );
    variantCosts = rows;
  }

  const result = calculateOrderMargin({ order, variantCosts, costRules, settings });
  const orderId = String(order.id);

  await query(
    `INSERT INTO order_margins
       (shop, order_id, order_name, processed_at, currency, gross_revenue, discount_total, net_revenue,
        cogs_total, other_costs_total, total_costs, net_profit, margin_percent,
        low_margin, missing_cogs, confidence_status, calculation_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
     ON CONFLICT (shop, order_id) DO UPDATE SET
       order_name=EXCLUDED.order_name,
       processed_at=EXCLUDED.processed_at,
       currency=EXCLUDED.currency,
       gross_revenue=EXCLUDED.gross_revenue,
       discount_total=EXCLUDED.discount_total,
       net_revenue=EXCLUDED.net_revenue,
       cogs_total=EXCLUDED.cogs_total,
       other_costs_total=EXCLUDED.other_costs_total,
       total_costs=EXCLUDED.total_costs,
       net_profit=EXCLUDED.net_profit,
       margin_percent=EXCLUDED.margin_percent,
       low_margin=EXCLUDED.low_margin,
       missing_cogs=EXCLUDED.missing_cogs,
       confidence_status=EXCLUDED.confidence_status,
       calculation_json=EXCLUDED.calculation_json,
       updated_at=now()`,
    [shop, orderId, order.name, order.processed_at, order.currency,
     result.gross_revenue, result.discount_total, result.net_revenue,
     result.cogs_total, result.other_costs_total, result.total_costs,
     result.net_profit, result.margin_percent,
     result.low_margin, result.missing_cogs, result.confidence_status,
     JSON.stringify({ applied_cost_rules: result.applied_cost_rules, alert_recommendations: result.alert_recommendations })]
  );

  await query('DELETE FROM order_margin_lines WHERE shop=$1 AND order_id=$2', [shop, orderId]);
  for (const line of result.lines) {
    await query(
      `INSERT INTO order_margin_lines
         (shop, order_id, line_item_id, product_id, variant_id, sku, title, quantity,
          gross_line_revenue, discount_total, net_line_revenue, unit_cogs, cogs_total,
          custom_costs_total, net_profit, margin_percent, missing_cogs, calculation_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [shop, orderId, line.line_item_id, line.product_id, line.variant_id,
       line.sku, line.title, line.quantity,
       line.gross_line_revenue, line.discount_total, line.net_line_revenue,
       line.unit_cogs, line.cogs_total, line.custom_costs_total,
       line.net_profit, line.margin_percent, line.missing_cogs,
       JSON.stringify({ cogs_source: line.cogs_source, applied_rules: line.applied_rules })]
    );
  }

  if (result.alert_recommendations.length > 0) {
    await processAlerts(shop, order, result, settings);
  }
}

module.exports = { syncOrders, processOrder };
