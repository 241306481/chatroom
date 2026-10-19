'use strict';
const storage = require('../storage');
const { sendSystemDM } = require('./system-dm');
const { ADMIN_LEVEL } = require('../permissions');

// 经验等级上限：留一个 99 给特权用户的展示哨兵，
// 有机升级不能撞上它，否则会被当成管理员而停止结算
const MAX_LEVEL = ADMIN_LEVEL - 1;

function expToLevel(exp) {
    if (!exp || exp <= 0) return 0;
    if (exp < 5) return 0;
    if (exp < 15) return 1;
    if (exp < 45) return 2;
    if (exp < 90) return 3;
    if (exp < 180) return 4;
    if (exp < 430) return 5;
    // 高段公式
    const k = Math.floor((exp - 180) / 250);
    return Math.min(5 + k, MAX_LEVEL);
}

// 升下一级所需经验
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

    // 原来这里对 level===99 直接 return，导致新建域的 owner（存的就是 99）
    // 永远拿不到经验。99 只是特权用户的展示哨兵，不该参与结算。
    // 这里改为照常按 exp 重算 level，顺带自愈历史脏数据。
    const oldLevel = m.level || 0;
    const oldExp = m.exp || 0;
    if (delta) m.exp = Math.max(0, oldExp + delta);
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
                `你在域「${domain.display_name || dn}」升到了 Lv.${nextLevel}`);
        } catch (e) {}
    }
}

process.once('exit', () => {
    try { flushExp(); } catch (e) {}
});

module.exports = { expToLevel, expForNextLevel, addExp, flushExp };