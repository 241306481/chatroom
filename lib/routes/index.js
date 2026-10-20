'use strict';
const path = require('path');
const { findRoute } = require('../router');
const { parseCookies, parseForm, parseMultipart, getClientIp } = require('../http-utils');
const { render404, render403 } = require('../template');
const logger = require('../logger');
const storage = require('../storage');
const auth = require('../auth');
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
require('./search');

const { escapeHtml } = require('../http-utils');

// 是否 HTTPS；与 routes/auth.js 的 isSecureRequest 同一判定
function isHttps(req) {
    if (req.socket && req.socket.encrypted) return true;
    if (/^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''))) {
        return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    }
    return false;
}

function checkCsrf(req) {
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

    const host = req.headers.host || '';
    if (!host) return false;

    const source = req.headers.origin || req.headers.referer || '';
    if (!source) return true;

    try {
        const u = new URL(source);
        return u.host === host;
    } catch (e) {
        return false;
    }
}

function handleRequestInner(req, res) {
    const start = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        + "media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:; "
        + "object-src 'none'; base-uri 'self'; frame-ancestors 'self'");

    req._clientIp = getClientIp(req);
    res.on('finish', () => logger.http(req, pathname, res.statusCode, Date.now() - start));

    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname.startsWith('/.well-known/')) { res.writeHead(404); res.end(); return; }
    if (pathname.startsWith('/static/')) return require('./_static').serve(req, res, pathname);

    // IP 封禁检查
    try {
        const ban = require('../storage/ip-bans').isBanned(req._clientIp);
        if (ban) {
            const msg = '你的 IP（' + req._clientIp + '）已被封禁'
                + (ban.reason ? '：' + ban.reason : '')
                + (ban.until ? '（至 ' + ban.until + '）' : '（永久）');
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
    // 带设备指纹校验，cookie 被搬到别处会失效
    const uid = token ? auth.getSessionUser(token, {
        ua: req.headers['user-agent'] || '',
        ip: req._clientIp || '',
    }) : null;
    const user = uid ? storage.loadUser(uid) : null;

    if (!checkCsrf(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden: CSRF check failed');
        return;
    }

    if (user && user.id && auth.isUserBanned(user)) {
        if (token) auth.destroySession(token);
        if (pathname === '/logout') {
            res.writeHead(302, {
                Location: '/login',
                'Set-Cookie': 'token=; Path=/; Max-Age=0',
            });
            return res.end();
        }
        if (pathname === '/login' || pathname === '/favicon.ico') {
        } else {
            const b = user;
            const msg = '你的账号已被封禁'
                + (b.ban_reason ? '：' + b.ban_reason : '')
                + (b.banned_until ? '（至 ' + b.banned_until + '）' : '（永久）');
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
                'Set-Cookie': 'token=; Path=/; Max-Age=0',
            });
            return res.end(html);
        }
    }

    const sysCfg = storage.loadDomain('system').system_config || {};
    const maxFileBytes = (sysCfg.max_file_size_mb || 50) * 1024 * 1024;
    const HARD_LIMIT = maxFileBytes + 1024 * 1024;

    const chunks = [];
    let totalSize = 0;
    let aborted = false;

    req.on('data', c => {
        totalSize += c.length;
        if (aborted) return;
        if (totalSize > HARD_LIMIT) { aborted = true; chunks.length = 0; return; }
        chunks.push(c);
    });

    req.on('end', () => {
        const rawBody = aborted ? Buffer.alloc(0) : Buffer.concat(chunks);
        const ct = req.headers['content-type'] || '';
        // 一次性提示：取出后立刻失效，刷新不会重复弹
        require('../flash').capture(req, res);
        require('../flash').clear(res, isHttps(req));
        const isMultipart = ct.startsWith('multipart/form-data');
        // multipart 的文本字段也要能读，否则表单里的昵称/简介会丢
        let form;
        if (isMultipart) {
            form = {};
            const bm = ct.match(/boundary=([^;]+)/);
            if (bm) {
                try {
                    for (const [k, v] of Object.entries(parseMultipart(rawBody, bm[1].trim()))) {
                        if (!v.filename) form[k] = v.data.toString('utf8');
                    }
                } catch (e) { /* 解析失败留给具体路由报错 */ }
            }
        } else {
            form = parseForm(rawBody.toString('utf8'));
        }

        const found = findRoute(req.method, pathname);
        if (!found) return render404(res);

        if (aborted && isMultipart) {
            const mb = sysCfg.max_file_size_mb || 50;
            return require('./_helpers').json(res, 200, { ok: false, error: `文件过大（超过 ${mb} MB）` });
        }

        try {
            if (found.opts.auth && (!user || !user.id)) throw new UnauthorizedError();
            if (found.opts.priv) {
                const p = found.opts.priv;
                checkPriv(user, p.group, p.bit);
            }

            // 页面访问限流：GET 走这里，防止脚本狂刷界面把服务拖垮
            if (req.method === 'GET' && !found.opts.noRateLimit) {
                const limiter = require('../rate-limit');
                const keys = {
                    ip: req._clientIp || '',
                    account: user && user.id ? user.id : '',
                };
                const limited = limiter.check('page_view', keys);
                if (limited) {
                    const msg = '访问过于频繁，请稍后再试';
                    if (pathname.startsWith('/api/')
                        || (req.headers.accept || '').includes('application/json')) {
                        res.writeHead(429, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: false, error: msg }));
                    }
                    res.writeHead(429, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Retry-After': String(limited.mins * 60),
                    });
                    return res.end('429 Too Many Requests: ' + msg);
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
                if (pathname.startsWith('/api/') || (req.headers.accept || '').includes('application/json')) {
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
                // 不回显绝对路径
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('500 Internal Error');
            } else {
                try { res.end(); } catch (e2) {}
            }
        }
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
        } catch (e2) { /* 响应已损坏，放弃 */ }
    }
}

module.exports = { handleRequest };
