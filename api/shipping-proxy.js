// ==========================================
// Shipping Proxy — Vercel Serverless Function
// يتواصل مع موقع TwoWay Express لجلب بيانات الشحنات
// ==========================================

/**
 * Environment Variables المطلوبة على Vercel:
 * TWE_ASIA_USERNAME, TWE_ASIA_PASSWORD
 * TWE_UKIYO_USERNAME, TWE_UKIYO_PASSWORD
 */

const BASE_URL = 'https://www.twowayexpress.com';

// جلب صفحة تسجيل الدخول واستخراج ViewState و Cookies
async function getLoginPage() {
    const res = await fetch(`${BASE_URL}/Index`, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
        },
        redirect: 'manual',
    });
    const html = await res.text();
    const cookies = (res.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    
    // استخراج ViewState و EventValidation
    const viewState = extractHiddenField(html, '__VIEWSTATE');
    const viewStateGen = extractHiddenField(html, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHiddenField(html, '__EVENTVALIDATION');
    
    return { cookies, viewState, viewStateGen, eventValidation, html };
}

function extractHiddenField(html, fieldName) {
    const regex = new RegExp(`id="${fieldName}"\\s+value="([^"]*)"`, 'i');
    const match = html.match(regex);
    if (match) return match[1];
    // محاولة بديلة
    const regex2 = new RegExp(`name="${fieldName}"\\s+value="([^"]*)"`, 'i');
    const match2 = html.match(regex2);
    return match2 ? match2[1] : '';
}

// تسجيل الدخول والحصول على session cookies
async function login(username, password) {
    const loginPage = await getLoginPage();
    
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', loginPage.viewState);
    formData.append('__VIEWSTATEGENERATOR', loginPage.viewStateGen || '');
    formData.append('__EVENTVALIDATION', loginPage.eventValidation);
    formData.append('TxtUser', username);
    formData.append('TxtPassword', password);
    formData.append('LnkLogin', '');
    
    const res = await fetch(`${BASE_URL}/Index`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
            'Cookie': loginPage.cookies,
            'Referer': `${BASE_URL}/Index`,
        },
        redirect: 'manual',
        body: formData.toString(),
    });
    
    // جمع الـ cookies من كل الـ headers
    const newCookies = [];
    const setCookieHeaders = res.headers.raw?.()?.['set-cookie'] || [];
    if (typeof setCookieHeaders === 'string') {
        newCookies.push(setCookieHeaders.split(';')[0].trim());
    } else if (Array.isArray(setCookieHeaders)) {
        setCookieHeaders.forEach(c => newCookies.push(c.split(';')[0].trim()));
    }
    
    // Fallback: try getAll
    try {
        const allCookies = res.headers.getSetCookie?.() || [];
        allCookies.forEach(c => newCookies.push(c.split(';')[0].trim()));
    } catch(e) {}
    
    // ادمج مع cookies اللوجين الأولي
    const allCookieStr = [...loginPage.cookies.split('; ').filter(Boolean), ...newCookies.filter(Boolean)]
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('; ');
    
    // تحقق من نجاح اللوجين (redirect to home/clientorders)
    const location = res.headers.get('location') || '';
    const status = res.status;
    
    return {
        success: status === 302 || status === 301 || location.includes('client') || location.includes('home'),
        cookies: allCookieStr,
        redirectUrl: location,
    };
}

// جلب صفحة الشحنات وتحليل الجدول
async function fetchShipments(sessionCookies, statusFilter) {
    // بناء URL حسب الفلتر
    let url = `${BASE_URL}/clientorders`;
    
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
            'Cookie': sessionCookies,
            'Referer': `${BASE_URL}/clientorders`,
        },
        redirect: 'follow',
    });
    
    const html = await res.text();
    
    // تحقق إن الصفحة مش login page
    if (html.includes('TxtUser') && html.includes('TxtPassword')) {
        return { success: false, error: 'Session expired - need re-login', shipments: [] };
    }
    
    // تحليل الجدول
    const shipments = parseShipmentsTable(html);
    
    return { success: true, shipments, totalFound: shipments.length };
}

