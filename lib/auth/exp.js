'use strict';
const storage = require('../storage');
const { sendSystemDM } = require('./system-dm');

// ============================================================
// 经验 → 等级
// ============================================================
function expToLevel(exp) {
    for (let i = 0; ; i++) if (exp <= i * 50) return i;
}

// ============================================================
// 增加经验
// ============================================================
function addExp(dn, uid, delta) {
    const domain = storage.loadDomain(dn);
    if (!domain.members || !domain.members[uid]) return;
    const m = domain.members[uid];
    const oldLevel = m.level || 0;
    m.exp = (m.exp || 0) + delta;
    m.level = expToLevel(m.exp);
    storage.saveDomain(dn, domain);

    if (m.level > oldLevel) {
        try { sendSystemDM(uid, `你在「${domain.display_name || dn}」升到了 Lv.${m.level}`); } catch (e) {}
    }
}

// ============================================================
// 每日登录经验
// ============================================================
function recordDailyLoginExp(uid) {
    if (!uid) return;
    const d = new Date();
    const today = d.getFullYear()
        + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    for (const dn of storage.listAllDomains()) {
        const dom = storage.loadDomain(dn);
        if (!dom.members || !dom.members[uid]) continue;
        const m = dom.members[uid];
        if (m.last_login_date === today) continue;
        m.last_login_date = today;
        m.exp = (m.exp || 0) + 3;
        m.level = expToLevel(m.exp);
        storage.saveDomain(dn, dom);
    }
}

module.exports = { expToLevel, addExp, recordDailyLoginExp };