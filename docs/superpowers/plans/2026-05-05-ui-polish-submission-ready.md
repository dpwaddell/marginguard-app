# UI Polish — Submission Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring MarginGuard's UI to submission-ready quality — polished header with plan badge, fixed stat card overflow, consolidated alert banners, consistent card/page styling across all views.

**Architecture:** All changes are CSS + HTML in `layout.ejs` (shared shell), with JS additions to `app.js` (global nav badge) and per-view EJS files. No backend changes. Docker rebuild confirms no regressions.

**Tech Stack:** EJS templates, vanilla CSS (embedded in layout.ejs), vanilla JS (app.js + inline per-view scripts), PostgreSQL (one DB reset command), Docker Compose.

---

## File Map

| File | What changes |
|------|-------------|
| `views/layout.ejs` | Nav restructure (plan badge slot), CSS: stat-value font, stat-card overflow, card border-radius, page width/padding, page-subtitle class, nav-right styles |
| `public/app.js` | Add `initNavPlanBadge()` — fetches billing status, populates badge in nav |
| `views/dashboard.ejs` | Remove `leakage-container` div, combine alert logic in JS, subtitle class |
| `views/orders.ejs` | Add subtitle, remove inline stat-grid column override |
| `views/products.ejs` | Add subtitle |
| `views/costs.ejs` | Add subtitle |
| `views/settings.ejs` | Add subtitle, replace inline section-header styles with `.section-header` class |
| `views/billing.ejs` | Add subtitle |
| `views/order-detail.ejs` | Add accent colors to stat cards, replace inline color styles with CSS classes |

---

## Task 1: CSS fixes in layout.ejs

**Files:**
- Modify: `views/layout.ejs`

Fix: stat-value font-size (28→22px), stat-card overflow, stat-grid min column, card border-radius (12→8px), page width/padding, add `.page-subtitle` class, add nav-right CSS.

- [ ] **Step 1: Edit `.stat-value` rule** (layout.ejs line 52)

Change:
```css
.stat-value { font-size: 28px; font-weight: 900; line-height: 1.0; color: #111827; letter-spacing: -0.03em; }
```
To:
```css
.stat-value { font-size: 22px; font-weight: 900; line-height: 1.0; color: #111827; letter-spacing: -0.03em; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
```

- [ ] **Step 2: Edit `.stat-card` rule** (layout.ejs line 38)

Change:
```css
.stat-card { background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: box-shadow 0.2s, transform 0.2s; border-left: 4px solid #e5e7eb; position: relative; overflow: hidden; }
```
To:
```css
.stat-card { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: box-shadow 0.2s, transform 0.2s; border-left: 4px solid #e5e7eb; position: relative; overflow: hidden; min-width: 0; }
```

- [ ] **Step 3: Edit `.stat-grid` rule** (layout.ejs line 37)

Change:
```css
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 14px; margin-bottom: 20px; }
```
To:
```css
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; margin-bottom: 20px; }
```

- [ ] **Step 4: Edit `.card` rule** (layout.ejs line 31)

Change:
```css
.card { background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03); }
```
To:
```css
.card { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
```

- [ ] **Step 5: Edit `.page` rule** (layout.ejs line 24)

Change:
```css
.page { max-width: 1100px; margin: 0 auto; padding: 28px 24px; }
```
To:
```css
.page { max-width: 1200px; margin: 0 auto; padding: 24px 28px; }
```

- [ ] **Step 6: Add `.page-subtitle` class and `.nav-right` CSS** — insert after the `.page-header-sub` rule (line 27):

Change:
```css
    .page-header-sub { font-size: 13px; color: #9ca3af; margin-top: 3px; font-weight: 400; }
```
To:
```css
    .page-header-sub { font-size: 13px; color: #9ca3af; margin-top: 3px; font-weight: 400; }
    .page-subtitle { font-size: 13px; color: #6b7280; margin-top: 4px; font-weight: 400; }
    .nav-right { display: flex; align-items: center; gap: 10px; margin-left: 16px; flex-shrink: 0; }
    .nav-plan-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .nav-plan-badge.free { background: #f3f4f6; color: #4b5563; }
    .nav-plan-badge.pro  { background: linear-gradient(135deg, #7c3aed, #a78bfa); color: #fff; }
    .section-header { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
```

- [ ] **Step 7: Verify layout.ejs saved without syntax errors**

