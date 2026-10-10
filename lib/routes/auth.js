'use strict';
const auth = require('../auth');
const { route } = require('../router');
const { render, alertBack } = require('../template');
const { redirect } = require('./_helpers');
const storage = require('../storage');

function sanitizeReturnTo(raw) {
    if (!raw || typeof raw !== 'string') return '/home';
    const s = raw.trim();
    if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) {
        return '/home';
    }
    if (s.indexOf('://') >= 0) return '/home';
    return s;
}

route('GET', '/login', ({ res, query }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'login.html', {
        return_to: query.return_to || '',
        nav: {},
        site_name: cfg.site_name || '聊天室',
    });
});

route('POST', '/login', ({ res, form, query }) => {
    let uid;
    try { uid = auth.login(form.nickname || '', form.password || ''); }
    catch (e) { return alertBack(res, e.message); }
    if (!uid) return alertBack(res, '用户名或密码错误');
    const token = auth.createSession(uid);
    const returnTo = sanitizeReturnTo(form.return_to || query.return_to);
    redirect(res, returnTo, { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Lax` });
});

route('GET', '/register', ({ res, query }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'register.html', {
        return_to: query.return_to || '',
        nav: {},
        site_name: cfg.site_name || '聊天室',
    });
});

route('POST', '/register', ({ res, form }) => {
    try {
        const nickname = (form.nickname || '').trim();
        const password = form.password || '';
        const confirm = form.confirm_password || '';
        if (!nickname || !password) throw new Error('昵称和密码不能为空');
        if (password !== confirm) throw new Error('两次密码不一致');
        const uid = auth.registerUser(nickname, password);
        const token = auth.createSession(uid);
        const returnTo = sanitizeReturnTo(form.return_to);
        redirect(res, returnTo, { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Lax` });
    } catch (e) {
        alertBack(res, e.message);
    }
});

route('GET', '/logout', ({ res, token }) => {
    if (token) auth.destroySession(token);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
});