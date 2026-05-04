const { query } = require('./db');

const DEFAULT_RULES = [
  { name: 'Payment processing', cost_type: 'mixed', fixed_amount: 0.30, percentage_rate: 2.9, basis: 'order_value', applies_to: 'order', per_unit: false, active: true, premium_only: false },
  { name: 'Pick and pack', cost_type: 'fixed', fixed_amount: 2.00, percentage_rate: 0, basis: 'order_value', applies_to: 'order', per_unit: false, active: true, premium_only: false },
  { name: 'Packaging', cost_type: 'fixed', fixed_amount: 0.50, percentage_rate: 0, basis: 'order_value', applies_to: 'order', per_unit: false, active: true, premium_only: false },
  { name: 'Returns reserve', cost_type: 'percentage', fixed_amount: 0, percentage_rate: 3.0, basis: 'order_value', applies_to: 'order', per_unit: false, active: true, premium_only: false },
];

async function seedDefaultRules(shop) {
  const existing = await query('SELECT id FROM cost_rules WHERE shop = $1 LIMIT 1', [shop]);
  if (existing.rows.length > 0) return;

  for (const rule of DEFAULT_RULES) {
    await query(
      `INSERT INTO cost_rules (shop, name, applies_to, cost_type, fixed_amount, percentage_rate, basis, per_unit, active, premium_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [shop, rule.name, rule.applies_to, rule.cost_type, rule.fixed_amount, rule.percentage_rate, rule.basis, rule.per_unit, rule.active, rule.premium_only]
    );
  }
  console.log(`[CostRules] Seeded default rules for ${shop}`);
}

async function getActiveRules(shop) {
  const { rows } = await query(
    'SELECT * FROM cost_rules WHERE shop = $1 AND active = true ORDER BY id',
    [shop]
  );
  return rows;
}

async function getAllRules(shop) {
  const { rows } = await query(
    'SELECT * FROM cost_rules WHERE shop = $1 ORDER BY id',
    [shop]
  );
  return rows;
}

async function createRule(shop, data) {
  const { rows } = await query(
    `INSERT INTO cost_rules (shop, name, applies_to, product_tag, product_id, variant_id, cost_type, fixed_amount, percentage_rate, basis, per_unit, active, premium_only)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [shop, data.name, data.applies_to || 'order', data.product_tag || null, data.product_id || null, data.variant_id || null,
     data.cost_type || 'fixed', parseFloat(data.fixed_amount || 0), parseFloat(data.percentage_rate || 0),
     data.basis || 'order_value', !!data.per_unit, data.active !== false, !!data.premium_only]
  );
  return rows[0];
}

async function updateRule(shop, id, data) {
  const { rows } = await query(
    `UPDATE cost_rules SET name=$3, applies_to=$4, product_tag=$5, cost_type=$6,
     fixed_amount=$7, percentage_rate=$8, basis=$9, per_unit=$10, active=$11, premium_only=$12,
     updated_at=now() WHERE shop=$1 AND id=$2 RETURNING *`,
    [shop, id, data.name, data.applies_to, data.product_tag || null, data.cost_type,
     parseFloat(data.fixed_amount || 0), parseFloat(data.percentage_rate || 0),
     data.basis || 'order_value', !!data.per_unit, data.active !== false, !!data.premium_only]
  );
  return rows[0] || null;
}

async function deleteRule(shop, id) {
  const { rowCount } = await query('DELETE FROM cost_rules WHERE shop=$1 AND id=$2', [shop, id]);
  return rowCount > 0;
}

module.exports = { seedDefaultRules, getActiveRules, getAllRules, createRule, updateRule, deleteRule };
