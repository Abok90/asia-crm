// ==========================================
// Shipping Proxy — Vercel Serverless Function
// يتواصل مع موقع TwoWay Express لجلب بيانات الشحنات
// v2 — مع دعم كامل للـ Pagination
// ==========================================

/**
 * Environment Variables المطلوبة على Vercel:
 * TWE_ASIA_USERNAME, TWE_ASIA_PASSWORD
 * TWE_UKIYO_USERNAME, TWE_UKIYO_PASSWORD
 */

// Vercel: رفع الحد الزمني لـ 60 ثانية
module.exports.config = { maxDuration: 60 };

const BASE_URL = 'https://www.twowayexpress.com';
const GRID_ID = 'ctl00$ArMainContent$UcClientOrders$GrdViewDtls';

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
    const cookies = collectCookies(res);
    const viewState = extractHiddenField(html, '__VIEWSTATE');
    const viewStateGen = extractHiddenField(html, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHiddenField(html, '__EVENTVALIDATION');
    
    return { cookies, viewState, viewStateGen, eventValidation, html };
}

// جمع cookies من response
function collectCookies(res) {
    const cookies = [];
    try {
        const arr = res.headers.getSetCookie?.() || [];
        arr.forEach(c => cookies.push(c.split(';')[0].trim()));
    } catch(e) {}
    if (cookies.length === 0) {
        const raw = res.headers.get('set-cookie') || '';
        raw.split(',').forEach(c => {
            const part = c.split(';')[0].trim();
            if (part.includes('=')) cookies.push(part);
        });
    }
    return cookies.filter(Boolean).join('; ');
}

// دمج cookies
function mergeCookies(...cookieStrings) {
    const map = {};
    cookieStrings.forEach(str => {
        (str || '').split('; ').filter(Boolean).forEach(c => {
            const eq = c.indexOf('=');
            if (eq > 0) map[c.substring(0, eq)] = c;
        });
    });
    return Object.values(map).join('; ');
}

