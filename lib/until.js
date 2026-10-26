'use strict';
const SHAPE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?Z?$/;
function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function normalizeUntil(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const m = SHAPE_RE.exec(s);
    if (!m) return null;
    const iso = m[1] + 'T' + m[2] + ':' + (m[3] || '00') + 'Z';
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    if (new Date(t).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function isValidUntil(v) {
    if (v === undefined || v === null) return true;
    const s = String(v).trim();
    if (!s) return true;
    return normalizeUntil(s) !== null;
}
function isUntilActive(until, now) {
    if (until === undefined || until === null || until === '') return true;
    const n = normalizeUntil(until);
    if (n === null || n === '') return true;
    return n > (now || nowIso());
}
function isMuteActive(until, now) {
    if (until === undefined || until === null || until === '') return false;
    const n = normalizeUntil(until);
    if (n === null) return true;
    return n > (now || nowIso());
}
module.exports = { nowIso, normalizeUntil, isValidUntil, isUntilActive, isMuteActive };
