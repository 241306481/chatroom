'use strict';

// 封禁到期时间（until）的规范化与比较。
//
// 全站唯一实现：lib/auth/bans.js、lib/storage/ip-bans.js、lib/auth/checks.js 共用。
// 独立成叶子模块（不 require 任何东西），是因为 auth 与 storage 互相依赖——
// auth → storage 会成环，而这两边都需要它。
//
// 背景：封禁是否生效靠 until 与 now 的**字典序比较**（until > now 即仍生效）。
// ISO 8601 定宽且零填充，字典序恰好等于时间先后，因此不必转 Date 就能比。
// 但这条性质只在日期**真实存在**时成立：`2099-99-99T99:99:00Z` 形状完全合法，
// 字典序却远大于任何 now，于是封禁静默变成永久；反过来 `2024-99-99` 会让封禁
// 当场失效。所以每次比较前都要先确认值本身站得住。

const SHAPE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?Z?$/;

function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 把输入规范化成「秒 + Z」形态。
 * @returns {string|null} '' 表示永久（调用方显式留空）；
 *   null 表示非法，调用方必须报错回退，绝不能退化成 ''（空串恰好就是「永久」）。
 */
function normalizeUntil(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const m = SHAPE_RE.exec(s);
    if (!m) return null;
    const iso = m[1] + 'T' + m[2] + ':' + (m[3] || '00') + 'Z';
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    // 拒绝 2024-02-30 这类「格式对但日期不存在」的值
    if (new Date(t).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 存储值是否有效。非法请交给 auditInvalidBans 报告，不要就地改。
 * 空串是合法的「永久」标记——repairInvalidBans 正是把非法值归一到它。
 */
function isValidUntil(v) {
    if (v === undefined || v === null) return true;
    const s = String(v).trim();
    if (!s) return true;
    return normalizeUntil(s) !== null;
}

/**
 * 封禁是否仍然生效。
 *
 * 存储值先规范化再比较，所以历史数据里缺秒/缺 Z 的写法也能正确判定。
 * 规范化失败（值本身非法）时**保守视为仍生效**：封禁记录存在即说明管理员
 * 有意为之，悄悄解封是安全回退；此处判为永久属于故意保守，配合
 * auditInvalidBans 的报告与 repairInvalidBans 的修复，不会真的无人知晓。
 */
function isUntilActive(until, now) {
    if (until === undefined || until === null || until === '') return true;
    const n = normalizeUntil(until);
    if (n === null || n === '') return true;
    return n > (now || nowIso());
}

/**
 * 禁言是否仍然生效。
 *
 * 与封禁的差别只有一处，但这一处是致命的：封禁记录的存在即代表「被封了」，
 * 空 until 表示永久；禁言记录则可能是从未禁言（muted_until 为 undefined），
 * 也可能是解禁后被写成 ''。这两种都必须算「未禁言」，
 * 直接套用 isUntilActive 会把所有正常成员判成永久禁言，消息全被拦下。
 */
function isMuteActive(until, now) {
    if (until === undefined || until === null || until === '') return false;
    const n = normalizeUntil(until);
    if (n === null) return true;   // 非法值保守视为仍禁言
    return n > (now || nowIso());
}

module.exports = { nowIso, normalizeUntil, isValidUntil, isUntilActive, isMuteActive };
