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

// 把任意值序列化成可以安全嵌进 <script> 的 JS 字面量。
//
// 不能直接用 `dump | safe`：nunjucks 的 dump 就是 JSON.stringify，
// 不转义任何字符。输出位置在 <script> 内部，值里只要含 `</script>`
// 就能闭合标签块，剩下的内容当作 HTML 解析 —— 消息内容/昵称等用户可控
// 字段一旦含有该序列即构成存储型 XSS。
// 因此这里把 < > & 以及 U+2028/U+2029 全部转成 JS 的 \uXXXX 转义写法。
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

function render(res, tpl, data) {
    try {
        const html = env.render(tpl, data);
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
        });
        res.end(html);
    } catch (e) {
        console.error('[Render Error]', tpl, e);
        // 不回显 e.message：nunjucks 的报错里带模板绝对路径和出错数据，
        // 等于把服务器目录结构暴露给访问者（与 routes/index.js 的约定一致）
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