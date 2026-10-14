'use strict';
const storage = require('../storage');
const { sendSystemDM } = require('./system-dm');
const { ADMIN_LEVEL } = require('../permissions');

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
// 增加经验
// ============================================================
// 立即落盘、立即发升级通知。
//
// 旧实现先攒进 pending Map、由一个 5 秒定时器批量写盘，带来两个用户可感知的问题：
//   1. 通知延迟：刚升的级最多 5 秒后才收到系统私信，刷新页面看到的等级/经验也是旧的；
//   2. 通知合并：5 秒内的多次 award 会被合成一条 pending，多次触发升级时
//      只发一条通知（甚至因跨级而只报最终等级）。
// 两者都是「即时反馈」被缓冲打断的表现。
//
// 现在没有任何跨请求的缓冲：addExp 同步落盘并在本次调用内完成升级通知，
// 调用方返回时数据已是最终状态。
//
// 代价：每条消息会多一次域配置的读+写（原来是 5 秒摊薄）。
// 这是刻意接受的取舍 —— 该存储层本来就是「每请求同步读写」的模型，
// 换来的即时性对交互（等级/经验/通知）更重要。
function addExp(dn, uid, delta) {
    if (!dn || !uid || !delta) return;
    flushExp(dn, uid, delta);
}

// ============================================================
// 写回
// ============================================================
// 保留导出：外部（退出钩子、将来的批量任务）仍可能需要显式触发。
// 内部不再有缓冲，因此无参调用是空操作。
function flushExp(dn, uid, delta) {
    if (!dn || !uid) return;

    let domain;
    try { domain = storage.loadDomain(dn); }
    catch (e) { return; }
    if (!domain || !domain.members) return;

    const m = domain.members[uid];
    if (!m) return;

    // level 字段同时承载管理员身份（ADMIN_LEVEL）与经验等级。
    // 不能无条件用 expToLevel 覆盖，否则域主/管理员发一条消息
    // 就会从 99 掉到 0，并反复触发升级私信。
    if (m.level === ADMIN_LEVEL) return;

    const oldLevel = m.level || 0;
    const oldExp = m.exp || 0;
    if (delta) m.exp = oldExp + delta;
    const nextLevel = expToLevel(m.exp || 0);

    if (nextLevel === oldLevel) {
        // 等级没变也要写盘：否则 4 条消息累积的经验会凭空蒸发，
        // 成员永远停在 0 级。
        try { storage.saveDomain(dn, domain); } catch (e) {}
        return;
    }

    m.level = nextLevel;
    try {
        storage.saveDomain(dn, domain);
    } catch (e) {
        // 写盘失败：经验没落库，重试时会再发一次通知，可接受，
        // 优于静默丢弃并让等级与经验永久错位。
        return;
    }
    if (nextLevel > oldLevel) {
        try {
            sendSystemDM(uid,
                `你在「${domain.display_name || dn}」升到了 Lv.${nextLevel}`);
        } catch (e) {}
    }
}

// ============================================================
// 进程退出时 flush（无缓冲后基本是空操作，保留以防将来引入缓冲）
//
// 注意：这里只监听 'exit'，不能注册 SIGINT/SIGTERM。
// server.js 已经在这两个信号上做「停止收新请求 → 关闭 WS → 关 HTTP」的
// 优雅关闭；本模块若再 process.exit()，会抢先把进程干掉，
// 导致客户端拿不到 1001 关闭帧、在途请求被截断。
// ============================================================
process.once('exit', () => {
    try { flushExp(); } catch (e) {}
});

module.exports = { expToLevel, expForNextLevel, addExp, flushExp };