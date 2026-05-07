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
    
    // جمع كل الـ cookies
    const cookies = [];
    try {
        const setCookieHeaders = res.headers.getSetCookie?.() || [];
        setCookieHeaders.forEach(c => cookies.push(c.split(';')[0].trim()));
    } catch(e) {}
    if (cookies.length === 0) {
        const raw = res.headers.get('set-cookie') || '';
        raw.split(',').forEach(c => {
            const part = c.split(';')[0].trim();
            if (part.includes('=')) cookies.push(part);
        });
    }
    
    // استخراج ViewState و EventValidation
    const viewState = extractHiddenField(html, '__VIEWSTATE');
    const viewStateGen = extractHiddenField(html, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHiddenField(html, '__EVENTVALIDATION');
    
    return { cookies: cookies.filter(Boolean).join('; '), viewState, viewStateGen, eventValidation, html };
}

function extractHiddenField(html, fieldName) {
    // محاولة 1: id="__VIEWSTATE" value="..."
    const r1 = new RegExp(`id="${fieldName}"[^>]*value="([^"]*)"`, 'i');
    const m1 = html.match(r1);
    if (m1) return m1[1];
    // محاولة 2: name="__VIEWSTATE" value="..."
    const r2 = new RegExp(`name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
    const m2 = html.match(r2);
    if (m2) return m2[1];
    // محاولة 3: value="..." id="__VIEWSTATE"
    const r3 = new RegExp(`value="([^"]*)"[^>]*id="${fieldName}"`, 'i');
    const m3 = html.match(r3);
    return m3 ? m3[1] : '';
}

// تسجيل الدخول والحصول على session cookies
async function login(username, password) {
    const loginPage = await getLoginPage();
    
    // ASP.NET PostBack: __EVENTTARGET = LnkLogin
    const formData = new URLSearchParams();
    formData.append('__EVENTTARGET', 'LnkLogin');
    formData.append('__EVENTARGUMENT', '');
    formData.append('__VIEWSTATE', loginPage.viewState);
    if (loginPage.viewStateGen) formData.append('__VIEWSTATEGENERATOR', loginPage.viewStateGen);
    if (loginPage.eventValidation) formData.append('__EVENTVALIDATION', loginPage.eventValidation);
    formData.append('Txt_Emp_User_Login', username);
    formData.append('Txt_Emp_Pass', password);
    
    const res = await fetch(`${BASE_URL}/Index`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
            'Cookie': loginPage.cookies,
            'Referer': `${BASE_URL}/Index`,
            'Origin': BASE_URL,
        },
        redirect: 'manual',
        body: formData.toString(),
    });
    
    // جمع الـ cookies الجديدة
    const newCookies = [];
    try {
        const setCookieHeaders = res.headers.getSetCookie?.() || [];
        setCookieHeaders.forEach(c => newCookies.push(c.split(';')[0].trim()));
    } catch(e) {}
    if (newCookies.length === 0) {
        const raw = res.headers.get('set-cookie') || '';
        raw.split(',').forEach(c => {
            const part = c.split(';')[0].trim();
            if (part.includes('=')) newCookies.push(part);
        });
    }
    
    // دمج كل الـ cookies
    const cookieMap = {};
    [...loginPage.cookies.split('; '), ...newCookies].filter(Boolean).forEach(c => {
        const eq = c.indexOf('=');
        if (eq > 0) cookieMap[c.substring(0, eq)] = c;
    });
    const allCookieStr = Object.values(cookieMap).join('; ');
    
    // تحقق من نجاح اللوجين
    const location = res.headers.get('location') || '';
    const status = res.status;
    
    // إذا 302 أو redirect → نجاح
    // إذا 200 → ممكن لسه في صفحة اللوجين (فشل) أو اتنقل لصفحة الهوم
    const responseBody = status === 200 ? await res.text() : '';
    const isStillOnLogin = responseBody.includes('Txt_Emp_User_Login') && responseBody.includes('Txt_Emp_Pass');
    
    const success = (status === 302 || status === 301) || 
                    (location && (location.includes('client') || location.includes('home') || location.includes('Home'))) ||
                    (status === 200 && !isStillOnLogin);
    
    return {
        success,
        cookies: allCookieStr,
        redirectUrl: location,
        status,
    };
}

