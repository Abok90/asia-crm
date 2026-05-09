// ==========================================
// إعدادات قاعدة البيانات Supabase
// ==========================================
// ملاحظة أمنية: مفتاح anon في Supabase مصمم ليكون public في كود الواجهة الأمامية.
// الأمان الحقيقي يعتمد على سياسات Row Level Security (RLS) في لوحة تحكم Supabase.
// تأكد من تفعيل RLS على جميع الجداول في: Supabase Dashboard > Authentication > Policies
const SUPABASE_URL = 'https://jdmcesvbkigpxywmoflb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nZ2KyDI7ceAjTx8wOMOtCQ_MK4bviLJ';
// ⚙️ إعدادات الحماية — يجب تغييرها من Supabase Dashboard وليس من هنا
const OWNER_EMAIL = 'ahmedsayed328@gmail.com';
const PROTECTED_USER_IDS = []; // ← أضف IDs المحمية لو محتاج

// ==========================================
// إعدادات العرض والحدود
// ==========================================
const DISPLAY_LIMIT = 500; // الحد الأقصى لعرض الأوردرات
const HISTORY_DAYS = 90; // الأيام المرجعية للعرض الأولي

// ==========================================
// الصفحات والحالات والتصنيفات
// ==========================================
const pages = ['ASIA', 'Ukiyo'];
const orderStatuses = ['جاري التحضير', 'تم', 'الشحن', 'مراجعة', 'استبدال', 'مرتجع', 'الغاء', 'تاجيل', 'اعادة ارسال', 'خارجي'];

const EXPENSE_CATEGORIES = ['إعلانات ASIA', 'إعلانات Ukiyo', 'مرتبات', 'سلف', 'مستلزمات', 'انتقالات', 'موديل وبلوجر', 'اشتراكات', 'صيانة', 'اكراميات', 'مرافق', 'ايجار', 'مرتجعات', 'تعاملات قانونية', 'مصاريف شحن', 'حساب شخصي', 'أخرى'];
const INCOME_CATEGORIES = ['شحن عايده', 'شحن اوفر', 'شحن مكتب', 'أخرى'];
const DEPARTMENTS = ['أونلاين'];

// ==========================================
// الأدوار والصلاحيات
// ==========================================
const ROLE_NAMES = { admin: 'مدير النظام', owner: 'صاحب البراندات', social_manager: 'مديرة السوشيال ميديا', media_buyer: 'مدير الميديا باير', page_manager: 'مدير البيدجات', agent: 'Operations' };
const SUPER_ADMIN_ROLES = ['admin', 'owner', 'social_manager', 'media_buyer'];
const FINANCE_ROLES = ['admin', 'owner'];

// ==========================================
// منتجات ASIA الافتراضية
// ==========================================
const initialSeedProducts = [
    { name: 'تيشيرت صيفي بيسيك قطن 100%', price: 250, colors: 'أبيض,أسود,كحلي,رمادي', sizes: 'M,L,XL,XXL', image: '' },
    { name: 'قميص كاجوال رجالي أوكسفورد', price: 450, colors: 'أزرق فاتح,رمادي,أبيض,زيتي', sizes: 'L,XL,XXL', image: '' }
];

// ==========================================
// حالة الطلب الافتراضية
// ==========================================
const initialOrderState = { id: '', customer: '', address: '', phone: '', notes: '', page: pages[0], item: '', quantity: '1', productPrice: '', shippingPrice: '', trackingNumber: '', status: 'جاري التحضير', date: '' };
const emptyBulkRow = { id: '', customer: '', address: '', item: '', trackingNumber: '', notes: '', phone: '', status: 'جاري التحضير', shippingPrice: '', productPrice: '', date: '' };

// ==========================================
// تهيئة Supabase Client
// ==========================================
// خيارات auth صريحة لضمان استمرارية الجلسة وتجديد التوكن تلقائياً
// (يمنع تسجيل الخروج المفاجئ على اللاب توب عند فشل تجديد التوكن)
let supabase = null;
if (SUPABASE_URL.startsWith('http')) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
        }
    });
}