Run: `node -e "require('fs').readFileSync('views/layout.ejs', 'utf8'); console.log('OK')" 2>&1` from `/mnt/user/appdata/marginguard`
Expected output: `OK`

---

## Task 2: Nav restructure + plan badge in HTML and app.js

**Files:**
- Modify: `views/layout.ejs` (HTML section)
- Modify: `public/app.js`

- [ ] **Step 1: Restructure nav HTML in layout.ejs** (lines 157–170)

Change:
```html
  <nav class="nav">
    <a class="nav-brand" href="#" data-href="/app">
      <img src="/logo.png" alt="MarginGuard">
      <span class="nav-brand-name">MarginGuard</span>
    </a>
    <div class="nav-items">
      <a class="nav-link" href="#" data-href="/app">Dashboard</a>
      <a class="nav-link" href="#" data-href="/app/orders">Orders</a>
      <a class="nav-link" href="#" data-href="/app/products">Products</a>
      <a class="nav-link" href="#" data-href="/app/costs">Cost Rules</a>
      <a class="nav-link" href="#" data-href="/app/settings">Settings</a>
      <a class="nav-link" href="#" data-href="/app/billing">Billing</a>
    </div>
  </nav>
```
To:
```html
  <nav class="nav">
    <a class="nav-brand" href="#" data-href="/app">
      <img src="/logo.png" alt="MarginGuard">
      <span class="nav-brand-name">MarginGuard</span>
    </a>
    <div class="nav-items">
      <a class="nav-link" href="#" data-href="/app">Dashboard</a>
      <a class="nav-link" href="#" data-href="/app/orders">Orders</a>
      <a class="nav-link" href="#" data-href="/app/products">Products</a>
      <a class="nav-link" href="#" data-href="/app/costs">Cost Rules</a>
      <a class="nav-link" href="#" data-href="/app/settings">Settings</a>
      <a class="nav-link" href="#" data-href="/app/billing">Billing</a>
    </div>
    <div class="nav-right">
      <span id="nav-plan-badge"></span>
    </div>
  </nav>
```

- [ ] **Step 2: Add `initNavPlanBadge()` to app.js** — append before the closing `})();` at the end of the IIFE (after line 101):

Change:
```js
  document.addEventListener('DOMContentLoaded', function () {
```
To:
```js
  async function initNavPlanBadge() {
    var el = document.getElementById('nav-plan-badge');
    if (!el) return;
    try {
      var shop = getNavParams().shop;
      var headers = {};
      try { headers['Authorization'] = 'Bearer ' + await withTimeout(window.shopify && window.shopify.idToken ? window.shopify.idToken() : Promise.reject(), 2000); } catch(e) {}
      var res = await fetch('/api/billing/status?shop=' + shop, { headers });
      if (!res.ok) { el.className = 'nav-plan-badge free'; el.textContent = 'Free'; return; }
      var data = await res.json();
      if (data.plan === 'Pro') {
        el.className = 'nav-plan-badge pro';
        el.textContent = 'Pro';
      } else {
        el.className = 'nav-plan-badge free';
        el.textContent = 'Free';
      }
    } catch(e) {
      el.className = 'nav-plan-badge free';
      el.textContent = 'Free';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
```

- [ ] **Step 3: Call `initNavPlanBadge()` inside DOMContentLoaded** — find the line that starts `// Nav active state` (inside the DOMContentLoaded handler) and add the call before it:

Change:
```js
    // Nav active state (data-href matching)
```
To:
```js
    initNavPlanBadge();

    // Nav active state (data-href matching)
```

- [ ] **Step 4: Verify app.js has no syntax errors**

Run: `node --check public/app.js && echo OK`
Expected: `OK`

---

## Task 3: Dashboard — combine alert banners + subtitle class

**Files:**
- Modify: `views/dashboard.ejs`

- [ ] **Step 1: Remove leakage-container div and fix subtitle** (dashboard.ejs lines 6, 19–20)

Change:
```ejs
    <div style="font-size:13px;color:#6b7280;margin-top:2px">Track profitability and identify margin risks</div>
```
To:
```ejs
    <div class="page-subtitle">Track profitability and identify margin risks</div>
```

Change:
```html
  <div id="onboarding-container"></div>
  <div id="alert-container"></div>
  <div id="leakage-container"></div>
```
To:
```html
  <div id="onboarding-container"></div>
  <div id="alert-container"></div>
```

