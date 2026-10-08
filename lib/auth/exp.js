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
// 内存累计缓冲
// ============================================================
// key: "dn\u0000uid" -> { delta: number, last_login_date?: string }
const pending = new Map();
let flushTimer = null;
const FLUSH_INTERVAL_MS = 5000;

function key(dn, uid) { return dn + '\u0000' + uid; }

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushExp();
    }, FLUSH_INTERVAL_MS);
    if (flushTimer.unref) flushTimer.unref();
}

// ============================================================
// 增加经验（只累加，延迟写盘）
// ============================================================
function addExp(dn, uid, delta) {
    if (!dn || !uid || !delta) return;
    const k = key(dn, uid);
    const cur = pending.get(k);
    if (cur) cur.delta += delta;
    else pending.set(k, { delta });
    scheduleFlush();
}

// ============================================================
// 每日登录经验（同样延迟写盘）
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

        const k = key(dn, uid);
        const cur = pending.get(k) || { delta: 0 };
        // 内存里先标记，避免同一进程重复触发
        cur.delta += 3;
        cur.last_login_date = today;
        pending.set(k, cur);
    }
    scheduleFlush();
}

// ============================================================
// 批量写回
// ============================================================
function flushExp() {
    if (pending.size === 0) return;

    // 按域分组，减少 saveDomain 次数
    const byDomain = new Map();
    for (const [k, entry] of pending.entries()) {
        const sep = k.indexOf('\u0000');
        const dn = k.substring(0, sep);
        const uid = k.substring(sep + 1);
        if (!byDomain.has(dn)) byDomain.set(dn, []);
        byDomain.get(dn).push({ uid, ...entry });
    }
    pending.clear();

    for (const [dn, items] of byDomain.entries()) {
        let domain;
        try { domain = storage.loadDomain(dn); }
        catch (e) { continue; }
        if (!domain || !domain.members) continue;

        let dirty = false;
        for (const it of items) {
            const m = domain.members[it.uid];
            if (!m) continue;
            const oldLevel = m.level || 0;
            if (it.delta) m.exp = (m.exp || 0) + it.delta;
            if (it.last_login_date) m.last_login_date = it.last_login_date;
            m.level = expToLevel(m.exp || 0);
            dirty = true;

            if (m.level > oldLevel) {
                try {
                    sendSystemDM(it.uid,
                        `你在「${domain.display_name || dn}」升到了 Lv.${m.level}`);
                } catch (e) {}
            }
        }
        if (dirty) {
            try { storage.saveDomain(dn, domain); } catch (e) {}
        }
    }
}

// ============================================================
// 进程退出时强制 flush
// ============================================================
function installExitHook() {
    const hook = () => {
        try { flushExp(); } catch (e) {}
    };
    process.once('SIGINT', () => { hook(); process.exit(0); });
    process.once('SIGTERM', () => { hook(); process.exit(0); });
    process.once('exit', hook);
}
installExitHook();

module.exports = { expToLevel, addExp, recordDailyLoginExp, flushExp };
