'use strict';
const path = require('path');
const { DATA_DIR } = require('./paths');
const { ensureDir, readJsonState, quarantineCorrupt, writeJsonAtomic } = require('./fs-utils');
const FILE = path.join(DATA_DIR, 'ip_bans.json');
let _cache = null;
let _cacheAt = 0;
const TTL = 60 * 1000;
function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function load() {
    const r = readJsonState(FILE);
    if (r.state === 'corrupt') {
        quarantineCorrupt(FILE, 'IP 封禁规则');
        return { rules: [] };
    }
    const d = r.value;
    return d && typeof d === 'object' ? d : { rules: [] };
}
function save(data) {
    ensureDir(DATA_DIR);
    writeJsonAtomic(FILE, data);
    _cache = null;
    _cacheAt = 0;
}
const LOOPBACK0 = [127, 0];
function segmentCovers(seg, target) {
    seg = String(seg).trim();
    if (seg === '*') return true;
    if (/^\d+$/.test(seg)) return parseInt(seg, 10) === target;
    const m = seg.match(/^(\d+)-(\d+)$/);
    if (m) {
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        return target >= a && target <= b;
    }
    return false;
}
function coversLoopback(rule) {
    const parts = String(rule || '').trim().split('.');
    if (parts.length !== 4) return false;
    return [...LOOPBACK0].some((n) => segmentCovers(parts[0], n));
}
function validateRule(rule) {
    const parts = String(rule || '').trim().split('.');
    if (parts.length !== 4) throw new Error('IP 需为 4 段，如 1.2.3.4 或 1.2.3.*');
    for (const raw of parts) {
        const p = raw.trim();
        if (p === '*') continue;
        if (/^\d+$/.test(p)) {
            const n = parseInt(p, 10);
            if (n < 0 || n > 255) throw new Error('数值需在 0-255：' + p);
            continue;
        }
        const m = p.match(/^(\d+)-(\d+)$/);
        if (m) {
            const a = parseInt(m[1], 10);
            const b = parseInt(m[2], 10);
            if (a < 0 || a > 255 || b < 0 || b > 255 || a > b) {
                throw new Error('范围需 0-255 且 a<=b：' + p);
            }
            continue;
        }
        throw new Error('未知格式：' + p);
    }
    if (coversLoopback(rule)) {
        throw new Error('不能封禁本机地址（127.x / 0.0.0.0 / *.*.*.*）');
    }
    return true;
}
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
function getRules() {
    const now = Date.now();
    if (_cache && now - _cacheAt < TTL) return _cache;
    const data = load();
    _cache = Array.isArray(data.rules) ? data.rules : [];
    _cacheAt = now;
    return _cache;
}
function isBanned(ip) {
    if (!ip) return null;
    const { isUntilActive } = require('../until');
    for (const rec of getRules()) {
        if (!isUntilActive(rec.until)) continue;
        if (matchRule(ip, rec.rule)) return rec;
    }
    return null;
}
function listAll() {
    const data = load();
    return Array.isArray(data.rules) ? data.rules : [];
}
function addBan(rule, { reason, until, by } = {}) {
    rule = String(rule || '').trim();
    validateRule(rule);
    const u = require('../until').normalizeUntil(until);
    if (u === null) throw new Error('解封时间无效，格式应为 yyyy-mm-ddThh:mm(Z)');
    const data = load();
    if (!Array.isArray(data.rules)) data.rules = [];
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
function replaceAll(rules) {
    if (!Array.isArray(rules)) return;
    save({ rules });
}
function setUntil(rule, until) {
    rule = String(rule || '').trim();
    const u = require('../until').normalizeUntil(until);
    if (u === null) throw new Error('解封时间无效，格式应为 yyyy-mm-ddThh:mm(Z)');
    const data = load();
    if (!Array.isArray(data.rules)) throw new Error('规则不存在：' + rule);
    const rec = data.rules.find((r) => r.rule === rule);
    if (!rec) throw new Error('规则不存在：' + rule);
    rec.until = u;
    rec.by = '';
    rec.at = nowIso();
    save(data);
    return u;
}
function isExpired(rec) {
    return !require('../until').isUntilActive(rec && rec.until);
}
module.exports = {
    validateRule, coversLoopback, matchRule, isBanned,
    addBan, removeByRule, setUntil, isExpired, listAll, replaceAll,
};
