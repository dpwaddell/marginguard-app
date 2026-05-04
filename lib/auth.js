const crypto = require('crypto');
const { importJWK, jwtVerify } = require('jose');

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function buildInstallUrl(shop, nonce) {
  const scopes = process.env.SHOPIFY_SCOPES;
  const redirectUri = `${process.env.APP_BASE_URL}/auth/callback`;
  const clientId = process.env.SHOPIFY_API_KEY;
  return `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;
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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (process.env.NODE_ENV === 'development' && req.query.shop) {
      req.shop = req.query.shop;
      return next();
    }
    return res.status(401).json({ error: 'Missing session token' });
  }
  const token = authHeader.slice(7);
  let result;
  try {
    result = await verifySessionToken(token);
  } catch (err) {
    console.error('[Auth] verifySessionToken threw:', err.message);
    return res.status(401).json({ error: 'Invalid session token' });
  }
  if (!result) {
    console.error('[Auth] Session token verification failed for token prefix:', token.slice(0, 20));
    return res.status(401).json({ error: 'Invalid session token' });
  }
  req.shop = result.shop;
  next();
}

// Middleware: require Pro plan
function requiresPro(req, res, next) {
  if (req.shopRecord && req.shopRecord.plan_name === 'Pro') return next();
  return res.status(403).json({ error: 'Pro plan required', upgrade: true });
}

module.exports = { generateNonce, buildInstallUrl, verifyHmac, verifyWebhookHmac, verifySessionToken, requireSessionToken, requiresPro };