// جلب صفحة الشحنات وتحليل الجدول
async function fetchShipments(sessionCookies) {
    const url = `${BASE_URL}/clientorders`;
    
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
            'Cookie': sessionCookies,
            'Referer': `${BASE_URL}/clienthome`,
        },
        redirect: 'follow',
    });
    
    const html = await res.text();
    
    // تحقق إن الصفحة مش login page
    if (html.includes('Txt_Emp_User_Login') && html.includes('Txt_Emp_Pass')) {
        return { success: false, error: 'Session expired - need re-login', shipments: [] };
    }
    
    // تحليل الجدول
    const shipments = parseShipmentsTable(html);
    
    return { success: true, shipments, totalFound: shipments.length };
}

// تحليل HTML الجدول واستخراج بيانات الشحنات
// هيكل الجدول (17 عمود):
// [0] م | [1] رقم البوليصة | [2] كود التاجر | [3] تاريخ الدخول | [4] شحنة استبدال
// [5] مندوب التوصيل | [6] المستلم | [7] العنوان | [8] محتوى الشحنة | [9] ملاحظات
// [10] شحن على | [11] الإجمالي | [12] قيمة الشحن | [13] المستحق للراسل | [14] حالة السداد
// [15] حالة الشحنة | [16] خيارات
function parseShipmentsTable(html) {
    const shipments = [];
    
    // البحث عن الجدول بـ ID المحدد
    const tableMatch = html.match(/<table[^>]*id="ArMainContent_UcClientOrders_GrdViewDtls"[^>]*>([\s\S]*?)<\/table>/i);
    const tableHtml = tableMatch ? tableMatch[1] : html;
    
    // استخراج كل الصفوف
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rows = [];
    let match;
    while ((match = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = match[1];
        // تجاهل صفوف الـ header (th)
        if (rowHtml.includes('<th')) continue;
        
        const cells = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
            let cellText = cellMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code))
                .replace(/\s+/g, ' ')
                .trim();
            cells.push(cellText);
        }
        if (cells.length >= 10) {
            rows.push(cells);
        }
    }
    
    // معالجة كل صف
    for (const cells of rows) {
        const serialNum = cells[0] || '';
        // تجاهل headers أو صفوف فارغة
        if (serialNum === 'م' || serialNum === '#' || serialNum === '') continue;
        
        const trackingNumber = (cells[1] || '').trim();
        const merchantCode = (cells[2] || '').trim();
        const entryDate = (cells[3] || '').trim();
        const isReplacement = (cells[4] || '').trim();
        const driver = (cells[5] || '').trim();
        const recipient = (cells[6] || '').trim();
        const address = (cells[7] || '').trim();
        const contents = (cells[8] || '').trim();
        const notes = (cells[9] || '').trim();
        const shippingOn = (cells[10] || '').trim();
        const total = (cells[11] || '').trim();
        const shippingCost = (cells[12] || '').trim();
        const sellerDue = (cells[13] || '').trim();
        const paymentStatus = (cells[14] || '').trim();
        const shipmentStatus = (cells[15] || '').trim();
        
        // تحقق إن الـ tracking number رقمي
        if (trackingNumber && /^\d+$/.test(trackingNumber.replace(/[\s,]/g, ''))) {
            shipments.push({
                trackingNumber,
                merchantCode,
                entryDate,
                status: shipmentStatus || 'غير محدد',
                driver,
                recipient,
                contents,
                total,
                shippingCost,
                paymentStatus,
            });
        }
    }
    
    return shipments;
}

// جلب حالة شحنة واحدة بالبحث
async function searchByTracking(sessionCookies, trackingNumber) {
    const result = await fetchShipments(sessionCookies);
    if (!result.success) return result;
    
    const found = result.shipments.filter(s => 
        s.trackingNumber === trackingNumber || 
        s.merchantCode === trackingNumber
    );
    
    return { success: true, shipments: found, totalFound: found.length };
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
        const { account, action, trackingNumber } = req.body || {};
        
        if (!account || !['ASIA', 'Ukiyo'].includes(account)) {
            return res.status(400).json({ error: 'Invalid account. Use ASIA or Ukiyo.' });
        }
        
        // الحصول على بيانات الدخول من Environment Variables
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
                httpStatus: loginResult.status,
                redirectUrl: loginResult.redirectUrl,
            });
        }
        
        // جلب الشحنات
        let result;
        
        if (action === 'search' && trackingNumber) {
            result = await searchByTracking(loginResult.cookies, trackingNumber);
        } else {
            result = await fetchShipments(loginResult.cookies);
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
