// Account bar (same file in all three apps): "Change password" + "Log out", always visible top-right.
// Uses the same Supabase project + shared session key. Browser-safe values only (publishable key).
(function () {
    'use strict';
    function cfg() {
        if (window.SCHOOL_SUPABASE) return window.SCHOOL_SUPABASE;
        if (window.ENV && window.ENV.SUPABASE_URL) return { url: window.ENV.SUPABASE_URL, key: window.ENV.SUPABASE_KEY };
        var e = window.APP_CONFIG_ENV && window.APP_CONFIG_ENV.supabase;
        return e ? { url: e.url, key: e.key } : null;
    }
    var KEY = 'school-auth';
    function client(persist) {
        var c = cfg(); if (!c || !window.supabase) return null;
        return window.supabase.createClient(c.url, c.key, { auth: { persistSession: persist, autoRefreshToken: false, detectSessionInUrl: false, storageKey: persist ? KEY : 'pw-verify-' + Date.now() } });
    }
    var CSS = 'padding:6px 11px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#0f172a;cursor:pointer;font:12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18)';

    function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }

    async function logout() {
        try { var sb = client(true); if (sb) await sb.auth.signOut(); } catch (e) { console.warn(e); }
        try { localStorage.removeItem('cachedProfile'); localStorage.removeItem('userRole'); } catch (e) { }
        location.href = location.pathname.replace(/[^/]*$/, '') + 'index.html';
    }

    function openPasswordDialog() {
        if (document.getElementById('acctPwOverlay')) return;
        var o = el('div', 'position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif');
        o.id = 'acctPwOverlay';
        var box = el('div', 'background:#fff;color:#0f172a;border-radius:12px;padding:22px;width:min(380px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.4)');
        box.innerHTML = '<h3 style="margin:0 0 4px;font-size:18px">Change password</h3>' +
            '<p style="margin:0 0 12px;color:#64748b;font-size:13px">Use at least 8 characters.</p>' +
            '<input id="acctCur" type="password" autocomplete="current-password" placeholder="Current password" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box">' +
            '<input id="acctNew" type="password" autocomplete="new-password" placeholder="New password" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box">' +
            '<input id="acctNew2" type="password" autocomplete="new-password" placeholder="Repeat new password" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box">' +
            '<div id="acctMsg" style="min-height:18px;font-size:13px;margin-bottom:8px"></div>' +
            '<div style="display:flex;gap:8px"><button id="acctSave" style="flex:1;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Save password</button>' +
            '<button id="acctCancel" style="padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer">Cancel</button></div>';
        o.appendChild(box); document.body.appendChild(o);
        var msg = function (t, ok) { var m = document.getElementById('acctMsg'); m.textContent = t; m.style.color = ok ? '#15803d' : '#dc2626'; };
        document.getElementById('acctCancel').onclick = function () { o.remove(); };
        document.getElementById('acctSave').onclick = async function () {
            var cur = document.getElementById('acctCur').value, p1 = document.getElementById('acctNew').value, p2 = document.getElementById('acctNew2').value;
            if (p1.length < 8) return msg('The new password must be at least 8 characters.');
            if (p1 !== p2) return msg('The two new passwords do not match.');
            var btn = document.getElementById('acctSave'); btn.disabled = true; btn.textContent = 'Saving…';
            try {
                var sb = client(true); if (!sb) throw new Error('Not connected to Supabase.');
                var u = await sb.auth.getUser(); if (u.error || !u.data.user) throw new Error('Your session has expired. Please sign in again.');
                var user = u.data.user, providers = (user.app_metadata && user.app_metadata.providers) || [];
                var hasPassword = providers.indexOf('email') >= 0;
                if (hasPassword) {            // prove it is really the account owner: re-check the current password
                    if (!cur) throw new Error('Enter your current password.');
                    var v = client(false); var chk = await v.auth.signInWithPassword({ email: user.email, password: cur });
                    if (chk.error) throw new Error('Your current password is not correct.');
                    await v.auth.signOut();
                }
                var r = await sb.auth.updateUser({ password: p1 });
                if (r.error) throw r.error;
                msg('Password changed. Use it the next time you sign in.', true);
                setTimeout(function () { o.remove(); }, 1600);
            } catch (e) { msg(e.message || 'Could not change the password.'); btn.disabled = false; btn.textContent = 'Save password'; }
        };
    }

    function init() {
        if (document.getElementById('acctBar')) return;
        var bar = el('div', 'position:fixed;bottom:34px;right:12px;z-index:100001;display:flex;gap:6px');
        bar.id = 'acctBar';
        var pw = el('button', CSS, '🔑 Change password'); pw.onclick = openPasswordDialog;
        var out = el('button', CSS + ';color:#b91c1c;border-color:#fca5a5', 'Log out'); out.onclick = logout;
        bar.appendChild(pw); bar.appendChild(out); document.body.appendChild(bar);
    }
    window.AcctBar = { logout: logout, changePassword: openPasswordDialog };
    // Show only while a session exists (cheap check of the shared storage key; no extra clients).
    function signedIn() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
    function tick() {
        var bar = document.getElementById('acctBar');
        if (signedIn()) { if (!bar) init(); } else if (bar) bar.remove();
    }
    function start() { tick(); setInterval(tick, 1500); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
