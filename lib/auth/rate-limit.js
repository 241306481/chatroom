'use strict';
// 登录限流：转发到通用限流模块（lib/rate-limit）。
// 限流键统一按 uid 归一，避免同一账号用「昵称」和「UID」
// 两种写法各算一份配额。

const limiter = require('../rate-limit');

// 账号键：能定位到用户就用 uid，否则用原始输入
function accountKey(account) {
    const key = String(account || '').trim();
    if (!key) return '';
    if (!/^\d+$/.test(key)) return key;
    try {
        const u = require('../storage').loadUser(key);
        if (u && u.id) return 'uid:' + u.id;
    } catch (e) {}
    return key;
}

function checkLoginAllowed(nickname, ip) {
    const hit = limiter.check('login', {
        ip: ip || '',
        account: accountKey(nickname),
    });
    if (!hit) return null;
    if (hit.dim === 'account') {
        return '该账号尝试过于频繁，请 ' + hit.mins + ' 分钟后再试';
    }
    return '当前 IP 登录尝试过于频繁，请 ' + hit.mins + ' 分钟后再试';
}

function noteFailure(nickname, ip) {
    limiter.note('login', {
        ip: ip || '',
        account: accountKey(nickname),
    });
}

function noteSuccess(nickname, ip) {
    limiter.clear('login', {
        ip: ip || '',
        account: accountKey(nickname),
    });
}

function stats() {
    return limiter.snapshot().login || {};
}

module.exports = { checkLoginAllowed, noteFailure, noteSuccess, stats };
