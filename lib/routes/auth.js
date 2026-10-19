'use strict';
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
const { redirect } = require('./_helpers');
const storage = require('../storage');

// 仅 HTTPS 加
function sessionCookie(token, secure) {
    return `token=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function isSecureRequest(req) {
    if (!req) return false;
    if (req.socket && req.socket.encrypted) return true;
    if (String(process.env.TRUST_PROXY || '').match(/^(1|true|yes|on)$/i)) {
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        return proto === 'https';
    }
    return false;
}

function sanitizeReturnTo(raw) {
    if (!raw || typeof raw !== 'string') return '/home';
    const s = raw.trim();
    if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) {
        return '/home';
    }
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
    const ip = req._clientIp || '';

    const limited = auth.checkLoginAllowed(nickname, ip);
    if (limited) return redirectWithError(res, 'login', limited, form.return_to);

    let uid;
    try {
        uid = auth.login(nickname, form.password || '', ip);
    } catch (e) {
        // 封禁提示计失败
        auth.noteLoginFailure(nickname, ip);
        return redirectWithError(res, 'login', e.message, form.return_to);
    }
    if (!uid) {
        auth.noteLoginFailure(nickname, ip);
        return redirectWithError(res, 'login', '用户名或密码错误', form.return_to);
    }
    auth.clearLoginFailures(nickname, ip);
    const token = auth.createSession(uid);
    const returnTo = sanitizeReturnTo(form.return_to || query.return_to);
    redirect(res, returnTo, { 'Set-Cookie': sessionCookie(token, secure) });
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
        if (password !== confirm) throw new Error('两次密码不一致');
        const uid = auth.registerUser(nickname, password, req._clientIp || '');
        const token = auth.createSession(uid);
        // 新成员默认进 system 域，在线的成员列表要能刷新出来
        try { require('../websocket').broadcastMembersUpdate('system'); }
        catch (e) { /* 没有订阅者时忽略 */ }
        const returnTo = sanitizeReturnTo(form.return_to);
        redirect(res, returnTo, {
            'Set-Cookie': sessionCookie(token, isSecureRequest(req)),
        });
    } catch (e) {
        redirectWithError(res, 'register', e.message, form.return_to);
    }
});

function logout(res, token) {
    if (token) auth.destroySession(token);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
}

route('POST', '/logout', ({ res, token }) => logout(res, token));