- [ ] **Step 2: Replace the split alert+leakage render logic in dashboard.ejs JS** (lines 198–219)

Change:
```js
    var alertCon = document.getElementById('alert-container');
    if (data.low_margin_count > 0) {
      alertCon.innerHTML = '<div class="alert-bar danger"><span class="alert-icon">⚠</span><div><strong>' + data.low_margin_count + ' low-margin order' + (data.low_margin_count > 1 ? 's' : '') + '</strong> this period — review to identify profit leakage. <a href="/app/orders?sort=margin_asc">Review now →</a></div></div>';
    } else if (data.missing_cogs_count > 0) {
      alertCon.innerHTML = '<div class="alert-bar"><span class="alert-icon">⚠</span><div><strong>' + data.missing_cogs_count + ' order' + (data.missing_cogs_count > 1 ? 's' : '') + '</strong> have missing product costs — margin estimates may be understated. <a href="/app/products">Fix now →</a></div></div>';
    } else {
      alertCon.innerHTML = '';
    }

    var leakCon = document.getElementById('leakage-container');
    if (data.missing_cogs_count > 0 && s.avg_margin) {
      var avgMargin = parseFloat(s.avg_margin) / 100;
      var revenuePerOrder = parseFloat(s.total_revenue) / Math.max(parseInt(s.order_count), 1);
      var estimatedLeakage = data.missing_cogs_count * revenuePerOrder * avgMargin;
      if (estimatedLeakage > 0) {
        leakCon.innerHTML = '<div class="alert-bar info"><span class="alert-icon">💡</span><div><strong>Estimated profit at risk from incomplete COGS:</strong> <span style="font-size:15px;font-weight:800;color:#2563eb">' + fmt(estimatedLeakage) + '</span> &mdash; based on ' + data.missing_cogs_count + ' orders with missing costs × avg margin of ' + fmtPct(s.avg_margin) + '. <a href="/app/products">Add missing costs →</a></div></div>';
      } else {
        leakCon.innerHTML = '';
      }
    } else {
      leakCon.innerHTML = '';
    }
```
To:
```js
    var alertCon = document.getElementById('alert-container');
    var alerts = [];
    if (data.low_margin_count > 0) {
      alerts.push('<div class="alert-bar danger"><span class="alert-icon">⚠</span><div><strong>' + data.low_margin_count + ' low-margin order' + (data.low_margin_count > 1 ? 's' : '') + '</strong> this period — review to identify profit leakage. <a href="/app/orders?sort=margin_asc">Review now →</a></div></div>');
    }
    if (data.missing_cogs_count > 0) {
      var leakageNote = '';
      if (s.avg_margin) {
        var avgMargin = parseFloat(s.avg_margin) / 100;
        var revenuePerOrder = parseFloat(s.total_revenue) / Math.max(parseInt(s.order_count), 1);
        var estimatedLeakage = data.missing_cogs_count * revenuePerOrder * avgMargin;
        if (estimatedLeakage > 0) {
          leakageNote = ' Estimated profit at risk: <strong style="color:#2563eb">' + fmt(estimatedLeakage) + '</strong>.';
        }
      }
      alerts.push('<div class="alert-bar"><span class="alert-icon">⚠</span><div><strong>' + data.missing_cogs_count + ' order' + (data.missing_cogs_count > 1 ? 's' : '') + '</strong> have missing product costs — margin estimates may be understated.' + leakageNote + ' <a href="/app/products">Fix now →</a></div></div>');
    }
    alertCon.innerHTML = alerts.join('');
```

- [ ] **Step 3: Verify dashboard.ejs EJS parse**

Run: `node -e "const ejs = require('ejs'); ejs.renderFile('views/dashboard.ejs', {apiKey:'',shop:'',host:'',appUrl:''}, {}, (e) => { if(e) console.error(e.message); else console.log('OK'); })"`
Expected: `OK`

---

## Task 4: Subtitles + polish for orders, products, costs pages

**Files:**
- Modify: `views/orders.ejs`
- Modify: `views/products.ejs`
- Modify: `views/costs.ejs`

- [ ] **Step 1: Add subtitle to orders.ejs** (line 4, inside `.page-header`)

