-- ==========================================
-- جدول حالات الشحن — TwoWay Express Integration
-- أضف هذا في Supabase Dashboard > SQL Editor
-- ==========================================

CREATE TABLE IF NOT EXISTS shipping_status (
    id SERIAL PRIMARY KEY,
    order_id TEXT,                    -- كود التاجر (رقم الطلب)
    tracking_number TEXT UNIQUE,      -- رقم البوليصة (مفتاح فريد)
    shipping_company TEXT DEFAULT 'TwoWay Express',
    shipping_status TEXT,             -- حالة الشحن من الشركة
    driver_name TEXT,                 -- اسم المندوب
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    page TEXT,                        -- ASIA أو Ukiyo
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index للبحث السريع
CREATE INDEX IF NOT EXISTS idx_shipping_tracking ON shipping_status(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_order_id ON shipping_status(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_page ON shipping_status(page);

-- RLS Policy - السماح للمستخدمين المسجلين بالقراءة والكتابة
ALTER TABLE shipping_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read shipping_status"
ON shipping_status FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert shipping_status"
ON shipping_status FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update shipping_status"
ON shipping_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
