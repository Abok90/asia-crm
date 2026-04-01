// Vercel Serverless Function
// ينفذ actions على Shopify (fulfill / cancel / update)
// يستخدم GraphQL API (2025-01+) لأن REST اتبعد من ديسمبر 2025
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function shopifyGraphQL(store, accessToken, query, variables = {}) {
  const url = `https://${store}/admin/api/2026-01/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// تحويل رقم الأوردر لـ GID
function toOrderGID(id) {
  return `gid://shopify/Order/${id}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, shopifyOrderId, shopifyStore, note, status, customer, phone, address } = req.body;

  if (!shopifyOrderId || !shopifyStore) {
    return res.status(400).json({ error: 'Missing shopifyOrderId or shopifyStore' });
  }

  // جلب Access Token من environment variables
  // اسم المتغير: SHOPIFY_TOKEN_<domain بدون نقط>
  // مثال: store.myshopify.com → SHOPIFY_TOKEN_STOREMYSHOPIFYCOM
  const envKey = 'SHOPIFY_TOKEN_' + shopifyStore.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const accessToken = process.env[envKey] || process.env.SHOPIFY_ACCESS_TOKEN;

  if (!accessToken) {
    return res.status(500).json({ error: `No access token found for store: ${shopifyStore}` });
  }

  const orderGID = toOrderGID(shopifyOrderId);

  try {
    if (action === 'update') {
      // تحديث الملاحظة على الأوردر
      const mutation = `
        mutation orderUpdate($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id note }
            userErrors { field message }
          }
        }
      `;
      const result = await shopifyGraphQL(shopifyStore, accessToken, mutation, {
        input: { id: orderGID, note: note || '' },
      });
      const errors = result?.data?.orderUpdate?.userErrors;
      if (errors?.length) return res.status(400).json({ error: errors });
      return res.status(200).json({ success: true });
    }

    if (action === 'fulfill') {
      // الخطوة 1: جلب fulfillment orders
      const foQuery = `
        query getFulfillmentOrders($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 5) {
              nodes { id status }
            }
          }
        }
      `;
      const foResult = await shopifyGraphQL(shopifyStore, accessToken, foQuery, { id: orderGID });
      const fulfillmentOrders = foResult?.data?.order?.fulfillmentOrders?.nodes || [];
      const openFO = fulfillmentOrders.find(fo => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS');

      if (!openFO) {
        return res.status(200).json({ success: true, note: 'No open fulfillment order found' });
      }

      // الخطوة 2: تنفيذ الشحن باستخدام GraphQL
      const fulfillMutation = `
        mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }
      `;
      const fulfillResult = await shopifyGraphQL(shopifyStore, accessToken, fulfillMutation, {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: openFO.id }],
          notifyCustomer: true,
        },
      });
      const fulfillErrors = fulfillResult?.data?.fulfillmentCreate?.userErrors;
      if (fulfillErrors?.length) return res.status(400).json({ error: fulfillErrors });
      return res.status(200).json({ success: true });
    }

    if (action === 'cancel') {
      const mutation = `
        mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
          orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
            orderCancelUserErrors { field message code }
          }
        }
      `;
      const result = await shopifyGraphQL(shopifyStore, accessToken, mutation, {
        orderId: orderGID,
        reason: 'CUSTOMER',
        refund: false,
        restock: true,
      });
      const errors = result?.data?.orderCancel?.orderCancelUserErrors;
      if (errors?.length) return res.status(400).json({ error: errors });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('shopify-action error:', err);
    return res.status(500).json({ error: err.message });
  }
}
