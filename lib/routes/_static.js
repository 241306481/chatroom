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
    if (!filePath.startsWith(STATIC_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(filePath).pipe(res);
}

module.exports = { serve };