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
    if (!filePath.startsWith(STATIC_DIR + path.sep)) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    let st;
    try {
        st = fs.statSync(filePath);
    } catch (e) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    if (!st.isFile()) {
        res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const revalidate = ext === '.css' || ext === '.js' || ext === '.mjs'
        || ext === '.html' || ext === '.json';
    const headers = {
        'Content-Type': mime,
        'Cache-Control': revalidate ? 'no-cache, must-revalidate' : 'public, max-age=3600',
        'ETag': etag,
        'Last-Modified': st.mtime.toUTCString(),
    };
    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    const matched = inm
        ? inm.split(/\s*,\s*/).indexOf(etag) >= 0
        : ims && !isNaN(Date.parse(ims))
            && Math.floor(st.mtimeMs / 1000) * 1000 <= Date.parse(ims);
    if (matched) {
        res.writeHead(304, headers); res.end(); return;
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.destroy(); } catch (e) {} });
    stream.pipe(res);
}
module.exports = { serve };