Change:
```html
  <div class="page-header">
    <h1>Orders</h1>
```
To:
```html
  <div class="page-header">
    <div>
      <h1>Orders</h1>
      <div class="page-subtitle">Monitor order profitability and identify margin risks</div>
    </div>
```

- [ ] **Step 2: Remove inline stat-grid column override from orders.ejs** (line 29)

Change:
```html
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:10px">
```
To:
```html
    <div class="stat-grid">
```

- [ ] **Step 3: Add subtitle to products.ejs** (line 4)

Change:
```html
  <div class="page-header">
    <h1>Product Costs</h1>
```
To:
```html
  <div class="page-header">
    <div>
      <h1>Product Costs</h1>
      <div class="page-subtitle">Manage product costs to ensure accurate margin calculations</div>
    </div>
```

- [ ] **Step 4: Add subtitle to costs.ejs** (line 4)

Change:
```html
  <div class="page-header">
    <h1>Cost Rules</h1>
```
To:
```html
  <div class="page-header">
    <div>
      <h1>Cost Rules</h1>
      <div class="page-subtitle">Define cost rules for payment processing, shipping, and fulfilment</div>
    </div>
```

---

## Task 5: Settings inline style cleanup + subtitle

**Files:**
- Modify: `views/settings.ejs`

- [ ] **Step 1: Add subtitle to settings page-header** (line 5)

Change:
```html
  <div class="page-header">
    <h1>Settings</h1>
  </div>
```
To:
```html
  <div class="page-header">
    <div>
      <h1>Settings</h1>
      <div class="page-subtitle">Configure margin thresholds and alert preferences</div>
    </div>
  </div>
```

- [ ] **Step 2: Replace first inline section-header style** (line 8)

Change:
```html
    <div style="font-size:14px;font-weight:700;color:#202223;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e1e3e5">Margin Thresholds</div>
```
To:
```html
    <div class="section-header">Margin Thresholds</div>
```

- [ ] **Step 3: Replace second inline section-header style** (line 31)

Change:
```html
      <div style="font-size:14px;font-weight:700;color:#202223;margin-top:24px;margin-bottom:12px;padding-top:16px;border-top:1px solid #e1e3e5">Alert Settings</div>
```
To:
```html
      <div class="section-header" style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb">Alert Settings</div>
```

- [ ] **Step 4: Replace third inline section-header style** (line 62)

Change:
```html
    <div style="font-size:14px;font-weight:700;color:#202223;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #e1e3e5">Manual Data Sync</div>
```
To:
```html
    <div class="section-header">Manual Data Sync</div>
```

---

## Task 6: Billing subtitle

**Files:**
- Modify: `views/billing.ejs`

- [ ] **Step 1: Add subtitle to billing page-header** (line 4)

Change:
```html
  <div class="page-header">
    <h1>Billing</h1>
  </div>
```
To:
```html
  <div class="page-header">
    <div>
      <h1>Billing</h1>
      <div class="page-subtitle">Manage your MarginGuard subscription</div>
    </div>
  </div>
```

---

## Task 7: Order detail polish

**Files:**
- Modify: `views/order-detail.ejs`

- [ ] **Step 1: Add subtitle + accent colors to stat cards** (lines 4–18)

