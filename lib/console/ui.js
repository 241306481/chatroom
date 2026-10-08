'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { PRIV, hasPriv } = require('../permissions');

// ============================================================
// 颜色
// ============================================================
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
    white: '\x1b[97m',
};

// ============================================================
// 宽度 / 对齐
// ============================================================
function stripAnsi(s) {
    return String(s == null ? '' : s).replace(/\x1b\[[0-9;]*m/g, '');
}

function displayWidth(s) {
    let w = 0;
    for (const ch of stripAnsi(s)) {
        w += /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
    }
    return w;
}

function padR(s, n) {
    s = String(s == null ? '' : s);
    let w = displayWidth(s);
    while (w < n) { s += ' '; w++; }
    return s;
}

// ============================================================
// 格式化
// ============================================================
function fmtIso(iso) {
    if (!iso) return '—';
    return String(iso).replace('T', ' ').replace(/Z$/, '');
}

function formatSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function shortId(id, n) {
    return String(id || '').substring(0, n || 8);
}

function privLabel(priv) {
    const flags = [];
    if (hasPriv(priv, PRIV.MANAGE_ALL_DOMAIN)) flags.push('超管');
    if (hasPriv(priv, PRIV.MANAGE_SYSTEM))     flags.push('系统');
    if (hasPriv(priv, PRIV.MANAGE_USERS))      flags.push('用户');
    if (hasPriv(priv, PRIV.MANAGE_DOMAINS))    flags.push('域');
    if (hasPriv(priv, PRIV.VIEW_ALL_DOMAIN))   flags.push('全可见');
    return flags.length ? flags.join('/') : '普通';
}

function banMark(u) {
    return auth.isUserBanned(u)
        ? `${C.red}已封禁${C.reset}`
        : `${C.green}正常  ${C.reset}`;
}

// ============================================================
// 私信策略标签
// ============================================================
const DM_POLICY_LABELS = {
    'everyone':  '所有人（拉黑除外）',
    'mutual':    '互相关注的人与管理员',
    'following': '我关注的人与管理员',
    'admin':     '仅管理员',
};

// ============================================================
// ID / 用户解析
// ============================================================
function resolveFileId(input, files) {
    if (!input) return { error: '请提供文件 id 或前缀' };
    const exact = files.find(f => f.id === input);
    if (exact) return exact.id;
    const matches = files.filter(f => f.id.startsWith(input));
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0) return { error: `未找到匹配的文件「${input}」` };
    return { error: `前缀「${input}」匹配到 ${matches.length} 个文件，请输长一点` };
}

function resolveUser(uid) {
    if (!uid) return null;
    const u = storage.loadUser(uid);
    return u.id ? u : null;
}

function userTag(u) {
    return `${u.nickname || '?'}(${u.id})`;
}

module.exports = {
    C, stripAnsi, displayWidth, padR,
    fmtIso, formatSize, shortId, privLabel, banMark,
    DM_POLICY_LABELS,
    resolveFileId, resolveUser, userTag,
};