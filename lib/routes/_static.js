'use strict';
const fs = require('fs');
const path = require('path');

const STATIC_DIR = path.join(__dirname, '..', '..', 'static');

const MIME = {
    '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.ico': 'image/x-icon',
};

function serve(req, res, pathname) {
    const rel = pathname.replace(/^\/static\//, '');
    const filePath = path.join(STATIC_DIR, rel);
    // 必须带路径分隔符边界，否则 static-evil 这类同级目录也会通过前缀检查
    if (!filePath.startsWith(STATIC_DIR + path.sep)) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    let st;
    try {
        st = fs.statSync(filePath);
    } catch (e) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    // 目录（含 /static/ 这类空 rel 的情况）不可作为静态资源返回
    if (!st.isFile()) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
    // 必须挂 error 监听器：否则 EISDIR/ENOENT 等会变成未捕获异常导致进程退出
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.destroy(); } catch (e) {} });
    stream.pipe(res);
}

module.exports = { serve };