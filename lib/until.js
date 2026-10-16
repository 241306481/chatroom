'use strict';

// 解禁时间规范化。叶子模块防循环：auth 与 storage 互相依赖，两边都要用

const SHAPE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?Z?$/;

function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// 非法返 null
function normalizeUntil(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const m = SHAPE_RE.exec(s);
    if (!m) return null;
    const iso = m[1] + 'T' + m[2] + ':' + (m[3] || '00') + 'Z';
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    // 回写比对日期真实性
    if (new Date(t).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// 空串为永久
function isValidUntil(v) {
    if (v === undefined || v === null) return true;
    const s = String(v).trim();
    if (!s) return true;
    return normalizeUntil(s) !== null;
}

// 空为永久，非法仍生效
function isUntilActive(until, now) {
    if (until === undefined || until === null || until === '') return true;
    const n = normalizeUntil(until);
    if (n === null || n === '') return true;
    return n > (now || nowIso());
}

// 空值算未禁言
function isMuteActive(until, now) {
    if (until === undefined || until === null || until === '') return false;
    const n = normalizeUntil(until);
    if (n === null) return true;   // 非法值保守视为仍禁言
    return n > (now || nowIso());
}

module.exports = { nowIso, normalizeUntil, isValidUntil, isUntilActive, isMuteActive };
