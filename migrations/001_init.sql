-- shops
CREATE TABLE IF NOT EXISTS shops (
  shop TEXT PRIMARY KEY,
  access_token TEXT,
  installed_at TIMESTAMPTZ DEFAULT now(),
  plan_name TEXT DEFAULT 'Free',
  plan_status TEXT DEFAULT 'inactive',
  billing_subscription_id TEXT,
  billing_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- margin_settings
CREATE TABLE IF NOT EXISTS margin_settings (
  shop TEXT PRIMARY KEY,
  target_margin_percent NUMERIC DEFAULT 30,
  min_profit_amount NUMERIC DEFAULT 0,
  alert_email TEXT,
  email_alerts_enabled BOOLEAN DEFAULT true,
  order_tagging_enabled BOOLEAN DEFAULT true,
  low_margin_tag TEXT DEFAULT 'marginguard_low_margin',
  currency TEXT DEFAULT 'GBP',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- variant_costs
CREATE TABLE IF NOT EXISTS variant_costs (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT NOT NULL,
  inventory_item_id TEXT,
  sku TEXT,
  product_title TEXT,
  variant_title TEXT,
  shopify_unit_cost NUMERIC,
  manual_unit_cost NUMERIC,
  effective_unit_cost NUMERIC,
  source TEXT DEFAULT 'shopify',
  missing_cost BOOLEAN DEFAULT false,
  product_tags TEXT[],
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop, variant_id)
);

-- cost_rules
CREATE TABLE IF NOT EXISTS cost_rules (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'order',
  product_tag TEXT,
  product_id TEXT,
  variant_id TEXT,
  cost_type TEXT NOT NULL DEFAULT 'fixed',
  fixed_amount NUMERIC DEFAULT 0,
  percentage_rate NUMERIC DEFAULT 0,
  basis TEXT DEFAULT 'order_value',
  per_unit BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  premium_only BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- order_margins
CREATE TABLE IF NOT EXISTS order_margins (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_name TEXT,
  processed_at TIMESTAMPTZ,
  currency TEXT,
  gross_revenue NUMERIC DEFAULT 0,
  discount_total NUMERIC DEFAULT 0,
  net_revenue NUMERIC DEFAULT 0,
  cogs_total NUMERIC DEFAULT 0,
  other_costs_total NUMERIC DEFAULT 0,
  total_costs NUMERIC DEFAULT 0,
  net_profit NUMERIC DEFAULT 0,
  margin_percent NUMERIC DEFAULT 0,
  low_margin BOOLEAN DEFAULT false,
  missing_cogs BOOLEAN DEFAULT false,
  confidence_status TEXT DEFAULT 'complete',
  calculation_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop, order_id)
);

-- order_margin_lines
CREATE TABLE IF NOT EXISTS order_margin_lines (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_item_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  sku TEXT,
  title TEXT,
  quantity INTEGER DEFAULT 1,
  gross_line_revenue NUMERIC DEFAULT 0,
  discount_total NUMERIC DEFAULT 0,
  net_line_revenue NUMERIC DEFAULT 0,
  unit_cogs NUMERIC,
  cogs_total NUMERIC DEFAULT 0,
  custom_costs_total NUMERIC DEFAULT 0,
  net_profit NUMERIC DEFAULT 0,
  margin_percent NUMERIC DEFAULT 0,
  missing_cogs BOOLEAN DEFAULT false,
  calculation_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- alert_events
CREATE TABLE IF NOT EXISTS alert_events (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  order_id TEXT,
  alert_type TEXT,
  message TEXT,
  sent_email BOOLEAN DEFAULT false,
  tagged_order BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
