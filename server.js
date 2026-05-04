require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { runMigrations } = require('./lib/db');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Remove X-Frame-Options so Shopify's admin iframe is not blocked
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// Cookie parser
app.use(cookieParser());

// Webhook routes use raw body — must be before json middleware
const webhookRouter = require('./routes/webhooks');
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// JSON + URL-encoded body for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/billing', require('./routes/billing'));
app.use('/api', require('./routes/api'));
app.use('/app', require('./routes/app'));

// Root redirect
app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop) return res.redirect(`/auth?shop=${shop}`);
  res.redirect('/app');
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`[MarginGuard] Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[MarginGuard] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
