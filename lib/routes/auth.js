'use strict';
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
const { redirect, limitMessage } = require('./_helpers');
const { isSecureRequest } = require('../http-utils');
const storage = require('../storage');
const logger = require('../logger');
const loginAlert = require('../auth/login-alert');
const rateLimit = require('../rate-limit');
function sessionCookie(token, secure, rememberMs) {
    const attrs = ['token=' + token, 'Path=/'];
    if (rememberMs > 0) attrs.push('Max-Age=' + Math.max(1, Math.floor(rememberMs / 1000)));
    attrs.push('HttpOnly', 'SameSite=Lax');
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}
function clearSessionCookie(secure) {
    return 'token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}
function sanitizeReturnTo(raw) {
    if (!raw || typeof raw !== 'string') return '/home';
    const s = raw.trim();
    if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) {
        return '/home';
    }
    if (/[\u0000-\u001F\u007F\\]/.test(s)) return '/home';
    if (s.indexOf('://') >= 0) return '/home';
    return s;
}
function redirectWithError(res, page, message, returnTo) {
    const rt = encodeURIComponent(returnTo || '');
    redirect(res,
        `/${page}?error=` + encodeURIComponent(message)
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
    const secure = isSecureRequest(req);
    const nickname = form.nickname || '';
    const logName = String(nickname).slice(0, 64);
    const ip = req._clientIp || '';
    const limited = auth.checkLoginAllowed(nickname, ip);
    if (limited) {
        logger.security('LOGIN_BLOCKED', ip,
            'nickname=' + logName + ' dim=' + limited.dim);
        const msg = limitMessage('登录', limited);
        return redirectWithError(res, 'login', msg, form.return_to);
    }
    let uid;
    try {
        uid = auth.login(nickname, form.password || '', ip);
    } catch (e) {
        logger.security('LOGIN_FAIL', ip, 'nickname=' + logName + ' reason=' + e.message);
        loginAlert.record(nickname, ip);
        auth.noteLoginFailure(nickname, ip);
        return redirectWithError(res, 'login', e.message, form.return_to);
    }
    if (!uid) {
        logger.security('LOGIN_FAIL', ip, 'nickname=' + logName);
        loginAlert.record(nickname, ip);
        auth.noteLoginFailure(nickname, ip);
        return redirectWithError(res, 'login', '用户名或密码错误', form.return_to);
    }
    auth.clearLoginFailures(nickname, ip);
    const token = auth.createSession(uid, {
        ua: req.headers['user-agent'] || '',
        ip: req._clientIp || '',
    });
    const remember = form.remember === '1' || form.remember === 'on';
    const maxAgeMs = remember ? auth.getSessionTtlMs() : 0;
    const returnTo = sanitizeReturnTo(form.return_to || query.return_to);
    redirect(res, returnTo, { 'Set-Cookie': sessionCookie(token, secure, maxAgeMs) });
});
route('GET', '/register', ({ res, query }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'register.html', {
        return_to: query.return_to || '',
        nav: {},
        site_name: cfg.site_name || '聊天室',
    });
});
route('POST', '/register', ({ req, res, form }) => {
    try {
        const nickname = (form.nickname || '').trim();
        const password = form.password || '';
        const confirm = form.confirm_password || '';
        if (!nickname || !password) throw new Error('昵称和密码不能为空');
        const limited = rateLimit.check('register', {
            ip: req._clientIp || '',
            account: nickname,
        });
        if (limited) throw new Error(limitMessage('注册', limited));
        rateLimit.note('register', {
            ip: req._clientIp || '',
            account: nickname,
        });
        if (password !== confirm) throw new Error('两次密码不一致');
        const uid = auth.registerUser(nickname, password, req._clientIp || '');
        const token = auth.createSession(uid, {
            ua: req.headers['user-agent'] || '',
            ip: req._clientIp || '',
        });
        try { require('../websocket').broadcastMembersUpdate('system'); }
        catch (e) {}
        const returnTo = sanitizeReturnTo(form.return_to);
        redirect(res, returnTo, {
            'Set-Cookie': sessionCookie(token, isSecureRequest(req)),
        });
    } catch (e) {
        redirectWithError(res, 'register', e.message, form.return_to);
    }
});
function logout(req, res, token) {
    if (token) {
        auth.destroySession(token);
        try { require('../websocket').closeSession(token); } catch (e) {}
    }
    redirect(res, '/login', { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) });
}
route('POST', '/logout', ({ req, res, token }) => logout(req, res, token));
