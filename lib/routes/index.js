'use strict';
const path = require('path');
const { findRoute } = require('../router');
const { parseCookies, parseForm, getClientIp } = require('../http-utils');
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
require('./files');
require('./messages');
require('./search');

const { escapeHtml } = require('../http-utils');

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

function handleRequest(req, res) {
    const start = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    req._clientIp = getClientIp(req);
    res.on('finish', () => logger.http(req, pathname, res.statusCode, Date.now() - start));

    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname.startsWith('/.well-known/')) { res.writeHead(404); res.end(); return; }
    if (pathname.startsWith('/static/')) return require('./_static').serve(req, res, pathname);

    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.token || '';
    const uid = token ? auth.getSessionUser(token) : null;
    const user = uid ? storage.loadUser(uid) : null;

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
                <a href="/logout">退出登录</a>
                </div></body></html>`;
            res.writeHead(403, {
                'Content-Type': 'text/html; charset=utf-8',
                'Set-Cookie': 'token=; Path=/; Max-Age=0',
            });
            return res.end(html);
        }
    }

    if (user && user.id && !checkCsrf(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden: CSRF check failed');
        return;
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
        const isMultipart = ct.startsWith('multipart/form-data');
        const form = isMultipart ? {} : parseForm(rawBody.toString('utf8'));

        const found = findRoute(req.method, pathname);
        if (!found) return render404(res);

        if (aborted && isMultipart) {
            const mb = sysCfg.max_file_size_mb || 50;
            return require('./_helpers').json(res, 200, { ok: false, error: `文件过大（超过 ${mb} MB）` });
        }

        try {
            if (found.opts.auth) checkPriv(user, 0);
            if (found.opts.priv) checkPriv(user, found.opts.priv);
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
                res.writeHead(500);
                res.end('500: ' + e.message);
            }
        }
    });
}

module.exports = { handleRequest };
