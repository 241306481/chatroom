'use strict';
const path = require('path');
const nunjucks = require('nunjucks');
const storage = require('./storage');
const avatarView = require('./avatar-view');
const { escapeHtml } = require('./http-utils');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

const env = nunjucks.configure(TEMPLATE_DIR, {
    autoescape: true, trimBlocks: true, lstripBlocks: true, noCache: true,
});

env.addFilter('avatarText', function (nickname) {
    const chars = Array.from(String(nickname == null ? '?' : nickname));
    if (!chars.length) return '?';
    const first = chars[0];
    const cp = first.codePointAt(0);
    if (cp > 0xFFFF) return first;
    if (/[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\uac00-\ud7af]/.test(first)) {
        return first;
    }
    return chars.slice(0, 2).join('');
});

env.addFilter('sliceChars', function (s, n) { return storage.sliceChars(s, n); });

const AVATAR_COLOR_FALLBACK = '#888';
function safeAvatarColor(c) {
    const s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    if (/^hsl\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*\)$/.test(s)) return s;
    if (/^rgba?\([0-9,\s.]+\)$/.test(s)) return s;
    if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
    return AVATAR_COLOR_FALLBACK;
}
env.addFilter('avatarColor', safeAvatarColor);

env.addFilter('avatarSrc', function (u, uid) {
    return avatarView.avatarSrc(u || {}, uid);
});

const SCRIPT_UNSAFE_RE = new RegExp(
    '[' + ['<', '>', '&', String.fromCharCode(0x2028), String.fromCharCode(0x2029)].map(
        c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    ).join('') + ']', 'g');

env.addFilter('jsdump', function (obj) {
    const json = JSON.stringify(
        obj === undefined ? null : obj,
        function (k, v) { return v === undefined ? null : v; }
    );
    return new nunjucks.runtime.SafeString(
        String(json).replace(SCRIPT_UNSAFE_RE, function (c) {
            return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
        })
    );
});

function withWsProtocol(data) {
    // 协议以启动时锁定值为准，路由即便误传也不能改
    return Object.assign({}, data || {}, {
        ws_protocol: require('./ws-protocol').getWsProtocol(),
    });
}

function render(res, tpl, data) {
    try {
        const html = env.render(tpl, require('./flash').attach(res, withWsProtocol(data)));
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        });
        res.end(html);
    } catch (e) {
        console.error('[Render Error]', tpl, e);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Error');
    }
}

function render403(res, message) {
    try {
        const html = env.render('403.html', { message: message || '', nav: {} });
        res.writeHead(403, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        });
        res.end(html);
    } catch (e) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
    }
}

function render404(res) {
    try {
        const html = env.render('404.html', { nav: {} });
        res.writeHead(404, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        });
        res.end(html);
    } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
    }
}

function render429(res, message) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>请求过于频繁</title>
<link rel="stylesheet" href="/static/css/main.css"></head>
<body><div class="error-page">
  <h1 style="color:#faad14;">⚠</h1>
  <p>${require('./http-utils').escapeHtml(message || '请求过于频繁，请稍后再试')}</p>
  <a href="javascript:history.back()">← 返回</a>
</div></body></html>`;
    res.writeHead(429, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(html);
}

function alertBack(res, msg) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>提示</title>
<link rel="stylesheet" href="/static/css/main.css"></head>
<body><div class="error-page">
  <h1 style="color:#faad14;">⚠</h1>
  <p>${require('./http-utils').escapeHtml(msg)}</p>
  <a href="javascript:history.back()">← 返回</a>
</div></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function renderToString(tpl, data) {
    try {
        return env.render(tpl, withWsProtocol(data));
    } catch (e) {
        console.error('[RenderToString Error]', tpl, e.message);
        return '';
    }
}

module.exports = { env, render, render403, render404, render429, alertBack, renderToString };