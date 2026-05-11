const express = require('express');
const router = express.Router();
const { requireSessionToken } = require('../lib/auth');
const { requiresPro } = require('../lib/billing');
const { query } = require('../lib/db');
const { getAllRules, createRule, updateRule, deleteRule } = require('../lib/cost-rules');
const { syncProducts } = require('../lib/product-sync');
const { syncOrders, recalculateShopMargins } = require('../lib/order-sync');
const { getValidToken } = require('../lib/shopify-client');

// Auth + shop record for authenticated routes
const attachShopRecord = async (req, res, next) => {
  const { rows } = await query('SELECT * FROM shops WHERE shop=$1', [req.shop]);
  req.shopRecord = rows[0] || {};
  next();
};
const auth = [requireSessionToken, attachShopRecord];

// --- Dashboard ---
router.get('/dashboard', auth, async (req, res) => {
  try {
    const range = req.query.range || '7d';
    const days = parseDays(range);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const shop = req.shop;

    const prevSince = new Date(Date.now() - 2 * days * 86400000).toISOString();
    const [summary, prevSummary, lowMarginOrders, missingCogs, topOrders, currencyResult] = await Promise.all([
      query(
        `SELECT
           COUNT(*) as order_count,
           COALESCE(SUM(gross_revenue),0) as total_revenue,
           COALESCE(SUM(discount_total),0) as total_discounts,
           COALESCE(SUM(total_costs),0) as total_costs,
           COALESCE(SUM(net_profit),0) as total_profit,
           AVG(NULLIF(margin_percent,0)) as avg_margin
         FROM order_margins WHERE shop=$1 AND processed_at >= $2`,
        [shop, since]
      ),
      query(
        `SELECT
           COALESCE(SUM(gross_revenue),0) as total_revenue,
           COALESCE(SUM(discount_total),0) as total_discounts,
           COALESCE(SUM(total_costs),0) as total_costs,
           COALESCE(SUM(net_profit),0) as total_profit,
           AVG(NULLIF(margin_percent,0)) as avg_margin
         FROM order_margins WHERE shop=$1 AND processed_at >= $2 AND processed_at < $3`,
        [shop, prevSince, since]
      ),
      query(
        'SELECT COUNT(*) as count FROM order_margins WHERE shop=$1 AND processed_at>=$2 AND low_margin=true',
        [shop, since]
      ),
      query(
        'SELECT COUNT(*) as count FROM order_margins WHERE shop=$1 AND processed_at>=$2 AND missing_cogs=true',
        [shop, since]
      ),
      query(
        `SELECT order_id, order_name, net_profit, margin_percent, net_revenue, low_margin, confidence_status, processed_at
         FROM order_margins WHERE shop=$1 AND processed_at>=$2
         ORDER BY margin_percent ASC NULLS LAST LIMIT 5`,
        [shop, since]
      ),
      query('SELECT currency FROM margin_settings WHERE shop=$1', [shop]),
    ]);

    res.json({
      summary: summary.rows[0],
      prev_summary: prevSummary.rows[0],
      low_margin_count: parseInt(lowMarginOrders.rows[0].count),
      missing_cogs_count: parseInt(missingCogs.rows[0].count),
      top_low_margin_orders: topOrders.rows,
      currency: currencyResult.rows[0]?.currency || 'GBP',
    });
  } catch (err) {
    console.error('[API] /dashboard error:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// --- Dashboard: top products by revenue ---
router.get('/dashboard/products', auth, async (req, res) => {
  try {
    const range = req.query.range || '7d';
    const days = parseDays(range);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { rows } = await query(
      `SELECT oml.title as product_title,
              oml.sku as variant_title,
              COALESCE(SUM(oml.gross_line_revenue),0) as total_revenue,
              AVG(oml.margin_percent) as avg_margin,
              COUNT(DISTINCT oml.order_id) as order_count,
              COALESCE(SUM(oml.net_profit),0) as total_profit,
              BOOL_OR(oml.missing_cogs) as has_missing_cogs
       FROM order_margin_lines oml
       JOIN order_margins om ON om.order_id = oml.order_id AND om.shop = oml.shop
       WHERE oml.shop=$1 AND om.processed_at >= $2
       GROUP BY oml.title, oml.sku
       ORDER BY total_revenue DESC
       LIMIT 10`,
      [req.shop, since]
    );

    res.json({ products: rows });
  } catch (err) {
    console.error('[API] /dashboard/products error:', err.message);
    res.status(500).json({ error: 'Failed to load product data' });
  }
});

// --- Orders ---
const ORDER_SORT = {
  margin_asc:    'margin_percent ASC NULLS LAST',
  profit_asc:    'net_profit ASC',
  profit_desc:   'net_profit DESC',
  revenue_desc:  'gross_revenue DESC',
  discount_desc: 'discount_total DESC',
  recent:        'processed_at DESC',
};

router.get('/orders', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const days = parseDays(range);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const page = Math.max(1, parseInt(req.query.page || 1));
    const isPro = req.shopRecord.plan_name === 'Pro';
    const limit = 25;
    const maxRows = isPro ? null : 50;
    const offset = (page - 1) * limit;
    const sortKey = req.query.sort || 'margin_asc';
    const orderClause = ORDER_SORT[sortKey] || ORDER_SORT.margin_asc;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT order_id, order_name, processed_at, currency, gross_revenue, discount_total,
                net_revenue, net_profit, margin_percent, low_margin, confidence_status, missing_cogs
         FROM order_margins WHERE shop=$1 AND processed_at>=$2
         ORDER BY ${orderClause} LIMIT $3 OFFSET $4`,
        [req.shop, since, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM order_margins WHERE shop=$1 AND processed_at>=$2${maxRows ? ` LIMIT ${maxRows}` : ''}`,
        [req.shop, since]
      ),
    ]);

    const total = Math.min(parseInt(countRows[0].count), maxRows || Infinity);
    res.json({ orders: rows, page, limit, total, is_pro: isPro });
  } catch (err) {
    console.error('[API] /orders error:', err.message);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

router.get('/orders/:id', auth, async (req, res) => {
  try {
    const { rows: orderRows } = await query(
      'SELECT * FROM order_margins WHERE shop=$1 AND order_id=$2',
      [req.shop, req.params.id]
    );
    if (!orderRows[0]) return res.status(404).json({ error: 'Order not found' });

    const { rows: lineRows } = await query(
      'SELECT * FROM order_margin_lines WHERE shop=$1 AND order_id=$2 ORDER BY id',
      [req.shop, req.params.id]
    );

    res.json({ order: orderRows[0], lines: lineRows });
  } catch (err) {
    console.error('[API] /orders/:id error:', err.message);
    res.status(500).json({ error: 'Failed to load order' });
  }
});

// --- Products ---
router.get('/products', auth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM variant_costs WHERE shop=$1 ORDER BY missing_cost DESC, product_title, variant_title`,
      [req.shop]
    );
    res.json({ products: rows });
  } catch (err) {
    console.error('[API] /products error:', err.message);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

router.post('/products/:variantId/cost-override', auth, async (req, res) => {
  try {
    const { manual_unit_cost } = req.body;
    const variantId = req.params.variantId;
    const cost = manual_unit_cost !== '' && manual_unit_cost != null ? parseFloat(manual_unit_cost) : null;

    const { rows } = await query(
      `UPDATE variant_costs SET
         manual_unit_cost=$1,
         effective_unit_cost=COALESCE($1, shopify_unit_cost),
         source=CASE WHEN $1 IS NOT NULL THEN 'manual' ELSE 'shopify' END,
         missing_cost=(COALESCE($1, shopify_unit_cost) IS NULL OR COALESCE($1, shopify_unit_cost)=0),
         updated_at=now()
       WHERE shop=$2 AND variant_id=$3 RETURNING *`,
      [cost, req.shop, variantId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Variant not found' });
    res.json({ variant: rows[0] });
    getValidToken(req.shop).then(token => {
      if (token) recalculateShopMargins(req.shop, token).catch(err =>
        console.error(`[API] Recalculate after cost-override error for ${req.shop}:`, err.message)
      );
    }).catch(() => {});
  } catch (err) {
    console.error('[API] /products cost-override error:', err.message);
    res.status(500).json({ error: 'Failed to update cost' });
  }
});

// --- Cost rules ---
router.get('/cost-rules', auth, async (req, res) => {
  try {
    const rules = await getAllRules(req.shop);
    const isPro = req.shopRecord.plan_name === 'Pro';
    res.json({ rules, is_pro: isPro });
  } catch (err) {
    console.error('[API] /cost-rules GET error:', err.message);
    res.status(500).json({ error: 'Failed to load cost rules' });
  }
});

router.post('/cost-rules', auth, async (req, res) => {
  try {
    const isPro = req.shopRecord.plan_name === 'Pro';
    const existingCount = (await getAllRules(req.shop)).length;
    if (!isPro && existingCount >= 3) {
      console.log('[CostRules] Free plan limit hit for', req.shop, '- existing count:', existingCount);
      return res.status(403).json({ error: 'Free plan is limited to 3 cost rules. Upgrade to Pro for unlimited rules.', upgrade: true });
    }
    if (!isPro && req.body.applies_to === 'product_tag') {
      return res.status(403).json({ error: 'Product tag rules require Pro plan', upgrade: true });
    }
    const rule = await createRule(req.shop, req.body);
    res.status(201).json({ rule });
    getValidToken(req.shop).then(token => {
      if (token) recalculateShopMargins(req.shop, token).catch(err =>
        console.error(`[API] Recalculate after cost-rule create error for ${req.shop}:`, err.message)
      );
    }).catch(() => {});
  } catch (err) {
    console.error('[API] /cost-rules POST error:', err.message);
    res.status(500).json({ error: 'Failed to create cost rule' });
  }
});

router.put('/cost-rules/:id', auth, async (req, res) => {
  try {
    const rule = await updateRule(req.shop, req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
    getValidToken(req.shop).then(token => {
      if (token) recalculateShopMargins(req.shop, token).catch(err =>
        console.error(`[API] Recalculate after cost-rule update error for ${req.shop}:`, err.message)
      );
    }).catch(() => {});
  } catch (err) {
    console.error('[API] /cost-rules PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update cost rule' });
  }
});

router.delete('/cost-rules/:id', auth, async (req, res) => {
  try {
    const deleted = await deleteRule(req.shop, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[API] /cost-rules DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete cost rule' });
  }
});

// --- Settings ---
router.get('/settings', auth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM margin_settings WHERE shop=$1', [req.shop]);
    res.json({ settings: rows[0] || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/settings', auth, async (req, res) => {
  try {
    const { target_margin_percent, min_profit_amount, alert_email, email_alerts_enabled, order_tagging_enabled, low_margin_tag, currency } = req.body;
    const { rows } = await query(
      `INSERT INTO margin_settings (shop, target_margin_percent, min_profit_amount, alert_email, email_alerts_enabled, order_tagging_enabled, low_margin_tag, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (shop) DO UPDATE SET
         target_margin_percent=$2, min_profit_amount=$3, alert_email=$4,
         email_alerts_enabled=$5, order_tagging_enabled=$6, low_margin_tag=$7,
         currency=$8, updated_at=now()
       RETURNING *`,
      [req.shop, parseFloat(target_margin_percent || 30), parseFloat(min_profit_amount || 0),
       alert_email || null, email_alerts_enabled !== false, order_tagging_enabled !== false,
       low_margin_tag || 'marginguard_low_margin', currency || 'GBP']
    );
    res.json({ settings: rows[0] });
  } catch (err) {
    console.error('[API] /settings POST error:', err.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// --- Sync triggers ---
router.post('/sync/products', auth, async (req, res) => {
  try {
    const { rows } = await query('SELECT access_token FROM shops WHERE shop=$1', [req.shop]);
    if (!rows[0]?.access_token) return res.status(400).json({ error: 'Shop not found' });
    syncProducts(req.shop, rows[0].access_token).catch(err =>
      console.error(`[API] Product sync error for ${req.shop}:`, err.message)
    );
    res.json({ message: 'Product sync started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

router.post('/sync/orders', auth, async (req, res) => {
  try {
    const { rows } = await query('SELECT access_token FROM shops WHERE shop=$1', [req.shop]);
    if (!rows[0]?.access_token) return res.status(400).json({ error: 'Shop not found' });
    syncOrders(req.shop, rows[0].access_token).catch(err =>
      console.error(`[API] Order sync error for ${req.shop}:`, err.message)
    );
    res.json({ message: 'Order sync started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// --- Recalculate margins ---
router.post('/recalculate', auth, async (req, res) => {
  try {
    const token = await getValidToken(req.shop);
    if (!token) return res.status(400).json({ error: 'No valid token for shop' });
    recalculateShopMargins(req.shop, token).catch(err =>
      console.error(`[API] Recalculate error for ${req.shop}:`, err.message)
    );
    res.json({ message: 'Recalculation started' });
  } catch (err) {
    console.error('[API] /recalculate error:', err.message);
    res.status(500).json({ error: 'Failed to start recalculation' });
  }
});

// --- Billing status ---
router.get('/billing/status', auth, async (req, res) => {
  res.json({ plan: req.shopRecord.plan_name || 'Free' });
});

// --- Onboarding status ---
router.get('/onboarding/status', auth, async (req, res) => {
  try {
    if (req.shopRecord.onboarding_dismissed_at) {
      return res.json({ dismissed: true, completed: true });
    }
    const [p, r, o, s] = await Promise.all([
      query('SELECT COUNT(*) FROM variant_costs WHERE shop=$1', [req.shop]),
      query('SELECT COUNT(*) FROM cost_rules WHERE shop=$1', [req.shop]),
      query('SELECT COUNT(*) FROM order_margins WHERE shop=$1', [req.shop]),
      query('SELECT COUNT(*) FROM margin_settings WHERE shop=$1', [req.shop]),
    ]);
    const has_products = parseInt(p.rows[0].count) > 0;
    const has_cost_rules = parseInt(r.rows[0].count) > 0;
    const has_orders = parseInt(o.rows[0].count) > 0;
    const has_settings = parseInt(s.rows[0].count) > 0;
    const completed = has_products && has_cost_rules && has_orders && has_settings;
    res.json({ has_products, has_cost_rules, has_orders, has_settings, completed });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/onboarding/dismiss', auth, async (req, res) => {
  try {
    await query('UPDATE shops SET onboarding_dismissed_at = now() WHERE shop = $1', [req.shop]);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

function parseDays(range) {
  const map = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };
  return map[range] || 7;
}

module.exports = router;
