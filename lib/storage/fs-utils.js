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

// 区分「文件不存在」与「文件损坏」。
//
// readJson 对两者都返回 null，于是上层无法察觉 config.json 已被写坏，
// 会把损坏的配置当成「空配置」继续用：域定义、讨论标题、系统配置等
// 会在下一次保存时被一份残缺对象覆盖，原始数据就此丢失且毫无痕迹。
//
// 返回 { state: 'missing' | 'ok' | 'corrupt', value, error }。
// state === 'corrupt' 时 value 为 null，调用方必须自己决定如何兜底。
function readJsonState(p) {
    if (!fs.existsSync(p)) return { state: 'missing', value: null, error: null };
    try {
        return { state: 'ok', value: JSON.parse(fs.readFileSync(p, 'utf8')), error: null };
    } catch (e) {
        return { state: 'corrupt', value: null, error: e.message };
    }
}

// 保留一份 .corrupt 副本后再让调用方兜底。
// 与 ip-bans.js 的处理方式一致：不阻止继续运行（否则一个坏文件会让整站不可用），
// 但必须留下可追溯的现场，否则事故后无从查证。
//
// 必须去重：loadDomain / loadDiscussion 在每次请求里都会被调用，
// 若每次损坏都复制一份，坏文件会在几秒内堆出成百上千个 .corrupt 副本 ——
// 把一次数据损坏放大成磁盘写满。
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

// ============================================================
// 文件 ID 校验
// ============================================================
// 文件 ID 会被拼进磁盘路径，也会被当作普通对象的键，两条路都要挡：
//   - 路径穿越：'..'、'/'、'\\'、'.' 能让读写跑到索引之外
//   - 原型污染：idx.files['__proto__'] 取到的是 Object.prototype，
//     一个 truthy 值就足以让「删除」/「改路径」直接命中全局原型
// 用户文件与域文件用的是同一套规则，之前各写了一份；规则一旦分叉，
// 就会出现「用户文件挡住了、域文件没挡住」的不一致漏洞。
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
    genUuid, nowIso, hashPassword, sliceChars,
    verifyPassword,
    readUidList, writeUidList, makeFileMeta, genFileId, safeFileId,
};