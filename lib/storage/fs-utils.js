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
function hashPassword(pwd) {
    return crypto.createHash('sha256').update('chatroom_salt_v1:' + pwd).digest('hex');
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
    readUidList, writeUidList, makeFileMeta, resolveFileId,
};