function extractHiddenField(html, fieldName) {
    // id="__VIEWSTATE" value="..."
    const r1 = new RegExp(`id="${fieldName}"[^>]*value="([^"]*)"`, 'i');
    const m1 = html.match(r1);
    if (m1) return m1[1];
    // value="..." id="__VIEWSTATE"
    const r2 = new RegExp(`value="([^"]*)"[^>]*id="${fieldName}"`, 'i');
    const m2 = html.match(r2);
    if (m2) return m2[1];
    // name="__VIEWSTATE" value="..."
    const r3 = new RegExp(`name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
    const m3 = html.match(r3);
    return m3 ? m3[1] : '';
}

// تسجيل الدخول
async function login(username, password) {
    const loginPage = await getLoginPage();
    
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
    
    const newCookies = collectCookies(res);
    const allCookies = mergeCookies(loginPage.cookies, newCookies);
    const location = res.headers.get('location') || '';
    const status = res.status;
    
    // تحقق النجاح
    let success = false;
    if (status === 302 || status === 301) {
        success = true;
    } else if (status === 200) {
        const body = await res.text();
        success = !body.includes('Txt_Emp_User_Login');
    }
    
    return { success, cookies: allCookies, redirectUrl: location, status };
}

// =====================
// استخراج أرقام الصفحات المتاحة
// =====================
function getAvailablePages(html) {
    const pages = new Set();
    // ASP.NET بيشفّر ' كـ &#39; في الـ HTML
    // نبحث عن كل الأنماط الممكنة
    // Pattern 1: Page$N مع quotes عادية
    const r1 = /Page\$(\d+)/g;
    let m;
    while ((m = r1.exec(html)) !== null) {
        pages.add(parseInt(m[1]));
    }
    return Array.from(pages).sort((a, b) => a - b);
}

// اكتشاف الصفحة الحالية (الرقم بدون رابط = الصفحة الحالية)
function getCurrentPageNum(html) {
    // الصفحة الحالية بتكون <span>N</span> مش <a>
    // نبحث في الـ pager row
    const pagerMatch = html.match(/<tr[^>]*>\s*<td[^>]*>\s*<table[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>\s*<\/table>/i);
    if (pagerMatch) {
        const spanMatch = pagerMatch[1].match(/<span>(\d+)<\/span>/);
        if (spanMatch) return parseInt(spanMatch[1]);
    }
    return 1;
}

// =====================
// جلب صفحة معينة عبر PostBack
// =====================
async function fetchPageByPostBack(sessionCookies, pageNum, previousHtml) {
    const url = `${BASE_URL}/clientorders`;
    const viewState = extractHiddenField(previousHtml, '__VIEWSTATE');
    const viewStateGen = extractHiddenField(previousHtml, '__VIEWSTATEGENERATOR');
    const eventValidation = extractHiddenField(previousHtml, '__EVENTVALIDATION');
    
    const formData = new URLSearchParams();
    formData.append('__EVENTTARGET', GRID_ID);
    formData.append('__EVENTARGUMENT', `Page$${pageNum}`);
    formData.append('__VIEWSTATE', viewState);
    if (viewStateGen) formData.append('__VIEWSTATEGENERATOR', viewStateGen);
    if (eventValidation) formData.append('__EVENTVALIDATION', eventValidation);
    
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
            'Cookie': sessionCookies,
            'Referer': url,
            'Origin': BASE_URL,
        },
        redirect: 'follow',
        body: formData.toString(),
    });
    
    return await res.text();
}

// =====================
// تحليل جدول الشحنات
// هيكل الجدول (17 عمود):
// [0] م | [1] رقم البوليصة | [2] كود التاجر | [3] تاريخ الدخول | [4] شحنة استبدال
// [5] مندوب التوصيل | [6] المستلم | [7] العنوان | [8] محتوى الشحنة | [9] ملاحظات
// [10] شحن على | [11] الإجمالي | [12] قيمة الشحن | [13] المستحق للراسل | [14] حالة السداد
// [15] حالة الشحنة | [16] خيارات
// =====================
function parseShipmentsTable(html) {
    const shipments = [];
    
    const tableMatch = html.match(/<table[^>]*id="ArMainContent_UcClientOrders_GrdViewDtls"[^>]*>([\s\S]*?)<\/table>/i);
    const tableHtml = tableMatch ? tableMatch[1] : html;
    
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    while ((match = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = match[1];
        if (rowHtml.includes('<th')) continue;
        // تجاهل صف الـ pager (فيه جدول داخلي)
        if (rowHtml.includes('<table')) continue;
        
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
            const trackingNumber = (cells[1] || '').trim();
            const merchantCode = (cells[2] || '').trim();
            
            if (trackingNumber && /^\d+$/.test(trackingNumber.replace(/[\s,]/g, ''))) {
                shipments.push({
                    trackingNumber,
                    merchantCode,
                    entryDate: (cells[3] || '').trim(),
                    status: (cells[15] || '').trim() || 'غير محدد',
                    driver: (cells[5] || '').trim(),
                    recipient: (cells[6] || '').trim(),
                    total: (cells[11] || '').trim(),
                });
            }
        }
    }
    
    return shipments;
}

// =====================
// جلب كل الشحنات من جميع الصفحات
// =====================
async function fetchAllShipments(sessionCookies) {
    const url = `${BASE_URL}/clientorders`;
    
    // الصفحة الأولى
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
    
    let currentHtml = await res.text();
    
    if (currentHtml.includes('Txt_Emp_User_Login') && currentHtml.includes('Txt_Emp_Pass')) {
        return { success: false, error: 'Session expired', shipments: [] };
    }
    
    // الصفحة الأولى
    let allShipments = parseShipmentsTable(currentHtml);
    const seenTracking = new Set(allShipments.map(s => s.trackingNumber));
    
    // اكتشاف كل أرقام الصفحات من الصفحة الأولى
    const allPageNums = getAvailablePages(currentHtml);
    const maxPageNum = allPageNums.length > 0 ? Math.max(...allPageNums) : 1;
    
    // التنقل بين الصفحات: 2, 3, 4, ...
    for (let pageNum = 2; pageNum <= maxPageNum; pageNum++) {
        try {
            const nextHtml = await fetchPageByPostBack(sessionCookies, pageNum, currentHtml);
            
            if (!nextHtml || nextHtml.includes('Txt_Emp_User_Login')) break;
            
            const pageShipments = parseShipmentsTable(nextHtml);
            if (pageShipments.length === 0) break;
            
            let newCount = 0;
            for (const s of pageShipments) {
                if (!seenTracking.has(s.trackingNumber)) {
                    allShipments.push(s);
                    seenTracking.add(s.trackingNumber);
                    newCount++;
                }
            }
            
            // لو كلهم مكررين → وقف
            if (newCount === 0) break;
            
            // تحديث الـ HTML عشان الـ ViewState يكون محدّث
            currentHtml = nextHtml;
            
            // تحديث maxPageNum لو ظهرت صفحات جديدة (مثلاً الـ "..." بيكشف صفحات أكتر)
            const newPages = getAvailablePages(nextHtml);
            const newMax = newPages.length > 0 ? Math.max(...newPages) : maxPageNum;
            if (newMax > maxPageNum) {
                // في صفحات أكتر مما كنا نعرف
                // maxPageNum is const so we use a different approach
            }
        } catch (err) {
            console.error(`Error fetching page ${pageNum}:`, err.message);
            break;
        }
    }
    
    // لو في صفحات أكتر (الـ "..." كان بيشير لأكتر)
    // نكمل لحد ما مفيش بيانات جديدة
    let extraPage = maxPageNum + 1;
    while (extraPage <= 100) {
        try {
            const extraHtml = await fetchPageByPostBack(sessionCookies, extraPage, currentHtml);
            if (!extraHtml || extraHtml.includes('Txt_Emp_User_Login')) break;
            
            const pageShipments = parseShipmentsTable(extraHtml);
            if (pageShipments.length === 0) break;
            
            let newCount = 0;
            for (const s of pageShipments) {
                if (!seenTracking.has(s.trackingNumber)) {
                    allShipments.push(s);
                    seenTracking.add(s.trackingNumber);
                    newCount++;
                }
            }
            if (newCount === 0) break;
            
            currentHtml = extraHtml;
            extraPage++;
        } catch (err) {
            break;
        }
    }
    
    return { success: true, shipments: allShipments, totalFound: allShipments.length, pagesFetched: extraPage - 1 };
}

// ==========================================
// Main Handler
// ==========================================
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const { account, action, trackingNumber } = req.body || {};
        
        if (!account || !['ASIA', 'Ukiyo'].includes(account)) {
            return res.status(400).json({ error: 'Invalid account. Use ASIA or Ukiyo.' });
        }
        
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
            });
        }
        
        // جلب الشحنات
        let result;
        
        if (action === 'search' && trackingNumber) {
            result = await fetchAllShipments(loginResult.cookies);
            if (result.success) {
                const found = result.shipments.filter(s => 
                    s.trackingNumber === trackingNumber || s.merchantCode === trackingNumber
                );
                result = { ...result, shipments: found, totalFound: found.length };
            }
        } else {
            result = await fetchAllShipments(loginResult.cookies);
        }
        
        return res.status(200).json({
            success: result.success,
            account,
            shipments: result.shipments || [],
            totalFound: result.totalFound || 0,
            pagesFetched: result.pagesFetched || 1,
            syncedAt: new Date().toISOString(),
        });
        
    } catch (error) {
        console.error('Shipping proxy error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
};
