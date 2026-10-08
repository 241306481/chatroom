'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// 目录
// ============================================================
function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ============================================================
// JSON 读写（原子写入）
// ============================================================
function readJson(p) {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return null; }
}

function writeJsonAtomic(p, obj) {
    ensureDir(path.dirname(p));
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, p);
}

// ============================================================
// 基础工具
// ============================================================
function genUuid() { return crypto.randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
const SCRYPT_KEYLEN = 64;
const LEGACY_PREFIX = 'chatroom_salt_v1:';

function hashPassword(pwd) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pwd), salt, SCRYPT_KEYLEN).toString('hex');
    return 'scrypt:' + salt + ':' + hash;
}

function verifyPassword(pwd, stored) {
    if (!stored || typeof stored !== 'string') return false;
    pwd = String(pwd);
    if (stored.startsWith('scrypt:')) {
        const parts = stored.split(':');
        if (parts.length !== 3) return false;
        const salt = parts[1];
        const expected = parts[2];
        let computed;
        try {
            computed = crypto.scryptSync(pwd, salt, SCRYPT_KEYLEN).toString('hex');
        } catch (e) { return false; }
        if (computed.length !== expected.length) return false;
        return crypto.timingSafeEqual(
            Buffer.from(computed, 'hex'),
            Buffer.from(expected, 'hex')
        );
    }
    const oldHash = crypto.createHash('sha256')
        .update(LEGACY_PREFIX + pwd).digest('hex');
    if (oldHash.length !== stored.length) return false;
    return crypto.timingSafeEqual(
        Buffer.from(oldHash, 'hex'),
        Buffer.from(stored, 'hex')
    );
}

function isLegacyHash(stored) {
    return typeof stored === 'string' && stored.length > 0
        && !stored.startsWith('scrypt:');
}
function sliceChars(s, n) {
    return Array.from(String(s == null ? '' : s)).slice(0, n).join('');
}

// ============================================================
// uid 列表文件（关注 / 粉丝 / 拉黑）
// ============================================================
function readUidList(p) {
    const data = readJson(p) || { uids: [] };
    return Array.isArray(data.uids) ? data.uids : [];
}
function writeUidList(p, uids) { writeJsonAtomic(p, { uids }); }

// ============================================================
// 文件元信息
// ============================================================
function makeFileMeta({ id, name, mime, buffer, owner, domain }) {
    return {
        id,
        filename: name,
        mime: mime || 'application/octet-stream',
        size: buffer.length,
        etag: crypto.createHash('sha256').update(buffer).digest('hex'),
        uploader: owner,
        ...(domain ? { domain } : {}),
        created_at: nowIso(),
    };
}

// 若索引中已存在同名文件，复用其 ID（覆盖语义）
function resolveFileId(idx, name) {
    for (const [existingId, meta] of Object.entries(idx.files)) {
        if (meta.filename === name) return existingId;
    }
    return genUuid();
}

module.exports = {
    ensureDir, readJson, writeJsonAtomic,
    genUuid, nowIso, hashPassword, sliceChars,
    verifyPassword, isLegacyHash,
    readUidList, writeUidList, makeFileMeta, resolveFileId,
};