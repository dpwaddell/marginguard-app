/**
 * Sanity test for margin-engine (pure function, no DB required).
 * Run with: node test/sanity.js
 */

const { calculateOrderMargin } = require('../lib/margin-engine');

const order = {
  id: '1234567890',
  name: '#1001',
  processed_at: new Date().toISOString(),
  currency: 'GBP',
  total_discounts: '5.00',
  line_items: [
    {
      id: '111',
      product_id: '555',
      variant_id: '999',
      title: 'Test Widget',
      sku: 'TW-001',
      price: '25.00',
      quantity: 2,
      discount_allocations: [{ amount: '5.00' }],
    },
    {
      id: '222',
      product_id: '666',
      variant_id: '888',
      title: 'Mystery Item (no cost)',
      sku: 'MI-002',
      price: '10.00',
      quantity: 1,
      discount_allocations: [],
    },
  ],
};

const variantCosts = [
  {
    variant_id: '999',
    shopify_unit_cost: 8.0,
    manual_unit_cost: null,
    product_tags: [],
  },
  // variant 888 deliberately absent → missing_cogs
];

const costRules = [
  { id: 1, applies_to: 'order', cost_type: 'mixed', fixed_amount: 0.30, percentage_rate: 2.9, basis: 'order_value', per_unit: false, active: true, product_tag: null },
  { id: 2, applies_to: 'order', cost_type: 'fixed', fixed_amount: 2.00, percentage_rate: 0, basis: 'order_value', per_unit: false, active: true, product_tag: null },
];

const settings = { target_margin_percent: 30, min_profit_amount: 0 };

const result = calculateOrderMargin({ order, variantCosts, costRules, settings });

console.log('\n=== MarginGuard Sanity Test ===\n');
console.log('Gross Revenue:    £' + result.gross_revenue.toFixed(2));
console.log('Discount Total:   £' + result.discount_total.toFixed(2));
console.log('Net Revenue:      £' + result.net_revenue.toFixed(2));
console.log('COGS Total:       £' + result.cogs_total.toFixed(2));
console.log('Other Costs:      £' + result.other_costs_total.toFixed(2));
console.log('Total Costs:      £' + result.total_costs.toFixed(2));
console.log('Net Profit:       £' + result.net_profit.toFixed(2));
console.log('Margin %:         ' + (result.margin_percent?.toFixed(2) ?? 'null') + '%');
console.log('Low Margin:       ' + result.low_margin);
console.log('Missing COGS:     ' + result.missing_cogs);
console.log('Confidence:       ' + result.confidence_status);
console.log('\nLine Items:');
result.lines.forEach(l => {
  console.log(`  ${l.title}: revenue £${l.net_line_revenue} | cogs £${l.cogs_total} | profit £${l.net_profit} | missing=${l.missing_cogs}`);
});
console.log('\nApplied Cost Rules:', result.applied_cost_rules.map(r => `${r.name} £${r.cost}`).join(', '));
console.log('Alert Recommendations:', result.alert_recommendations.join(', ') || 'none');

// Assertions
let passed = 0;
let failed = 0;

function assert(desc, condition) {
  if (condition) { console.log('\n  ✓ ' + desc); passed++; }
  else { console.log('\n  ✗ FAIL: ' + desc); failed++; }
}

console.log('\n=== Assertions ===');
assert('Gross revenue = 25*2 + 10*1 = 60', result.gross_revenue === 60);
assert('Discount total = 5', result.discount_total === 5);
assert('Net revenue = 55', result.net_revenue === 55);
assert('COGS total = 8*2 = 16 (missing item counts 0)', result.cogs_total === 16);
assert('Missing COGS = true', result.missing_cogs === true);
assert('Confidence = missing_cogs', result.confidence_status === 'missing_cogs');
assert('Applied 2 cost rules', result.applied_cost_rules.length === 2);
assert('Has at least 2 lines', result.lines.length === 2);
assert('Line 1 not missing cogs', result.lines[0].missing_cogs === false);
assert('Line 2 missing cogs', result.lines[1].missing_cogs === true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
