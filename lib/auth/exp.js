'use strict';
const storage = require('../storage');
const { sendSystemDM } = require('./system-dm');
const { ADMIN_LEVEL } = require('../permissions');

function expToLevel(exp) {
    if (!exp || exp <= 0) return 0;
    if (exp < 5) return 0;
    if (exp < 15) return 1;
    if (exp < 45) return 2;
    if (exp < 90) return 3;
    if (exp < 180) return 4;
    if (exp < 430) return 5;
    // exp >= 430：f(5+k) = 180 + k*250，level = 5 + k
    const k = Math.floor((exp - 180) / 250);
    return 5 + k;
}

// 升到 level+1 所需的经验总量（UI 展示用）
function expForNextLevel(level) {
    if (level <= 0) return 5;
    if (level === 1) return 15;
    if (level === 2) return 45;
    if (level === 3) return 90;
    if (level === 4) return 180;
    return 180 + (level - 4) * 250;
}

function addExp(dn, uid, delta) {
    if (!dn || !uid || !delta) return;
    flushExp(dn, uid, delta);
}

function flushExp(dn, uid, delta) {
    if (!dn || !uid) return;

    let domain;
    try { domain = storage.loadDomain(dn); }
    catch (e) { return; }
    if (!domain || !domain.members) return;

    const m = domain.members[uid];
    if (!m) return;

    if (m.level === ADMIN_LEVEL) return;

    const oldLevel = m.level || 0;
    const oldExp = m.exp || 0;
    if (delta) m.exp = oldExp + delta;
    const nextLevel = expToLevel(m.exp || 0);

    if (nextLevel === oldLevel) {
        try { storage.saveDomain(dn, domain); } catch (e) {}
        return;
    }

    m.level = nextLevel;
    try {
        storage.saveDomain(dn, domain);
    } catch (e) {
        return;
    }
    if (nextLevel > oldLevel) {
        try {
            sendSystemDM(uid,
                `你在「${domain.display_name || dn}」升到了 Lv.${nextLevel}`);
        } catch (e) {}
    }
}

process.once('exit', () => {
    try { flushExp(); } catch (e) {}
});

module.exports = { expToLevel, expForNextLevel, addExp, flushExp };