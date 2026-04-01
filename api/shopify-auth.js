// صفحة OAuth callback - بتجيب الـ Access Token من Shopify
export default async function handler(req, res) {
  const { code, shop } = req.query;

  if (!code || !shop) {
    return res.status(400).send('Missing code or shop');
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      return res.status(400).json({ error: 'Failed to get token', data });
    }

    // عرض الـ token للمستخدم عشان ينسخه ويحطه في Vercel
    return res.status(200).send(`
      <html dir="rtl">
        <body style="font-family: sans-serif; padding: 40px; background: #0f172a; color: white; text-align: center;">
          <h2 style="color: #4ade80;">✅ تم بنجاح!</h2>
          <p>المتجر: <strong>${shop}</strong></p>
          <p style="margin-bottom: 10px;">الـ Access Token (انسخه وحطه في Vercel):</p>
          <div style="background: #1e293b; padding: 16px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 14px; color: #38bdf8; border: 1px solid #334155;">
            ${data.access_token}
          </div>
          <p style="margin-top: 20px; color: #94a3b8; font-size: 13px;">
            ⚠️ انسخه دلوقتي وحطه في Vercel كـ SHOPIFY_ACCESS_TOKEN<br/>
            بعد كده أضف المتجر: SHOPIFY_STORE = ${shop}
          </p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send('Error: ' + err.message);
  }
}
