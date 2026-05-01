// ==========================================
// دوال مساعدة (Helpers)
// ==========================================

/**
 * تحويل التاريخ لصيغة ISO (YYYY-MM-DD) مع دعم الأرقام العربية
 */
const normalizeDate = (dateStr) => {
    if (!dateStr) return '';
    const arabicNums = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    let d = String(dateStr).replace(/[٠-٩]/g, w => arabicNums.indexOf(w));
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
    const parts = d.split(/[\/\-]/);
    if (parts.length === 3) {
        const [y, m, day] = parts;
        return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }
    return d;
};

/**
 * جلب تاريخ ISO من كائن الأوردر
 */
const getIsoDate = (o) => {
    const d = normalizeDate(o.date) || o.date || '';
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
    return o.created_at ? o.created_at.split('T')[0] : '';
};

/**
 * تحويل الأرقام العربية إلى إنجليزية
 */
const toEnglishDigits = (str) => {
    const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(str).replace(/[٠-٩]/g, w => arabicNumbers.indexOf(w));
};

/**
 * حساب العمليات الحسابية البسيطة بدون new Function() أو eval()
 */
const safeMathEval = (expr) => {
    const str = toEnglishDigits(expr).replace(/[^0-9+\-*/.]/g, '').trim();
    if (!str) return NaN;
    let i = 0;
    const parseExpr = () => {
        let val = parseTerm();
        while (i < str.length && (str[i] === '+' || str[i] === '-')) {
            const op = str[i++];
            val = op === '+' ? val + parseTerm() : val - parseTerm();
        }
        return val;
    };
    const parseTerm = () => {
        let val = parseUnary();
        while (i < str.length && (str[i] === '*' || str[i] === '/')) {
            const op = str[i++];
            const right = parseUnary();
            if (op === '/' && right === 0) return NaN;
            val = op === '*' ? val * right : val / right;
        }
        return val;
    };
    const parseUnary = () => {
        if (str[i] === '-') { i++; return -parsePrimary(); }
        return parsePrimary();
    };
    const parsePrimary = () => {
        let numStr = '';
        while (i < str.length && /[0-9.]/.test(str[i])) numStr += str[i++];
        return numStr ? parseFloat(numStr) : NaN;
    };
    try {
        const result = parseExpr();
        return (i === str.length && !isNaN(result)) ? result : NaN;
    } catch (e) { return NaN; }
};

/**
 * معالجة المدخلات الرقمية
 */
const handleNumericChange = (val, updater) => {
    let englishVal = toEnglishDigits(val).replace(/[^0-9.\-+*/]/g, '');
    updater(englishVal);
};

/**
 * معالجة مدخلات رقم الهاتف
 */
const handlePhoneChange = (val, updater) => {
    let englishVal = toEnglishDigits(val).replace(/\D/g, '');
    if(englishVal.length > 11) englishVal = englishVal.slice(0, 11);
    updater(englishVal);
};

/**
 * إنشاء رسالة للعميل بعد حفظ الطلب
 */
const generateCustomerMsg = (order) => {
    if (!order) return '';
    const total = (Number(order.productPrice) || 0) + (Number(order.shippingPrice) || 0);
    return `✅ تم استلام طلبك بنجاح!\n${'─'.repeat(24)}\n🏪 ${order.page || ''}\n📦 رقم الطلب: ${order.id}\n👤 الاسم: ${order.customer}\n📱 الموبايل: ${order.phone}\n🛍️ المنتج: ${order.item}\n📍 العنوان: ${order.address}\n${'─'.repeat(24)}\n💰 سعر المنتجات: ${Number(order.productPrice) || 0} ج.م\n🚚 سعر الشحن: ${Number(order.shippingPrice) || 0} ج.م\n💵 الإجمالي: ${total} ج.م${order.trackingNumber ? `\n\n📬 رقم البوليصة: ${order.trackingNumber}` : ''}\n${'─'.repeat(24)}\nشكراً لتعاملك معنا 🙏`;
};

/**
 * إنشاء رسالة شحنة جديدة
 */
const generateShippingMsg = (order) => {
    if (!order) return '';
    const total = (Number(order.productPrice) || 0) + (Number(order.shippingPrice) || 0);
    return `📦 شحنة جديدة\n${'─'.repeat(24)}\n🏪 الصفحة: ${order.page || ''}\n🔢 رقم الطلب: ${order.id}\n👤 اسم العميل: ${order.customer}\n📱 الموبايل: ${order.phone}\n📍 العنوان: ${order.address}\n🛍️ محتوى الشحنة: ${order.item}\n${'─'.repeat(24)}\n💵 قيمة التحصيل: ${total} ج.م${order.notes ? `\n📝 ملاحظات: ${order.notes}` : ''}\n${'─'.repeat(24)}`;
};

