// ==========================================
// وحدة جلب البيانات — Data Fetching Module
// ==========================================
// دوال مساعدة لجلب البيانات من Supabase بطريقة مُحسّنة

/**
 * جلب البيانات على دفعات (Chunked Fetch) — لتجاوز حد 1000 صف
 * @param {string} table - اسم الجدول
 * @param {string} selectFields - الحقول المطلوبة
 * @param {object} options - خيارات إضافية
 * @returns {Promise<Array>} البيانات المجمعة
 */
async function fetchChunked(table, selectFields = '*', options = {}) {
    const { 
        filters = [], 
        orderBy = 'created_at', 
        ascending = false, 
        maxRows = 100000,
        chunkSize = 1000
    } = options;

    let from = 0;
    let collected = [];

    while (true) {
        let query = supabase.from(table).select(selectFields)
            .order(orderBy, { ascending })
            .range(from, from + chunkSize - 1);

        // تطبيق الفلاتر
        filters.forEach(f => {
            if (f.type === 'eq') query = query.eq(f.field, f.value);
            else if (f.type === 'in') query = query.in(f.field, f.value);
            else if (f.type === 'gte') query = query.gte(f.field, f.value);
            else if (f.type === 'lte') query = query.lte(f.field, f.value);
        });

        const { data, error } = await query;
        if (error) throw error;
        const batch = data || [];
        collected = collected.concat(batch);
        if (batch.length < chunkSize) break;
        from += chunkSize;
        if (from > maxRows) break; // safety guard
    }

    return collected;
}

/**
 * بحث شامل في جدول الأوردرات — بدون حد ثابت
 * يبحث في: ID، الاسم، الموبايل، البوليصة، العنوان، المنتج
 */
async function searchOrders(term) {
    if (!term || term.trim() === '') return [];
    
    const cleanTerm = term.trim();
    const CHUNK = 1000;
    let from = 0;
    let collected = [];
    const orQuery = `id.ilike.%${cleanTerm}%,customer.ilike.%${cleanTerm}%,phone.ilike.%${cleanTerm}%,"trackingNumber".ilike.%${cleanTerm}%,address.ilike.%${cleanTerm}%,item.ilike.%${cleanTerm}%`;
    
    while (true) {
        const { data, error } = await supabase.from('orders').select('*')
            .or(orQuery)
            .order('created_at', { ascending: false })
            .range(from, from + CHUNK - 1);
        if (error) throw error;
        const batch = data || [];
        collected = collected.concat(batch);
        if (batch.length < CHUNK) break;
        from += CHUNK;
        if (from > 50000) break;
    }
    
    // بحث بالـ ID الدقيق (exact match)
    if (collected.length === 0 || !collected.some(o => o.id === cleanTerm)) {
        const { data: exactMatch } = await supabase.from('orders')
            .select('*').eq('id', cleanTerm).maybeSingle();
        if (exactMatch && !collected.some(o => o.id === exactMatch.id)) {
            collected.unshift(exactMatch);
        }
    }
    
    return collected;
}

/**
 * جلب إحصائيات حقيقية من قاعدة البيانات
 * يحاول استخدام RPC أولاً، ولو فشل يحسب مباشرة
 */
async function fetchRealStatsFromDB() {
    try {
        const { data, error } = await supabase.rpc('get_real_stats');
        if (error || !data || data.length === 0) throw error || new Error('No data from RPC');
        return {
            total: data[0].total_orders || 0,
            processing: data[0].processing_orders || 0,
            delivered: data[0].delivered_orders || 0,
            revenue: data[0].total_revenue || 0
        };
    } catch(e) {
        console.warn('Real stats RPC failed, falling back to direct counts...', e);
        const processingStatuses = ['جاري التحضير','مراجعة','تاجيل'];
        const [totalRes, processingRes, deliveredRes] = await Promise.all([
            supabase.from('orders').select('id', { count: 'exact', head: true }),
            supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', processingStatuses),
            supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'تم'),
        ]);
        
        // إيرادات الطلبات المُسلَّمة على دفعات
        let revenue = 0;
        const CHUNK = 1000;
        let from = 0;
        while (true) {
            const { data: batch, error: batchErr } = await supabase
                .from('orders')
                .select('productPrice,shippingPrice')
                .eq('status', 'تم')
                .range(from, from + CHUNK - 1);
            if (batchErr || !batch || batch.length === 0) break;
            revenue += batch.reduce((s, o) => s + (Number(o.productPrice)||0) + (Number(o.shippingPrice)||0), 0);
            if (batch.length < CHUNK) break;
            from += CHUNK;
            if (from > 200000) break;
        }
        
        return {
            total: totalRes.count ?? 0,
            processing: processingRes.count ?? 0,
            delivered: deliveredRes.count ?? 0,
            revenue
        };
    }
}

// تصدير الدوال
window.CRMData = {
    fetchChunked,
    searchOrders,
    fetchRealStatsFromDB
};
