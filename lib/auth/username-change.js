'use strict';
const { PRIV, hasPriv } = require('../permissions');
const DEFAULT_INTERVAL_HOURS = 24;
const MAX_INTERVAL_HOURS = 24 * 365;
function normalizePolicy(config) {
    const cfg = config || {};
    const allow = cfg.allow_username_change !== false;
    const parsed = parseInt(cfg.username_change_interval_hours, 10);
    const hours = Number.isFinite(parsed)
        ? Math.max(0, Math.min(MAX_INTERVAL_HOURS, Math.floor(parsed)))
        : DEFAULT_INTERVAL_HOURS;
    return { allow, intervalHours: hours, intervalMs: hours * 60 * 60 * 1000 };
}
function formatWait(ms) {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    if (minutes >= 60) return Math.ceil(minutes / 60) + ' 小时';
    return minutes + ' 分钟';
}
function evaluateUsernameChange(user, config, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const policy = normalizePolicy(config);
    const bypass = hasPriv(user, 'system', PRIV.SYSTEM.BYPASS_NICKNAME_COOLDOWN);
    const lastMs = Date.parse(String((user && user.nickname_changed_at) || ''));
    const nextMs = Number.isFinite(lastMs) ? lastMs + policy.intervalMs : 0;
    const cooling = policy.allow && !bypass
        && policy.intervalMs > 0 && nextMs > now;
    let hint = '';
    if (!policy.allow) {
        hint = '系统已关闭用户名修改';
    } else if (bypass) {
        hint = '你拥有绕过用户名修改冷却的权限';
    } else if (cooling) {
        hint = '用户名修改过于频繁，请 ' + formatWait(nextMs - now) + ' 后再试';
    } else if (policy.intervalHours > 0) {
        hint = '用户名修改后需等待 ' + policy.intervalHours + ' 小时才能再次修改';
    }
    return {
        policy,
        bypass,
        cooling,
        canChange: policy.allow && (!cooling || bypass),
        hint,
    };
}
function getUsernameChangeState(user, config, nowMs) {
    const state = evaluateUsernameChange(user, config, nowMs);
    return { canChange: state.canChange, hint: state.hint };
}
function checkUsernameChange({ user, oldNickname, newNickname, config, nowMs }) {
    if (oldNickname === newNickname) return { allowed: true };
    const state = evaluateUsernameChange(user, config, nowMs);
    if (!state.policy.allow) {
        return { allowed: false, error: '系统已关闭用户名修改' };
    }
    if (state.bypass) return { allowed: true };
    if (state.cooling) {
        return { allowed: false, error: state.hint };
    }
    return { allowed: true };
}
module.exports = {
    DEFAULT_INTERVAL_HOURS,
    normalizePolicy,
    getUsernameChangeState,
    checkUsernameChange,
};
