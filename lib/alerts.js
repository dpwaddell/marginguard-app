const { query } = require('./db');
const { addOrderTag } = require('./shopify-client');

async function processAlerts(shop, order, marginResult, settings) {
  const { rows: shopRows } = await query('SELECT access_token FROM shops WHERE shop=$1', [shop]);
  const accessToken = shopRows[0]?.access_token;

  for (const alertType of marginResult.alert_recommendations) {
    const message = buildMessage(alertType, order, marginResult);
    let taggedOrder = false;
    let sentEmail = false;

    if (settings.order_tagging_enabled && accessToken) {
      try {
        const tag = settings.low_margin_tag || process.env.LOW_MARGIN_DEFAULT_TAG || 'marginguard_low_margin';
        await addOrderTag(shop, accessToken, order.id, tag);
        taggedOrder = true;
      } catch (err) {
        console.error(`[Alerts] Failed to tag order ${order.name}:`, err.message);
      }
    }

    if (settings.email_alerts_enabled && settings.alert_email) {
      sentEmail = await sendAlertEmail(settings.alert_email, message, shop, order.name);
    }

    await query(
      'INSERT INTO alert_events (shop, order_id, alert_type, message, sent_email, tagged_order) VALUES ($1,$2,$3,$4,$5,$6)',
      [shop, String(order.id), alertType, message, sentEmail, taggedOrder]
    );
  }
}

function buildMessage(alertType, order, result) {
  const profit = result.net_profit?.toFixed(2) ?? '?';
  const margin = result.margin_percent?.toFixed(1) ?? '?';

  if (alertType === 'low_margin') {
    return `Order ${order.name}: net profit £${profit} (${margin}% margin) — this order may not be profitable.`;
  }
  if (alertType === 'missing_cogs_high_value') {
    return `Order ${order.name}: missing product costs on a high-value order (revenue: £${result.net_revenue?.toFixed(2) ?? '?'}).`;
  }
  if (alertType === 'discount_margin_drop') {
    return `Order ${order.name}: discounts reduced margin to ${margin}%. Net profit: £${profit}.`;
  }
  return `Alert for order ${order.name}: ${alertType}`;
}

async function sendAlertEmail(to, message, shop, orderName) {
  const provider = process.env.EMAIL_PROVIDER;

  if (!provider) {
    console.log(`[ALERT] ${shop} | ${orderName} | ${message}`);
    return false;
  }

  // Stub: structured for easy provider drop-in
  try {
    if (provider === 'resend') {
      // const { Resend } = require('resend');
      // const resend = new Resend(process.env.EMAIL_API_KEY);
      // await resend.emails.send({ from: process.env.EMAIL_FROM, to, subject: `MarginGuard Alert: ${orderName}`, text: message });
      console.log(`[ALERT EMAIL STUB] Would send to ${to}: ${message}`);
    } else {
      console.log(`[ALERT] Unknown provider ${provider}. Message: ${message}`);
    }
    return true;
  } catch (err) {
    console.error('[Alerts] Email send failed:', err.message);
    return false;
  }
}

module.exports = { processAlerts };
