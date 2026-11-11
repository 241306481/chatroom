'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function readJson(p) {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return null; }
}
function readJsonState(p) {
    if (!fs.existsSync(p)) return { state: 'missing', value: null, error: null };
    try {
        return { state: 'ok', value: JSON.parse(fs.readFileSync(p, 'utf8')), error: null };
    } catch (e) {
        return { state: 'corrupt', value: null, error: e.message };
    }
}
const _quarantined = new Set();
function quarantineCorrupt(p, label) {
    if (_quarantined.has(p)) return null;
    _quarantined.add(p);
    try {
        const dest = p + '.corrupt-' + Date.now();
        fs.copyFileSync(p, dest);
        require('../logger').error((label || p) + ' 解析失败，已保留副本:', dest);
        return dest;
    } catch (e) {
        try {
            require('../logger').error((label || p) + ' 解析失败:', e.message);
        } catch (e2) {}
        return null;
    }
}
function writeJsonAtomic(p, obj) {
    ensureDir(path.dirname(p));
    const tmp = p + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    try {
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
        fs.renameSync(tmp, p);
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
        throw e;
    }
}
function genUuid() { return crypto.randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
const SCRYPT_KEYLEN = 64;
function hashPassword(pwd) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pwd), salt, SCRYPT_KEYLEN).toString('hex');
    return 'scrypt:' + salt + ':' + hash;
}
function verifyPassword(pwd, stored) {
    if (!stored || typeof stored !== 'string') return false;
    if (!stored.startsWith('scrypt:')) return false;
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const expected = parts[2];
    let computed;
    try {
        computed = crypto.scryptSync(String(pwd), salt, SCRYPT_KEYLEN).toString('hex');
    } catch (e) { return false; }
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(expected, 'hex')
    );
}
function sliceChars(s, n) {
    return Array.from(String(s == null ? '' : s)).slice(0, n).join('');
}
function sanitizeFilename(name) {
    return sliceChars(String(name || '').trim(), 200)
        .replace(/[\\/:*?"<>|\r\n\t\0\x00-\x1f]/g, '_');
}
function readUidList(p) {
    const data = readJson(p) || { uids: [] };
    return Array.isArray(data.uids) ? data.uids : [];
}
function writeUidList(p, uids) { writeJsonAtomic(p, { uids }); }
function hashFileSync(filePath) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(64 * 1024);
    try {
        let n;
        while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
            hash.update(buf.subarray(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}
function moveFileSync(from, to) {
    ensureDir(path.dirname(to));
    try {
        fs.renameSync(from, to);
    } catch (e) {
        fs.copyFileSync(from, to);
        try { fs.rmSync(from, { force: true }); } catch (e2) {}
    }
}
function makeFileMeta({ id, name, mime, buffer, owner, domain }) {
    return {
        id,
        filename: name,
        mime: mime || 'application/octet-stream',
        size: buffer.length,
        etag: crypto.createHash('sha256').update(buffer).digest('hex'),
        uploader: owner,
        visibility: 'private',
        pinned: false,
        ...(domain ? { domain } : {}),
        created_at: nowIso(),
    };
}
function makeFileMetaFromPath({ id, name, mime, filePath, owner, domain }) {
    const size = fs.statSync(filePath).size;
    return {
        id,
        filename: name,
        mime: mime || 'application/octet-stream',
        size,
        etag: hashFileSync(filePath),
        uploader: owner,
        visibility: 'private',
        pinned: false,
        ...(domain ? { domain } : {}),
        created_at: nowIso(),
    };
}
function thumbPathFor(filePath) {
    return filePath + '.thumb.webp';
}
function removeFileWithThumb(filePath) {
    try { fs.rmSync(filePath, { force: true }); } catch (e) {}
    try { fs.rmSync(thumbPathFor(filePath), { force: true }); } catch (e) {}
}
function genFileId() {
    return genUuid();
}
const UNSAFE_ID_RE = /[/\\]|(^|[\\/])\.\.($|[\\/])|^\.\.?$/;
const UNSAFE_ID_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
function safeFileId(id) {
    if (!id || typeof id !== 'string') return null;
    if (id === '.' || id === '..') return null;
    if (UNSAFE_ID_NAMES.has(id)) return null;
    if (UNSAFE_ID_RE.test(id)) return null;
    if (id.includes('\0')) return null;
    return id;
}
module.exports = {
    ensureDir, readJson, readJsonState, quarantineCorrupt, writeJsonAtomic,
    genUuid, nowIso, hashPassword, sliceChars, sanitizeFilename,
    verifyPassword,
    readUidList, writeUidList, makeFileMeta, makeFileMetaFromPath,
    hashFileSync, moveFileSync, genFileId, safeFileId,
    thumbPathFor, removeFileWithThumb,
};