// تحليل HTML الجدول واستخراج بيانات الشحنات
function parseShipmentsTable(html) {
    const shipments = [];
    
    // البحث عن صفوف الجدول
    // كل صف في الجدول يحتوي على: رقم البوليصة، كود التاجر، تاريخ، حالة، مندوب، إلخ
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    
    let rows = [];
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const cells = [];
        let cellMatch;
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
            // تنظيف الـ HTML من الخلية
            let cellText = cellMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
            cells.push(cellText);
        }
        if (cells.length >= 5) {
            rows.push(cells);
        }
    }
    
    // تخطي header row إذا موجود
    // ترتيب الأعمدة المتوقع: رقم البوليصة، كود التاجر، تاريخ الدخول، شحنة استبدال، مندوب التوصيل، المسئول
    for (const cells of rows) {
        // تجاهل الصفوف الفارغة أو headers
        const firstCell = cells[0] || '';
        if (firstCell === 'رقم البوليصة' || firstCell === 'م' || firstCell === '#' || !firstCell) continue;
        
        // محاولة استخراج البيانات
        // الأعمدة: [م, رقم البوليصة, كود التاجر, تاريخ الدخول, شحنة استبدال, مندوب التوصيل, المسئول]
        // أو: [رقم البوليصة, كود التاجر, تاريخ الدخول, ...]
        
        let trackingNumber = '';
        let merchantCode = '';
        let entryDate = '';
        let status = '';
        let driver = '';
        
        if (cells.length >= 7) {
            // الصف يحتوي على رقم تسلسلي أول
            trackingNumber = cells[1] || '';
            merchantCode = cells[2] || '';
            entryDate = cells[3] || '';
            // cells[4] = شحنة استبدال
            driver = cells[5] || '';
            // cells[6] = المسئول
        } else if (cells.length >= 5) {
            trackingNumber = cells[0] || '';
            merchantCode = cells[1] || '';
            entryDate = cells[2] || '';
            driver = cells[3] || '';
        }
        
        // استخراج الحالة من class أو badge في الصف
        if (trackingNumber && /^\d+$/.test(trackingNumber.replace(/\s/g, ''))) {
            shipments.push({
                trackingNumber: trackingNumber.trim(),
                merchantCode: merchantCode.trim(),
                entryDate: entryDate.trim(),
                driver: driver.trim(),
                status: status || 'غير محدد',
            });
        }
    }
    
    return shipments;
}

// جلب حالة شحنة واحدة بالبحث
async function searchByTracking(sessionCookies, trackingNumber) {
    // محاولة البحث في الصفحة
    // أولاً نجلب كل الشحنات ونبحث فيها
    const result = await fetchShipments(sessionCookies);
    if (!result.success) return result;
    
    const found = result.shipments.filter(s => 
        s.trackingNumber === trackingNumber || 
        s.merchantCode === trackingNumber
    );
    
    return { success: true, shipments: found, totalFound: found.length };
}

// ==========================================
// جلب الشحنات حسب التاب/الحالة المحددة
// ==========================================
async function fetchShipmentsByStatus(sessionCookies, statusTab) {
    // لكل تاب في الموقع هنعمل PostBack مختلف
    // بس ممكن نعتمد على البحث في الـ URL أو query string
    // لو مش متاح، هنجلب كل الشحنات ونفلتر
    const result = await fetchShipments(sessionCookies);
    if (!result.success) return result;
    
    if (statusTab && statusTab !== 'الكل') {
        const filtered = result.shipments.filter(s => 
            s.status && s.status.includes(statusTab)
        );
        return { ...result, shipments: filtered, totalFound: filtered.length };
    }
    
    return result;
}

// ==========================================
// Main Handler
// ==========================================
module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { account, action, trackingNumber, statusFilter } = req.body || {};
        
        if (!account || !['ASIA', 'Ukiyo'].includes(account)) {
            return res.status(400).json({ error: 'Invalid account. Use ASIA or Ukiyo.' });
        }
        
        // الحصول على بيانات الدخول
        const username = account === 'ASIA' 
            ? (process.env.TWE_ASIA_USERNAME || 'اسيا')
            : (process.env.TWE_UKIYO_USERNAME || 'Ukiyo');
        const password = account === 'ASIA'
            ? (process.env.TWE_ASIA_PASSWORD || '0000')
            : (process.env.TWE_UKIYO_PASSWORD || '1482008');
        
        // تسجيل الدخول
        const loginResult = await login(username, password);
        
        if (!loginResult.success) {
            return res.status(401).json({ 
                error: 'Login failed', 
                details: `Could not login to TwoWay Express with account: ${account}`,
            });
        }
        
        // تنفيذ الإجراء المطلوب
        let result;
        
        switch (action) {
            case 'search':
                if (!trackingNumber) {
                    return res.status(400).json({ error: 'trackingNumber is required for search' });
                }
                result = await searchByTracking(loginResult.cookies, trackingNumber);
                break;
                
            case 'getByStatus':
                result = await fetchShipmentsByStatus(loginResult.cookies, statusFilter);
                break;
                
            case 'getAll':
            default:
                result = await fetchShipments(loginResult.cookies);
                break;
        }
        
        return res.status(200).json({
            success: result.success,
            account,
            shipments: result.shipments || [],
            totalFound: result.totalFound || 0,
            syncedAt: new Date().toISOString(),
        });
        
    } catch (error) {
        console.error('Shipping proxy error:', error);
        return res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message,
        });
    }
};
