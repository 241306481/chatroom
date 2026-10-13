'use strict';
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
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

// 登录/注册失败：重定向回表单页，带错误信息并保留 return_to
function redirectWithLoginError(res, message, returnTo) {
    const rt = encodeURIComponent(returnTo || '');
    redirect(res,
        '/login?error=' + encodeURIComponent(message)
        + (rt ? '&return_to=' + rt : ''));
}

function redirectWithRegisterError(res, message, returnTo) {
    const rt = encodeURIComponent(returnTo || '');
    redirect(res,
        '/register?error=' + encodeURIComponent(message)
        + (rt ? '&return_to=' + rt : ''));
}

route('GET', '/login', ({ res, query }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'login.html', {
        return_to: query.return_to || '',
        nav: {},
        site_name: cfg.site_name || '聊天室',
    });
});

route('POST', '/login', ({ req, res, form, query }) => {
    let uid;
    try { uid = auth.login(form.nickname || '', form.password || '', req._clientIp || ''); }
    catch (e) { return redirectWithLoginError(res, e.message, form.return_to); }
    if (!uid) return redirectWithLoginError(res, '用户名或密码错误', form.return_to);
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
        redirectWithRegisterError(res, e.message, form.return_to);
    }
});

// 退出登录是状态变更操作：只接受 POST。
// 保留 GET 仅用于「已被封禁时跳转登录页」这一被动场景，不销毁会话。
function logout(res, token) {
    if (token) auth.destroySession(token);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
}

route('POST', '/logout', ({ res, token }) => logout(res, token));