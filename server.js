require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { runMigrations } = require('./lib/db');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Redirect HTTP → HTTPS in production (must be before static assets)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim();
    if (proto === 'https') return next();
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });
}

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Remove X-Frame-Options so Shopify's admin iframe is not blocked
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Cookie parser
app.use(cookieParser());

// Webhook routes use raw body — must be before json middleware
const webhookRouter = require('./routes/webhooks');
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// GDPR compliance webhooks (raw body required for HMAC verification)
app.use('/webhooks', express.raw({ type: 'application/json' }), require('./routes/compliance'));

// JSON + URL-encoded body for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Public routes (no auth)
app.get('/privacy', (req, res) => res.render('privacy'));

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
app.get('/health', (req, res) => res.json({
  status: 'ok',
  app: 'MarginGuard',
  version: '1.0.0',
  env: process.env.NODE_ENV || 'development',
}));

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
    if (process.env.NODE_ENV === 'production' && !process.env.APP_BASE_URL?.startsWith('https://')) {
      console.warn('[MarginGuard] WARNING: APP_BASE_URL does not begin with https:// — Shopify requires HTTPS for embedded apps');
    }
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
