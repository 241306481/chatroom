'use strict';
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
const { redirect } = require('./_helpers');
const storage = require('../storage');

// 会话 Cookie。
//
// HttpOnly：JS 读不到，挡住 XSS 窃取 token。
// SameSite=Lax：跨站 POST 不带 Cookie，配合 Origin 校验挡住 CSRF。
// Secure：只在 HTTPS 下加。HTTP 本地调试（局域网明文）不能加，
//         否则浏览器会直接丢弃 Cookie，表现为「登录后立刻掉线」。
//         但一旦走了 TLS 就必须加 —— 否则同网络内可被嗅探/降级窃取。
function sessionCookie(token, secure) {
    return `token=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// req.socket.encrypted 在 https.createServer 下为 true；
// 也兼容反向代理后端（此时要看 X-Forwarded-Proto，但只在 TRUST_PROXY 时采信）。
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

// 登录/注册失败：重定向回对应表单页，带错误信息并保留 return_to。
// 两个表单原先各有一份函数，函数体只有路径不同；将来要加通用参数
// （比如带上被拒的昵称回填）时极易只改一处。
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

    // 先查限流再校验密码：否则攻击者可以用无限次 scrypt 把 CPU 打满。
    const limited = auth.checkLoginAllowed(nickname, ip);
    if (limited) return redirectWithError(res, 'login', limited, form.return_to);

    let uid;
    try {
        uid = auth.login(nickname, form.password || '', ip);
    } catch (e) {
        // 封禁提示也算一次失败，避免被用来探测账号是否存在
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
        const uid = auth.registerUser(nickname, password);
        const token = auth.createSession(uid);
        const returnTo = sanitizeReturnTo(form.return_to);
        redirect(res, returnTo, {
            'Set-Cookie': sessionCookie(token, isSecureRequest(req)),
        });
    } catch (e) {
        redirectWithError(res, 'register', e.message, form.return_to);
    }
});

// 退出登录是状态变更操作：只接受 POST。
// 保留 GET 仅用于「已被封禁时跳转登录页」这一被动场景，不销毁会话。
function logout(res, token) {
    if (token) auth.destroySession(token);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
}

route('POST', '/logout', ({ res, token }) => logout(res, token));