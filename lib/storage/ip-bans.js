'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

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
    } catch (e) { return { rules: [] }; }
}

function save(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
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
            if (a < 0 || b > 255 || a > b) {
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
    const data = load();
    if (!Array.isArray(data.rules)) data.rules = [];
    // 同一 rule 覆盖，不重复添加
    data.rules = data.rules.filter((r) => r.rule !== rule);
    data.rules.push({
        rule,
        reason: String(reason || '').slice(0, 200),
        until: until || '',
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