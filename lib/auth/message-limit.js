'use strict';
const { PRIV, hasPriv } = require('../permissions');
const DEFAULT_MAX_MESSAGE_CHARS = 1000000;
const MAX_CONFIGURED_MESSAGE_CHARS = 10000000;
const WS_MAX_PAYLOAD = MAX_CONFIGURED_MESSAGE_CHARS * 4 + 2 * 1024 * 1024;
function normalizeMaxChars(raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_MESSAGE_CHARS;
    return Math.min(MAX_CONFIGURED_MESSAGE_CHARS, Math.floor(parsed));
}
function normalizePolicy(config) {
    const cfg = config || {};
    return { maxChars: normalizeMaxChars(cfg.max_message_chars) };
}
function countChars(value) {
    return Array.from(String(value == null ? '' : value)).length;
}
function canBypass(user) {
    return hasPriv(user, 'system', PRIV.SYSTEM.BYPASS_MESSAGE_LIMIT);
}
function checkMessageLength(user, content, config) {
    const maxChars = normalizePolicy(config).maxChars;
    if (canBypass(user)) return { ok: true, maxChars, bypass: true, length: 0 };
    const length = countChars(content);
    if (length > maxChars) {
        return {
            ok: false,
            maxChars,
            bypass: false,
            length,
            error: '消息不能超过 ' + maxChars + ' 个字符（当前 ' + length + ' 个字符）',
        };
    }
    return { ok: true, maxChars, bypass: false, length };
}
module.exports = {
    DEFAULT_MAX_MESSAGE_CHARS,
    MAX_CONFIGURED_MESSAGE_CHARS,
    WS_MAX_PAYLOAD,
    normalizeMaxChars,
    normalizePolicy,
    countChars,
    canBypass,
    checkMessageLength,
};
