'use strict';
const limiter = require('../rate-limit');
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
function checkLoginAllowed(nickname, ip, local) {
    const hit = limiter.check('login', {
        ip: ip || '',
        account: accountKey(nickname),
        local: local === true,
    });
    if (!hit) return null;
    return hit;
}
function noteFailure(nickname, ip, local) {
    limiter.note('login', {
        ip: ip || '',
        account: accountKey(nickname),
        local: local === true,
    });
}
function noteSuccess(nickname, ip, local) {
    limiter.clear('login', {
        ip: ip || '',
        account: accountKey(nickname),
        local: local === true,
    });
}
function stats() {
    return limiter.snapshot().login || {};
}
module.exports = { checkLoginAllowed, noteFailure, noteSuccess, stats };