Change:
```html
  <div class="page-header">
    <h1 id="order-title">Order Detail</h1>
    <a href="/app/orders" class="btn btn-secondary btn-sm">← Back to orders</a>
  </div>

  <div id="confidence-warning"></div>

  <div class="stat-grid" id="order-stats">
    <div class="stat-card"><div class="stat-label">Gross Revenue</div><div class="stat-value" id="stat-gross">—</div></div>
    <div class="stat-card"><div class="stat-label">Discounts</div><div class="stat-value warning" id="stat-discount">—</div></div>
    <div class="stat-card"><div class="stat-label">Net Revenue</div><div class="stat-value" id="stat-net">—</div></div>
    <div class="stat-card"><div class="stat-label">Total COGS</div><div class="stat-value" id="stat-cogs">—</div></div>
    <div class="stat-card"><div class="stat-label">Other Costs</div><div class="stat-value" id="stat-other">—</div></div>
    <div class="stat-card"><div class="stat-label">Net Profit</div><div class="stat-value" id="stat-profit">—</div></div>
    <div class="stat-card"><div class="stat-label">Margin</div><div class="stat-value" id="stat-margin">—</div></div>
  </div>
```
To:
```html
  <div class="page-header">
    <div>
      <h1 id="order-title">Order Detail</h1>
      <div class="page-subtitle" id="order-subtitle"></div>
    </div>
    <a href="/app/orders" class="btn btn-secondary btn-sm">← Back to orders</a>
  </div>

  <div id="confidence-warning"></div>

  <div class="stat-grid" id="order-stats">
    <div class="stat-card accent-blue"><div class="stat-label">Gross Revenue</div><div class="stat-value" id="stat-gross">—</div></div>
    <div class="stat-card accent-amber"><div class="stat-label">Discounts</div><div class="stat-value warning" id="stat-discount">—</div></div>
    <div class="stat-card accent-blue"><div class="stat-label">Net Revenue</div><div class="stat-value" id="stat-net">—</div></div>
    <div class="stat-card accent-grey"><div class="stat-label">Total COGS</div><div class="stat-value" id="stat-cogs">—</div></div>
    <div class="stat-card accent-grey"><div class="stat-label">Other Costs</div><div class="stat-value" id="stat-other">—</div></div>
    <div class="stat-card accent-green"><div class="stat-label">Net Profit</div><div class="stat-value" id="stat-profit">—</div></div>
    <div class="stat-card accent-green"><div class="stat-label">Margin</div><div class="stat-value" id="stat-margin">—</div></div>
  </div>
```

- [ ] **Step 2: Populate subtitle from order data** — in the `renderOrder` function, after setting `order-title` (line 72):

Change:
```js
    document.getElementById('order-title').textContent = o.order_name || 'Order #' + o.order_id;
```
To:
```js
    document.getElementById('order-title').textContent = o.order_name || 'Order #' + o.order_id;
    var subEl = document.getElementById('order-subtitle');
    if (subEl && o.processed_at) subEl.textContent = new Date(o.processed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
```

- [ ] **Step 3: Replace inline color styles in line items** (order-detail.ejs around line 120)

Change:
```js
        '<td class="text-right" style="color:' + (lprofit < 0 ? '#d72c0d' : '#008060') + '">' + fmt(l.net_profit) + '</td>' +
```
To:
```js
        '<td class="text-right ' + (lprofit < 0 ? 'text-red' : 'text-green') + '">' + fmt(l.net_profit) + '</td>' +
```

---

## Task 8: DB reset + rebuild + verify

- [ ] **Step 1: Reset onboarding_dismissed_at so onboarding shows again**

Run:
```bash
docker exec marginguard-marginguard-db-1 psql -U marginguard -d marginguard -c "UPDATE shops SET onboarding_dismissed_at=NULL WHERE shop='sampleguard.myshopify.com';"
```
Expected: `UPDATE 1`

- [ ] **Step 2: Rebuild and restart with Docker Compose**

Run from `/mnt/user/appdata/marginguard`:
```bash
docker compose up --build -d
```
Expected: containers start, no build errors.

- [ ] **Step 3: Verify app is up**

Run:
```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3015/health
```
Expected: `200`

- [ ] **Step 4: Check for JS syntax errors in rendered page**

Run:
```bash
curl -s "http://localhost:3015/app?shop=sampleguard.myshopify.com" | grep -i "syntaxerror\|unexpected token\|is not defined" | head -5
```
Expected: no output (no syntax errors).

- [ ] **Step 5: Commit**

```bash
cd /mnt/user/appdata/marginguard
git add views/layout.ejs public/app.js views/dashboard.ejs views/orders.ejs views/products.ejs views/costs.ejs views/settings.ejs views/billing.ejs views/order-detail.ejs
git commit -m "$(cat <<'EOF'
UI polish pass: header badge, stat card overflow, consolidated alerts, consistent card/page styling across all views

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Spec Coverage Self-Review

| Requirement | Covered in |
|---|---|
| 1. Header — plan badge far right | Task 2 |
| 2. Stat cards overflow fix | Task 1 (font-size, min-width, ellipsis) |
| 3. Dashboard layout (max-width 1200, padding, subtitle) | Tasks 1 + 3 |
| 4. Alert banners combined | Task 3 |
| 5. Onboarding DB reset | Task 8 Step 1 |
| 6. General polish (border-radius 8px, box-shadow, link colour) | Task 1 |
| 7. All views consistent | Tasks 4, 5, 6, 7 |
| Docker rebuild verify | Task 8 |
