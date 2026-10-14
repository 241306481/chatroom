'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { ensureDir, writeJsonAtomic } = require('./fs-utils');

const FILE = path.join(DATA_DIR, 'ip_bans.json');

let _cache = null;
let _cacheAt = 0;
const TTL = 60 * 1000;

function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function load() {
    if (!fs.existsSync(FILE)) return { rules: [] };
    try {
        const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        // 兼容旧格式（{ ips: {...} }）→ 丢弃，转新格式
        if (d && Array.isArray(d.rules)) return d;
        return { rules: [] };
    } catch (e) {
        // 解析失败不能静默当成「没有封禁」—— 那等于解除所有封禁。
        // 保留损坏现场并记录日志，交给管理员处理。
        try {
            const broken = FILE + '.corrupt-' + Date.now();
            fs.copyFileSync(FILE, broken);
            require('../logger').error(
                'ip_bans.json 解析失败，已保留副本:', broken, e.message);
        } catch (e2) {}
        return { rules: [] };
    }
}

// 必须原子写：直接 writeFileSync 在中途崩溃会留下半截 JSON，
// 而 load() 的兜底会让全部封禁规则无声消失
function save(data) {
    ensureDir(DATA_DIR);
    writeJsonAtomic(FILE, data);
    _cache = null;
    _cacheAt = 0;
}

// ============================================================
// 规则合法性校验
// ============================================================
// 每段允许：数字 / * / a-b
function validateRule(rule) {
    const parts = String(rule || '').trim().split('.');
    if (parts.length !== 4) throw new Error('IP 格式需为 4 段');
    for (const raw of parts) {
        const p = raw.trim();
        if (p === '*') continue;
        if (/^\d+$/.test(p)) {
            const n = parseInt(p, 10);
            if (n < 0 || n > 255) throw new Error('IP 段需在 0-255：' + p);
            continue;
        }
        const m = p.match(/^(\d+)-(\d+)$/);
        if (m) {
            const a = parseInt(m[1], 10);
            const b = parseInt(m[2], 10);
            // 两端都必须在 0-255：漏掉 a > 255 会让 '256-300' 通过校验
            // 并落库，但它永远匹配不到任何真实 IP（死规则）
            if (a < 0 || a > 255 || b < 0 || b > 255 || a > b) {
                throw new Error('范围需 0-255 且 a<=b：' + p);
            }
            continue;
        }
        throw new Error('段格式非法：' + p);
    }
    return true;
}

// ============================================================
// 运行时匹配（不展开）
// ============================================================

// 单段匹配：ipSeg 必须是 0-255 的数字
function matchSegment(ipSeg, ruleSeg) {
    if (ruleSeg === '*') return true;
    const n = parseInt(ipSeg, 10);
    if (Number.isNaN(n)) return false;
    if (/^\d+$/.test(ruleSeg)) return n === parseInt(ruleSeg, 10);
    const m = ruleSeg.match(/^(\d+)-(\d+)$/);
    if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        return n >= a && n <= b;
    }
    return false;
}

function matchRule(ip, rule) {
    const ipParts = String(ip || '').trim().split('.');
    const ruleParts = String(rule || '').split('.');
    if (ipParts.length !== 4 || ruleParts.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
        if (!matchSegment(ipParts[i], ruleParts[i].trim())) return false;
    }
    return true;
}

// ============================================================
// 查询
// ============================================================
function getRules() {
    const now = Date.now();
    if (_cache && now - _cacheAt < TTL) return _cache;
    const data = load();
    _cache = Array.isArray(data.rules) ? data.rules : [];
    _cacheAt = now;
    return _cache;
}

// 被封返回命中该 IP 的规则记录，未封返回 null
function isBanned(ip) {
    if (!ip) return null;
    const rules = getRules();
    const now = nowIso();
    for (const rec of rules) {
        if (rec.until && rec.until < now) continue;   // 已过期，跳过
        if (matchRule(ip, rec.rule)) return rec;
    }
    return null;
}

function listAll() {
    const data = load();
    return Array.isArray(data.rules) ? data.rules : [];
}

// ============================================================
// 增删
// ============================================================
function addBan(rule, { reason, until, by } = {}) {
    rule = String(rule || '').trim();
    validateRule(rule);
// until 会被 isBanned 用字典序比较，格式/日期不合法会让规则永久生效。
// 因此非法值必须让调用方报错，而不是悄悄退化成 u = ''（= 永久封禁）。
// 判定逻辑与 auth.normalizeUntil（lib/auth/bans.js）必须保持一致：
// 这里独立实现是因为 storage 不能反向依赖 auth（auth → storage 会成环），
// 两处都在各自模块里写明了这个约束。
let u = String(until || '').trim();
if (u) {
    let t = NaN;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(u)) {
        throw new Error('解封时间格式无效，应为 2024-06-01T12:00:00Z');
    }
    t = Date.parse(u.replace(/Z$/, '') + 'Z');
    // 拒绝 2024-02-30 这类「格式对但日期不存在」的值。
    // 不带 Z 的时间戳按 UTC 解释（直接 parse 会用服务器本地时区，
    // 在非 UTC 服务器上会把合法输入判成无效）。
    if (isNaN(t) || new Date(t).toISOString().slice(0, 19) !== u.replace(/Z$/, '')) {
        throw new Error('解封时间无效，应为 2024-06-01T12:00:00Z');
    }
    u = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
    const data = load();
    if (!Array.isArray(data.rules)) data.rules = [];
    // 同一 rule 覆盖，不重复添加
    data.rules = data.rules.filter((r) => r.rule !== rule);
    data.rules.push({
        rule,
        reason: String(reason || '').slice(0, 200),
        until: u,
        by: by || '',
        at: nowIso(),
    });
    save(data);
    return rule;
}

// 返回被移除的规则条数
function removeByRule(rule) {
    rule = String(rule || '').trim();
    const data = load();
    if (!Array.isArray(data.rules)) return 0;
    const before = data.rules.length;
    data.rules = data.rules.filter((r) => r.rule !== rule);
    const removed = before - data.rules.length;
    if (removed > 0) save(data);
    return removed;
}

module.exports = { validateRule, matchRule, isBanned, addBan, removeByRule, listAll };