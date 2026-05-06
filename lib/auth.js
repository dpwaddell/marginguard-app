const crypto = require('crypto');
const { importJWK, jwtVerify } = require('jose');
const { query } = require('./db');
const { exchangeForOfflineToken } = require('./shopify-client');

// Throttle per-shop token checks to at most once per minute
const _tokenCheckThrottle = new Map();

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function buildInstallUrl(shop, nonce) {
  const scopes = process.env.SHOPIFY_SCOPES;
  const redirectUri = `${process.env.APP_BASE_URL}/auth/callback`;
  const clientId = process.env.SHOPIFY_API_KEY;
  return `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}&grant_options[]=`;
}

function verifyHmac(query) {
  const { hmac, ...rest } = query;
  const secret = process.env.SHOPIFY_API_SECRET;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'));
}

function verifyWebhookHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

async function verifySessionToken(token) {
  try {
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiSecret);
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );

    const [headerB64, payloadB64, sigB64] = token.split('.');
    const sigBytes = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const dataBytes = encoder.encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, dataBytes);
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    const dest = payload.dest;
    if (!dest) return null;
    const shop = dest.replace('https://', '');
    return { shop, payload };
  } catch (err) {
    console.error('[Auth] Session token verification failed:', err.message);
    return null;
  }
}

// Middleware: verify App Bridge session token from Authorization header
async function requireSessionToken(req, res, next) {
  // In dev mode, if no auth header (or verification later fails), fall back to shop param/cookie
  const devShopFallback = () => {
    if (process.env.NODE_ENV === 'production') return false;
    const shop = req.query.shop || req.cookies?.mg_shop;
    if (!shop) return false;
    req.shop = shop;
    return true;
  };

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (devShopFallback()) return next();
    return res.status(401).json({ error: 'Missing session token' });
  }

  const idToken = authHeader.slice(7);
  let result;
  try {
    result = await verifySessionToken(idToken);
  } catch (err) {
    console.error('[Auth] verifySessionToken threw:', err.message);
  }

  if (!result) {
    // In dev mode fall back to shop param so the UI works without a valid App Bridge token
    if (devShopFallback()) {
      console.warn('[Auth] Token verification failed — using dev shop fallback for', req.shop);
      return next();
    }
    console.error('[Auth] Session token verification failed for token prefix:', idToken.slice(0, 20));
    return res.status(401).json({ error: 'Invalid session token' });
  }

  req.shop = result.shop;

  // Non-blocking: exchange id_token for fresh expiring offline token when stored
  // token is missing, a non-expiring shpua_/shpat_, or expiring within 10 minutes.
  proactiveTokenExchange(req.shop, idToken);

  next();
}

function proactiveTokenExchange(shop, idToken) {
  const lastCheck = _tokenCheckThrottle.get(shop) || 0;
  if (Date.now() - lastCheck < 60000) return;
  _tokenCheckThrottle.set(shop, Date.now());

  query('SELECT access_token, token_expires_at FROM shops WHERE shop=$1', [shop])
    .then(({ rows }) => {
      const row = rows[0] || {};
      const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;
      const expiringSoon = expiresAt && expiresAt < new Date(Date.now() + 10 * 60 * 1000);
      const needsRefresh = !row.access_token || row.access_token.startsWith('shpua_') || expiringSoon;
      if (needsRefresh) {
        _tokenCheckThrottle.set(shop, 0); // allow immediate retry after exchange
        exchangeForOfflineToken(shop, idToken)
          .catch(err => console.error(`[Auth] Token exchange failed for ${shop}:`, err.message));
      }
    })
    .catch(err => console.error(`[Auth] Token check error for ${shop}:`, err.message));
}

// Middleware: require Pro plan
function requiresPro(req, res, next) {
  if (req.shopRecord && req.shopRecord.plan_name === 'Pro') return next();
  return res.status(403).json({ error: 'Pro plan required', upgrade: true });
}

module.exports = { generateNonce, buildInstallUrl, verifyHmac, verifyWebhookHmac, verifySessionToken, requireSessionToken, requiresPro };
