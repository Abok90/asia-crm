// Vercel Serverless Function
// Shopify sends orders/create webhook here → saves to Supabase
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// التحقق من إن الطلب جاي من Shopify فعلاً
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

  // قراءة الـ raw body للـ HMAC verification
  const rawBody = await getRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const shopDomain = req.headers['x-shopify-shop-domain'];
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (secret && !verifyShopifyWebhook(rawBody, hmac, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // استخراج بيانات الأوردر من Shopify
  const customer = order.customer || {};
  const shipping = order.shipping_address || order.billing_address || {};
  const firstName = customer.first_name || '';
  const lastName = customer.last_name || '';
  const customerName = `${firstName} ${lastName}`.trim() || customer.email || 'عميل Shopify';

  const phone =
    order.phone ||
    customer.phone ||
    shipping.phone ||
    '';

  const address = [
    shipping.address1,
    shipping.address2,
    shipping.city,
  ]
    .filter(Boolean)
    .join(' - ');

  // تجميع المنتجات
  const items = (order.line_items || [])
    .map(i => `${i.name} × ${i.quantity}`)
    .join('\n');

  const orderId = `SH-${order.order_number || order.id}`;

  const orderData = {
    id: orderId,
    customer: customerName,
    phone: phone,
    address: address,
    page: 'اسيا', // الصفحة الافتراضية
    item: items,
    quantity: (order.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0),
    status: 'جاري التحضير',
    notes: order.note || '',
    productPrice: parseFloat(order.subtotal_price || 0),
    shippingPrice: parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0),
    trackingNumber: '',
    date: new Date(order.created_at).toISOString().split('T')[0],
    source: 'shopify',
    shopify_order_id: String(order.id),
    shopify_store: shopDomain || '',
  };

  // حفظ في Supabase (تجاهل لو موجود بالفعل)
  const { error } = await supabase
    .from('orders')
    .upsert([orderData], { onConflict: 'id' });

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, orderId });
}

// قراءة الـ raw body
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
