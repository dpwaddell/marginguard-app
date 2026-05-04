'use strict';

/**
 * Pure margin calculation — no DB calls.
 * @param {object} opts
 * @param {object} opts.order        - Raw Shopify order object
 * @param {object[]} opts.variantCosts - Rows from variant_costs keyed by variant_id
 * @param {object[]} opts.costRules  - Active cost_rules rows
 * @param {object} opts.settings     - margin_settings row
 */
function calculateOrderMargin({ order, variantCosts, costRules, settings }) {
  const variantMap = {};
  for (const vc of variantCosts) {
    variantMap[vc.variant_id] = vc;
  }

  // --- Line items ---
  const lines = [];
  let grossRevenue = 0;
  let discountTotal = 0;
  let cogsTotal = 0;
  let missingCogs = false;

  for (const item of (order.line_items || [])) {
    const variantId = String(item.variant_id || '');
    const vc = variantMap[variantId] || null;

    const price = parseFloat(item.price || 0);
    const qty = parseInt(item.quantity || 1);
    const grossLine = price * qty;

    // Line-level discounts
    let lineDiscount = 0;
    for (const alloc of (item.discount_allocations || [])) {
      lineDiscount += parseFloat(alloc.amount || 0);
    }

    const netLine = grossLine - lineDiscount;

    // COGS priority: manual → shopify → missing
    let unitCogs = null;
    let cogsSource = 'missing';
    let lineMissingCogs = false;

    if (vc) {
      if (vc.manual_unit_cost != null) {
        unitCogs = parseFloat(vc.manual_unit_cost);
        cogsSource = 'manual';
      } else if (vc.shopify_unit_cost != null) {
        unitCogs = parseFloat(vc.shopify_unit_cost);
        cogsSource = 'shopify';
      }
    }

    if (unitCogs === null) {
      lineMissingCogs = true;
      missingCogs = true;
    }

    const lineCogs = unitCogs !== null ? unitCogs * qty : 0;

    // Per-line tag cost rules
    const productTags = vc?.product_tags || [];
    let lineCustomCosts = 0;
    const lineAppliedRules = [];

    for (const rule of costRules) {
      if (!rule.active) continue;
      if (rule.applies_to !== 'product_tag') continue;
      if (!productTags.includes(rule.product_tag)) continue;
      const cost = resolveRuleCost(rule, netLine, qty);
      lineCustomCosts += cost;
      lineAppliedRules.push({ rule_id: rule.id, name: rule.name, cost });
    }

    const lineProfit = netLine - lineCogs - lineCustomCosts;
    const lineMargin = netLine > 0 ? (lineProfit / netLine) * 100 : null;

    lines.push({
      line_item_id: String(item.id),
      product_id: String(item.product_id || ''),
      variant_id: variantId,
      sku: item.sku || '',
      title: item.title || '',
      quantity: qty,
      gross_line_revenue: round(grossLine),
      discount_total: round(lineDiscount),
      net_line_revenue: round(netLine),
      unit_cogs: unitCogs !== null ? round(unitCogs) : null,
      cogs_total: round(lineCogs),
      custom_costs_total: round(lineCustomCosts),
      net_profit: round(lineProfit),
      margin_percent: lineMargin !== null ? round(lineMargin) : null,
      missing_cogs: lineMissingCogs,
      cogs_source: cogsSource,
      applied_rules: lineAppliedRules,
    });

    grossRevenue += grossLine;
    discountTotal += lineDiscount;
    cogsTotal += lineCogs;
  }

  // Order-level discounts not already captured in line allocations
  const orderLevelDiscount = parseFloat(order.total_discounts || 0);
  const sumLineDiscounts = lines.reduce((s, l) => s + l.discount_total, 0);
  const extraDiscount = Math.max(0, orderLevelDiscount - sumLineDiscounts);
  discountTotal += extraDiscount;

  const netRevenue = grossRevenue - discountTotal;

  // --- Order-level cost rules ---
  let otherCostsTotal = 0;
  const appliedCostRules = [];

  for (const rule of costRules) {
    if (!rule.active) continue;
    if (rule.applies_to !== 'order') continue;
    const cost = resolveRuleCost(rule, netRevenue, 1);
    otherCostsTotal += cost;
    appliedCostRules.push({ rule_id: rule.id, name: rule.name, cost: round(cost) });
  }

  // Add custom costs from line-level tag rules
  const lineCustomTotal = lines.reduce((s, l) => s + l.custom_costs_total, 0);

  const totalCosts = cogsTotal + lineCustomTotal + otherCostsTotal;
  const netProfit = netRevenue - totalCosts;
  const marginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : null;

  // Low margin determination
  const targetMargin = parseFloat(settings?.target_margin_percent ?? 30);
  const minProfit = parseFloat(settings?.min_profit_amount ?? 0);
  const lowMargin = marginPercent !== null
    ? (marginPercent < targetMargin || netProfit < minProfit)
    : false;

  // Confidence status
  let confidenceStatus = 'complete';
  if (netRevenue <= 0) {
    confidenceStatus = 'missing_cost_settings';
  } else if (missingCogs) {
    confidenceStatus = 'missing_cogs';
  } else if (costRules.filter(r => r.active && r.applies_to === 'order').length === 0) {
    confidenceStatus = 'estimated';
  }

  // Alert recommendations
  const alertRecommendations = [];
  if (lowMargin) alertRecommendations.push('low_margin');
  if (missingCogs && netRevenue > 50) alertRecommendations.push('missing_cogs_high_value');
  if (discountTotal > 0 && marginPercent !== null && marginPercent < targetMargin) {
    alertRecommendations.push('discount_margin_drop');
  }

  return {
    gross_revenue: round(grossRevenue),
    discount_total: round(discountTotal),
    net_revenue: round(netRevenue),
    cogs_total: round(cogsTotal),
    other_costs_total: round(otherCostsTotal + lineCustomTotal),
    total_costs: round(totalCosts),
    net_profit: round(netProfit),
    margin_percent: marginPercent !== null ? round(marginPercent) : null,
    low_margin: lowMargin,
    missing_cogs: missingCogs,
    confidence_status: confidenceStatus,
    lines,
    applied_cost_rules: appliedCostRules,
    alert_recommendations: alertRecommendations,
  };
}

function resolveRuleCost(rule, basisValue, quantity) {
  let cost = 0;
  const fixedAmount = parseFloat(rule.fixed_amount || 0);
  const percentRate = parseFloat(rule.percentage_rate || 0);

  if (rule.cost_type === 'fixed') {
    cost = fixedAmount;
  } else if (rule.cost_type === 'percentage') {
    const basis = rule.basis === 'line_value' ? basisValue : basisValue;
    cost = basis * (percentRate / 100);
  } else if (rule.cost_type === 'mixed') {
    cost = fixedAmount + basisValue * (percentRate / 100);
  }

  if (rule.per_unit) cost = cost * quantity;
  return cost;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateOrderMargin };
