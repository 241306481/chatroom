'use strict';
const fs = require('fs');
const path = require('path');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const MAX_FILES = 5;
const MAX_BYTES = 256 * 1024;
const MAX_LINES = 200;
const MAX_SCAN = 5000;
const PAGE_SIZE = 100;
const MAX_PAGE = 50;
const MAX_EXPORT = 5000;
const FILE_RE = /^\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log$/;
function listFiles() {
    try {
        return fs.readdirSync(LOG_DIR)
            .filter(name => FILE_RE.test(name))
            .map(name => {
                const file = path.join(LOG_DIR, name);
                let mtime = 0;
                try { mtime = fs.statSync(file).mtimeMs; } catch (e) {}
                return { file, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, MAX_FILES);
    } catch (e) {
        return [];
    }
}
function tail(file) {
    let fd;
    try {
        const size = fs.statSync(file).size;
        const start = Math.max(0, size - MAX_BYTES);
        fd = fs.openSync(file, 'r');
        const len = size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        const text = buf.toString('utf8');
        return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    } catch (e) {
        return '';
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}
function events({ kind = 'all', limit = MAX_LINES, offset = 0 } = {}) {
    const skip = Math.max(0, Math.floor(Number(offset) || 0));
    const take = Math.max(0, Math.floor(Number(limit) || 0));
    if (!take || skip >= MAX_SCAN) return [];
    const need = Math.min(MAX_SCAN, skip + take);
    const wantAudit = kind === 'all' || kind === 'audit';
    const wantSecurity = kind === 'all' || kind === 'security';
    const out = [];
    for (const item of listFiles()) {
        const lines = tail(item.file).split(/\r?\n/).filter(Boolean).reverse();
        for (const line of lines) {
            const isAudit = line.includes('[Audit]');
            const isSecurity = line.includes('[Security]');
            if ((!isAudit && !isSecurity)
                || (isAudit && !wantAudit)
                || (isSecurity && !wantSecurity)) continue;
            out.push(line.trim());
            if (out.length >= need) return out.slice(skip, skip + take);
        }
    }
    return out.slice(skip, skip + take);
}
module.exports = {
    events, MAX_LINES, MAX_SCAN, PAGE_SIZE, MAX_PAGE, MAX_EXPORT,
};
