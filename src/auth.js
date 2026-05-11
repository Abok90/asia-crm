// ==========================================
// وحدة المصادقة وإدارة الجلسات — Auth Module
// ==========================================
// تعمل مع Supabase Auth وتوفر دوال مساعدة للتحقق من الجلسات

/**
 * تسجيل الدخول
 */
async function authLogin(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return true;
}

/**
 * تسجيل الخروج
 */
async function authLogout() {
    try { await supabase.auth.signOut(); } catch(e) { console.error('Sign out error:', e); }
    window.location.reload();
}

/**
 * إنشاء حساب جديد — يحاول إنشاء سجل user_roles بطرق متعددة لضمان النجاح
 */
async function authSignup(email, password, name) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    
    const userId = data?.user?.id;
    if (!userId) throw new Error('حدث خطأ غير متوقع. حاول مرة أخرى.');
    
    const roleRecord = { id: userId, name: name.trim(), role: 'agent', is_approved: false, email };
    
    // محاولة 1: INSERT مباشر
    const { error: insertErr } = await supabase.from('user_roles').insert([roleRecord]);
    if (!insertErr) { console.log('✅ user_roles record created via INSERT'); }
    else {
        // محاولة 2: UPSERT
        console.warn('⚠️ INSERT failed, trying UPSERT:', insertErr?.message);
        const { error: upsertErr } = await supabase.from('user_roles').upsert([roleRecord], { onConflict: 'id' });
        if (!upsertErr) { console.log('✅ user_roles record created via UPSERT'); }
        else {
            // محاولة 3: تأخير ثم UPSERT
            console.error('❌ UPSERT also failed:', upsertErr?.message);
            await new Promise(r => setTimeout(r, 1500));
            const { error: retryErr } = await supabase.from('user_roles').upsert([roleRecord], { onConflict: 'id' });
            if (retryErr) console.error('❌ All attempts to create user_roles failed:', retryErr?.message);
            else console.log('✅ user_roles record created via RETRY UPSERT');
        }
    }
    
    return {
        user: data?.user,
        needsEmailConfirm: data?.user && !data?.session
    };
}

/**
 * فحص صحة الجلسة وتجديد الـ token لو قارب على الانتهاء
 */
async function checkSessionHealth() {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
            console.warn('Session lost — attempting silent refresh...');
            const { data: refreshResult, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError || !refreshResult?.session) {
                console.error('Session refresh failed:', refreshError);
                return { healthy: false, error: refreshError };
            }
            return { healthy: true, refreshed: true };
        }
        // تحقق من أن الـ token مش هينتهي خلال 5 دقائق
        const expiresAt = session.expires_at;
        if (expiresAt) {
            const remaining = expiresAt * 1000 - Date.now();
            if (remaining < 5 * 60 * 1000) {
                console.log('Token expiring soon, proactively refreshing...');
                await supabase.auth.refreshSession();
                return { healthy: true, refreshed: true };
            }
        }
        return { healthy: true };
    } catch (e) {
        console.error('Session check error:', e);
        return { healthy: false, error: e };
    }
}

/**
 * جلب دور المستخدم من جدول user_roles
 */
async function fetchUserRoleFromDB(userId, userEmail) {
    const { data, error } = await supabase.from('user_roles').select('*').eq('id', userId).maybeSingle();
    if (error) console.error('fetchUserRole SELECT error:', error.message);
    
    if (data) {
        // حماية مدير النظام الأساسي
        if (userEmail === OWNER_EMAIL && (data.role !== 'admin' || !data.is_approved)) {
            await supabase.from('user_roles').update({ role: 'admin', is_approved: true }).eq('id', userId);
            data.role = 'admin';
            data.is_approved = true;
        }
        return data;
    }
    
    // مستخدم سجّل لكن مفيش record — نعمله تلقائياً
    const name = userEmail ? userEmail.split('@')[0] : 'موظف جديد';
    const newRoleData = { id: userId, name, role: 'agent', is_approved: false, email: userEmail || '' };
    
    const { data: newRole, error: insertError } = await supabase.from('user_roles').insert([newRoleData]).select().maybeSingle();
    if (!insertError) return newRole || newRoleData;
    
    console.warn('fetchUserRole INSERT failed:', insertError.message, '— trying UPSERT');
    const { data: upserted, error: upsertError } = await supabase.from('user_roles').upsert([newRoleData], { onConflict: 'id' }).select().maybeSingle();
    if (!upsertError) return upserted || newRoleData;
    
    console.error('fetchUserRole UPSERT also failed:', upsertError.message);
    await new Promise(r => setTimeout(r, 1000));
    const { data: retried, error: retryErr } = await supabase.from('user_roles').upsert([newRoleData], { onConflict: 'id' }).select().maybeSingle();
    if (retryErr) console.error('fetchUserRole FINAL RETRY failed:', retryErr.message);
    
    return retried || newRoleData;
}

// تصدير الدوال للاستخدام في index.html
window.CRMAuth = {
    login: authLogin,
    logout: authLogout,
    signup: authSignup,
    checkSessionHealth,
    fetchUserRoleFromDB
};