/**
 * تنظيف HTML لمنع XSS
 */
const escapeHtml = (str) => String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/**
 * تحليل ملف CSV
 */
const parseCSV = (text) => {
    const result = []; let row = []; let inQuotes = false; let currentVal = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) { if (char === '"') { if (text[i+1] === '"') { currentVal += '"'; i++; } else { inQuotes = false; } } else { currentVal += char; } } 
        else { if (char === '"') { inQuotes = true; } else if (char === ',') { row.push(currentVal.trim()); currentVal = ''; } else if (char === '\n' || char === '\r') { row.push(currentVal.trim()); result.push(row); row = []; currentVal = ''; if (char === '\r' && text[i+1] === '\n') i++; } else { currentVal += char; } }
    }
    if (currentVal || row.length) { row.push(currentVal.trim()); result.push(row); }
    return result.filter(r => r.some(cell => cell && cell.trim() !== '')); 
};

/**
 * كشف تلقائي لأعمدة ملف CSV
 */
const autoDetectMapping = (headers) => {
    const find = (...keywords) => headers.find(h => keywords.some(k => h && h.toString().includes(k))) || '';
    return {
        id:             find('كود التاجر', 'رقم الاوردر', 'رقم الطلب', 'كود'),
        customer:       find('اسم المستلم', 'اسم العميل', 'المستلم'),
        phone:          find('موبايل المستلم', 'موبايل العميل', 'موبايل', 'تليفون', 'هاتف'),
        region:         find('المنطقة', 'المنطقه', 'المنطقه'),
        address:        find('العنوان') || find('المنطقة', 'المنطقه'),
        item:           find('محتوى الشحنة', 'محتوي الشحنه', 'محتوى', 'المنتج', 'الوصف', 'الصنف'),
        productPrice:   find('قيمة الشحنة', 'قيمه الشحنه', 'قيمة', 'السعر', 'المبلغ'),
        shippingPrice:  find('سعر الشحن', 'شحن'),
        trackingNumber: find('بوليصة', 'بوليصه', 'رقم البوليصة', 'tracking'),
        status:         find('الحالة', 'الحاله', 'status'),
        date:           find('التاريخ', 'date'),
        notes:          find('ملاحظات', 'ملاحظه', 'notes'),
    };
};

/**
 * ألوان الحالة للجدول
 */
const getRowStatusColor = (status) => {
    switch(status) {
        case 'جاري التحضير': return 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200';
        case 'تم': return 'bg-green-50 hover:bg-green-100 text-green-900 border-green-200';
        case 'الشحن': return 'bg-orange-50 hover:bg-orange-100 text-orange-900 border-orange-200';
        case 'مراجعة': return 'bg-yellow-50 hover:bg-yellow-100 text-yellow-900 border-yellow-200';
        case 'استبدال': return 'bg-purple-50 hover:bg-purple-100 text-purple-900 border-purple-200';
        case 'مرتجع': return 'bg-rose-50 hover:bg-rose-100 text-rose-900 border-rose-200';
        case 'الغاء': return 'bg-red-50 hover:bg-red-100 text-red-900 border-red-200';
        case 'تاجيل': return 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300';
        case 'اعادة ارسال': return 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200';
        case 'خارجي': return 'bg-teal-50 hover:bg-teal-100 text-teal-900 border-teal-200';
        default: return 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200';
    }
};

/**
 * ألوان حالة الـ select
 */
const getSelectStatusColor = (status) => {
     switch(status) {
        case 'جاري التحضير': return 'text-sky-800 border-sky-300 bg-white/60';
        case 'تم': return 'text-green-800 border-green-300 bg-white/60';
        case 'الشحن': return 'text-orange-800 border-orange-300 bg-white/60';
        case 'مراجعة': return 'text-yellow-800 border-yellow-300 bg-white/60';
        case 'استبدال': return 'text-purple-800 border-purple-300 bg-white/60';
        case 'مرتجع': return 'text-rose-800 border-rose-300 bg-white/60';
        case 'الغاء': return 'text-red-800 border-red-300 bg-white/60';
        case 'تاجيل': return 'text-slate-700 border-slate-400 bg-white/60';
        case 'اعادة ارسال': return 'text-sky-800 border-sky-300 bg-white/60';
        case 'خارجي': return 'text-teal-800 border-teal-300 bg-white/60';
        default: return 'text-slate-800 border-slate-300 bg-white/60';
    }
};

/**
 * ألوان الثيم
 */
const getThemeClasses = (p) => ({ btnPrimary: 'bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-200', textPrimary: 'text-sky-600', border: 'border-sky-200', bgLight: 'bg-sky-50', ringFocus: 'focus:ring-sky-500' });
