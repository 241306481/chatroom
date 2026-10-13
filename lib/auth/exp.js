'use strict';
const storage = require('../storage');
const { sendSystemDM } = require('./system-dm');

// ============================================================
// 经验 → 等级
// ============================================================
// 经验阈值曲线：
//   f(0)=0  f(1)=5  f(2)=15  f(3)=45  f(4)=90  f(5)=180
//   f(x) = f(x-1) + 250             (x > 5)
//          f(x-1) * (x > 3 ? 2 : 3) (x <= 5)
// 即 exp ∈ [f(n), f(n+1)) 对应 level n。
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

// ============================================================
// 内存累计缓冲
// ============================================================
// key: "dn\u0000uid" -> { delta: number }
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

module.exports = { expToLevel, expForNextLevel, addExp, flushExp };
