// Vercel Serverless Function
// يستقبل كل أنواع webhooks من Shopify ويحدث Supabase
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyShopifyWebhook(body, hmacHeader, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  return hash === hmacHeader;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const shopDomain = req.headers['x-shopify-shop-domain'];
  const topic = req.headers['x-shopify-topic']; // orders/create, orders/cancelled, orders/edited, orders/fulfilled
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (secret && !verifyShopifyWebhook(rawBody, hmac, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // ==================== orders/create ====================
  if (topic === 'orders/create') {
    const customer = payload.customer || {};
    const shipping = payload.shipping_address || payload.billing_address || {};
    const customerName =
      `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
      customer.email ||
      'عميل Shopify';

    const phone = payload.phone || customer.phone || shipping.phone || '';
    const address = [shipping.address1, shipping.address2, shipping.city]
      .filter(Boolean)
      .join(' - ');
    const items = (payload.line_items || [])
      .map(i => `${i.name} × ${i.quantity}`)
      .join('\n');
    const orderId = `SH-${payload.order_number || payload.id}`;

    const { error } = await supabase.from('orders').upsert([{
      id: orderId,
      customer: customerName,
      phone,
      address,
      page: 'اسيا',
      item: items,
      quantity: (payload.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0),
      status: 'جاري التحضير',
      notes: payload.note || '',
      productPrice: parseFloat(payload.subtotal_price || 0),
      shippingPrice: parseFloat(payload.total_shipping_price_set?.shop_money?.amount || 0),
      trackingNumber: '',
      date: new Date(payload.created_at).toISOString().split('T')[0],
      source: 'shopify',
      shopify_order_id: String(payload.id),
      shopify_store: shopDomain || '',
    }], { onConflict: 'id' });

    if (error) { console.error('create error:', error); return res.status(500).json({ error: error.message }); }
    return res.status(200).json({ success: true, topic });
  }

  // ==================== orders/cancelled ====================
  if (topic === 'orders/cancelled') {
    const orderId = `SH-${payload.order_number || payload.id}`;
    const { error } = await supabase
      .from('orders')
      .update({ status: 'الغاء' })
      .eq('shopify_order_id', String(payload.id));

    if (error) { console.error('cancel error:', error); return res.status(500).json({ error: error.message }); }
    return res.status(200).json({ success: true, topic });
  }

  // ==================== orders/fulfilled ====================
  if (topic === 'orders/fulfilled') {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'الشحن' })
      .eq('shopify_order_id', String(payload.id));

    if (error) { console.error('fulfill error:', error); return res.status(500).json({ error: error.message }); }
    return res.status(200).json({ success: true, topic });
  }

  // ==================== orders/edited ====================
  if (topic === 'orders/edited') {
    // تحديث الملاحظات لو اتغيرت
    const orderId = payload.order_edit?.order_id;
    if (orderId) {
      const { error } = await supabase
        .from('orders')
        .update({ notes: payload.order_edit?.note || '' })
        .eq('shopify_order_id', String(orderId));

      if (error) { console.error('edit error:', error); return res.status(500).json({ error: error.message }); }
    }
    return res.status(200).json({ success: true, topic });
  }

  return res.status(200).json({ success: true, topic: 'ignored' });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export const config = {
  api: { bodyParser: false },
};
