'use strict';
const crypto = require('crypto');
const path = require('path');
const { findRoute } = require('../router');
const {
    parseCookies, parseForm, parseMultipart, getClientIp, escapeHtml, isSecureRequest,
} = require('../http-utils');
const { parseMultipartStream } = require('../multipart-stream');
const { render404, render403 } = require('../template');
const logger = require('../logger');
const storage = require('../storage');
const auth = require('../auth');
const credentialCrypto = require('../auth/credential-crypto');
const { clearSessionCookie } = require('../auth/cookies');
const { PrivilegeError, UnauthorizedError, checkPriv } = require('../auth/privilege');
require('./auth');
require('./home');
require('./domain');
require('./discuss');
require('./manage');
require('./admin');
require('./user');
require('./avatar');
require('./files');
require('./messages');
require('./forward');
require('./attachments');
require('./help');
require('./search');
const FORM_HARD_LIMIT = 2 * 1024 * 1024;
function isEncryptedAuthRequest(pathname, contentType) {
    if (pathname !== '/login' && pathname !== '/register') return false;
    return String(contentType || '').toLowerCase().startsWith('application/json');
}
function jsonError(res, code, message) {
    require('./_helpers').json(res, code, { ok: false, error: message });
}
const MULTIPART_ROUTE_RE = /^(?:\/settings\/avatar|\/myfile\/upload|\/user\/[^/]+|\/messages\/[^/]+\/files\/upload|\/domain\/[^/]+\/files\/upload|\/domain\/[^/]+\/discuss\/[^/]+\/files\/upload)$/;
const STREAM_MULTIPART_ROUTE_RE = /^(?:\/myfile\/upload|\/messages\/[^/]+\/files\/upload|\/domain\/[^/]+\/files\/upload|\/domain\/[^/]+\/discuss\/[^/]+\/files\/upload)$/;
function checkCsrf(req) {
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const host = req.headers.host || '';
    if (!host) return false;
    const source = req.headers.origin || req.headers.referer || '';
    if (!source) return false;
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
        return false;
    }
    const expectedProto = isSecureRequest(req) ? 'https:' : 'http:';
    try {
        const u = new URL(source);
        return u.protocol === expectedProto
            && u.host.toLowerCase() === String(host).toLowerCase();
    } catch (e) {
        return false;
    }
}
function isAuditRequest(method, pathname) {
    if (method !== 'POST') return false;
    if (pathname === '/manage' || pathname.startsWith('/manage/')) return true;
    if (/^\/domain\/[^/]+\/manage(?:\/|$)/.test(pathname)) return true;
    return pathname === '/settings/security/password'
        || pathname === '/settings/security/logout_all';
}
function handleRequestInner(req, res) {
    const start = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    if (isSecureRequest(req)) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    const cspNonce = crypto.randomBytes(16).toString('base64');
    res._cspNonce = cspNonce;
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'nonce-" + cspNonce + "'; "
        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        + "media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:; "
        + "frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    req._clientIp = getClientIp(req);
    res._method = req.method;
    res.on('finish', () => logger.http(req, pathname, res.statusCode, Date.now() - start));
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname.startsWith('/.well-known/')) { res.writeHead(404); res.end(); return; }
    if (pathname.startsWith('/static/')) return require('./_static').serve(req, res, pathname);
    try {
        const ban = require('../storage/ip-bans').isBanned(req._clientIp);
        if (ban) {
            const msg = '你的 IP（' + req._clientIp + '）已被封禁'
                + (ban.reason ? '：' + ban.reason : '')
                + (ban.until ? '（至 ' + ban.until + '）' : '（永久）');
            if (req.method === 'POST') return jsonError(res, 403, msg);
            const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IP 已封禁</title>
<link rel="stylesheet" href="/static/css/main.css"></head>
<body><div class="error-page">
<h1 style="color:#ff4d4f;">🚫</h1>
<p>${escapeHtml(msg)}</p>
</div></body></html>`;
            res.writeHead(403, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            return res.end(html);
        }
    } catch (e) {
        logger.error('IP ban check error:', e);
    }
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.token || '';
    const uid = token ? auth.getSessionUser(token, {
        ua: req.headers['user-agent'] || '',
        ip: req._clientIp || '',
    }) : null;
    const user = uid ? storage.loadUser(uid) : null;
    if (user && user.id && isAuditRequest(req.method, pathname)) {
        res.on('finish', () => logger.audit(
            user.id, user.nickname, req._clientIp,
            req.method, pathname, res.statusCode));
    }
    if (!checkCsrf(req)) {
        if (req.method === 'POST') return jsonError(res, 403, 'CSRF 校验失败');
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden: CSRF check failed');
        return;
    }
    if (user && user.id && auth.isUserBanned(user)) {
        if (token) auth.destroySession(token);
        if (pathname === '/logout') {
            if (req.method === 'POST') {
                return require('./_helpers').json(res, 200,
                    { ok: true, redirect: '/login' },
                    { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) });
            }
            res.writeHead(302, {
                Location: '/login',
                'Set-Cookie': clearSessionCookie(isSecureRequest(req)),
            });
            return res.end();
        }
        if (pathname === '/login' || pathname === '/favicon.ico') {} else {
            const b = user;
            const msg = '你的账号已被封禁'
                + (b.ban_reason ? '：' + b.ban_reason : '')
                + (b.banned_until ? '（至 ' + b.banned_until + '）' : '（永久）');
            if (req.method === 'POST') {
                return require('./_helpers').json(res, 403,
                    { ok: false, error: msg },
                    { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) });
            }
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
                <title>账号已封禁</title>
                <link rel="stylesheet" href="/static/css/main.css"></head>
                <body><div class="error-page">
                <h1 style="color:#ff4d4f;">🚫</h1>
                <p>${escapeHtml(msg)}</p>
                <form method="POST" action="/logout">
                    <button type="submit">退出登录</button>
                </form>
                </div></body></html>`;
            res.writeHead(403, {
                'Content-Type': 'text/html; charset=utf-8',
                'Set-Cookie': clearSessionCookie(isSecureRequest(req)),
            });
            return res.end(html);
        }
    }
    const sysCfg = storage.loadDomain('system').system_config || {};
    const ct = req.headers['content-type'] || '';
    const isMultipart = ct.startsWith('multipart/form-data')
        && MULTIPART_ROUTE_RE.test(pathname);
    const maxFileBytes = (sysCfg.max_file_size_mb || 50) * 1024 * 1024;
    const requestLimit = isMultipart ? maxFileBytes + 1024 * 1024 : FORM_HARD_LIMIT;
    let aborted = false;
    let responded = false;
    function tooLarge() {
        if (responded) return;
        responded = true;
        if (isMultipart) {
            const mb = sysCfg.max_file_size_mb || 50;
            return require('./_helpers').json(res, 200,
                { ok: false, error: `文件过大（超过 ${mb} MB）` });
        }
        if (req.method === 'POST') return jsonError(res, 413, '请求内容过大');
        res.writeHead(413, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end('413 Payload Too Large');
    }
    const declaredSize = parseInt(req.headers['content-length'], 10);
    if (Number.isFinite(declaredSize) && declaredSize > requestLimit) {
        aborted = true;
        req.on('error', () => {});
        req.resume();
        return tooLarge();
    }
    function dispatch(rawBody, form) {
        require('../flash').capture(req, res);
        require('../flash').clear(res, isSecureRequest(req));
        const found = findRoute(req.method, pathname);
        if (!found) return render404(res);
        try {
            if (found.opts.auth && (!user || !user.id)) throw new UnauthorizedError();
            if (found.opts.priv) {
                const p = found.opts.priv;
                checkPriv(user, p.group, p.bit);
            }
            if (req.method === 'GET' && !found.opts.noRateLimit) {
                const limiter = require('../rate-limit');
                const keys = {
                    ip: req._clientIp || '',
                    account: user && user.id ? user.id : '',
                };
                const limited = limiter.check('page_view', keys);
                if (limited) {
                    const msg = require('./_helpers').limitMessage('访问', limited);
                    if (pathname.startsWith('/api/')
                        || (req.headers.accept || '').includes('application/json')) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({
                            ok: false, error: msg, retry_after: limited.leftSec,
                        }));
                    }
                    res.writeHead(403, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Retry-After': String(limited.leftSec),
                    });
                    return res.end('403 Forbidden: ' + msg);
                }
                limiter.note('page_view', keys);
            }
            found.handler({
                req, res, user, uid, token,
                params: found.params, query, form, rawBody,
            });
        } catch (e) {
            if (e instanceof UnauthorizedError) {
                const returnTo = encodeURIComponent(pathname + (url.search || ''));
                if (req.method === 'POST' || pathname.startsWith('/api/')
                    || (req.headers.accept || '').includes('application/json')) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                } else {
                    res.writeHead(302, { Location: '/login?return_to=' + returnTo });
                    res.end();
                }
                return;
            }
            if (e instanceof PrivilegeError) {
                return render403(res, e.message);
            }
            logger.error('Route Error:', pathname, e);
            if (!res.headersSent) {
                if (req.method === 'POST') return jsonError(res, 500, '服务器内部错误');
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('500 Internal Error');
            } else {
                try { res.end(); } catch (e2) {}
            }
        }
    }
    if (isMultipart && STREAM_MULTIPART_ROUTE_RE.test(pathname)) {
        const bm = ct.match(/boundary=([^;]+)/);
        if (!bm) return jsonError(res, 400, 'No boundary');
        parseMultipartStream(req, bm[1].trim(), {
            maxBytes: requestLimit,
            tmpdir: path.join(storage.DATA_DIR, 'tmp'),
        })
            .then(upload => {
                if (responded || aborted) {
                    upload.cleanup();
                    if (!responded) tooLarge();
                    return;
                }
                req._upload = { file: upload.file };
                try {
                    dispatch(undefined, upload.fields);
                } finally {
                    upload.cleanup();
                }
            })
            .catch(e => {
                if (aborted || responded) return;
                if (e && e.code === 'too_large') {
                    aborted = true;
                    return tooLarge();
                }
                logger.warn('Multipart Error: ' + (e && e.message ? e.message : e));
                if (!res.headersSent) jsonError(res, 400, '上传数据无效');
            });
        return;
    }
    const chunks = [];
    let totalSize = 0;
    req.on('data', c => {
        if (aborted) return;
        totalSize += c.length;
        if (totalSize > requestLimit) {
            aborted = true;
            chunks.length = 0;
            tooLarge();
            return;
        }
        chunks.push(c);
    });
    req.on('aborted', () => {
        aborted = true;
        chunks.length = 0;
    });
    req.on('error', e => {
        if (aborted) return;
        aborted = true;
        chunks.length = 0;
        logger.warn('Request body error: ' + (e && e.message ? e.message : e));
    });
    req.on('end', () => {
        if (aborted) {
            if (!responded) tooLarge();
            return;
        }
        const rawBody = Buffer.concat(chunks);
        chunks.length = 0;
        let form;
        if (isEncryptedAuthRequest(pathname, ct)) {
            try {
                const payload = JSON.parse(rawBody.toString('utf8'));
                form = credentialCrypto.openCredentialPayload(payload);
            } catch (e) {
                logger.warn('Encrypted auth payload rejected: '
                    + (e && e.message ? e.message : e));
                return jsonError(res, 400, '加密凭据无效，请刷新页面重试');
            }
        } else if (isMultipart) {
            form = Object.create(null);
            const bm = ct.match(/boundary=([^;]+)/);
            if (bm) {
                try {
                    for (const [k, v] of Object.entries(parseMultipart(rawBody, bm[1].trim()))) {
                        if (!v.filename) form[k] = v.data.toString('utf8');
                    }
                } catch (e) {}
            }
        } else {
            form = parseForm(rawBody.toString('utf8'));
        }
        dispatch(rawBody, form);
    });
}
function handleRequest(req, res) {
    try {
        handleRequestInner(req, res);
    } catch (e) {
        logger.error('Request Error:', req && req.url, e);
        try {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('500 Internal Error');
            } else {
                res.destroy();
            }
        } catch (e2) {}
    }
}
module.exports = { handleRequest };
