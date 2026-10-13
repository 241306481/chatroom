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
        visibility: 'private',
        ...(domain ? { domain } : {}),
        created_at: nowIso(),
    };
}

// 为新文件生成唯一 ID。
//
// 原实现按文件名复用已有 ID（"覆盖语义"），后果是：
// 同一索引内两人上传同名文件时，后者的字节直接覆盖前者，
// 且元数据里的 uploader 被改写，前者再也无法删除自己的文件。
// renameUserFile / renameDomainFile 都明确拒绝同名，说明 UI 语义是
// 「同名 = 两个文件」，因此这里一律生成新 ID。
function genFileId() {
    return genUuid();
}

module.exports = {
    ensureDir, readJson, writeJsonAtomic,
    genUuid, nowIso, hashPassword, sliceChars,
    verifyPassword,
    readUidList, writeUidList, makeFileMeta, genFileId,
};