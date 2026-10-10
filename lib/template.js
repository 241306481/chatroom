'use strict';
const path = require('path');
const nunjucks = require('nunjucks');
const storage = require('./storage');

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

function render(res, tpl, data) {
    try {
        const html = env.render(tpl, data);
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        });
        res.end(html);
    } catch (e) {
        console.error('[Render Error]', tpl, e.message);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Render error: ' + e.message);
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
        return env.render(tpl, data);
    } catch (e) {
        console.error('[RenderToString Error]', tpl, e.message);
        return '';
    }
}

module.exports = { env, render, render403, render404, alertBack, renderToString };