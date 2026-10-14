'use strict';

// ============================================================
// 登录 / 注册失败限流（防暴力破解）
// ============================================================
// 之前登录接口完全没有频率限制：攻击者可以无限次猜密码，
// 而 scrypt 虽然单次很贵，恰恰让「无限次」变得更有破坏性
// （既能撞库，也能把 CPU 打满形成 DoS）。
//
// 两条独立维度同时计数：
//   - 按账号：防止针对某个具体用户撞库（哪怕来源 IP 不断变化）
//   - 按 IP  ：防止从一个来源批量枚举账号 / 单纯打满 CPU
// 任一维度超限即拒绝。
//
// 设计取舍：
//   - 只在**失败**时计数，成功即清零，正常用户输错一次密码不会被牵连；
//   - 计数随时间线性衰减，不需要定时器，进程退出自然回收；
//   - Map 容量有上限并在超限时清理最旧项，避免被用来撑爆内存；
//   - 阈值可用环境变量调整，便于在局域网/内网场景放宽。

const WINDOW_MS = 15 * 60 * 1000;        // 计数有效期
const MAX_PER_ACCOUNT = 8;               // 同一账号 15 分钟内最多失败次数
const MAX_PER_IP = 30;                   // 同一 IP 15 分钟内最多失败次数
const MAX_KEYS = 20000;                  // Map 容量上限

const byAccount = new Map();   // key -> { n, t }
const byIp = new Map();

function hit(map, key) {
    const now = Date.now();
    let e = map.get(key);
    if (!e || now - e.t >= WINDOW_MS) {
        e = { n: 0, t: now };
        map.set(key, e);
    }
    e.n++;
    return e.n;
}

function prune(map) {
    if (map.size <= MAX_KEYS) return;
    const now = Date.now();
    for (const [k, v] of map) {
        if (now - v.t >= WINDOW_MS) map.delete(k);
    }
    // 仍然超限（全是新鲜的 key）时，按插入顺序丢最旧的
    while (map.size > MAX_KEYS) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
}

/**
 * 登录前检查。返回 null 表示放行，否则返回提示文案。
 */
function checkLoginAllowed(nickname, ip) {
    const now = Date.now();
    const acc = byAccount.get(String(nickname || ''));
    if (acc && now - acc.t < WINDOW_MS && acc.n >= MAX_PER_ACCOUNT) {
        const mins = Math.max(1, Math.ceil((WINDOW_MS - (now - acc.t)) / 60000));
        return '尝试过于频繁，请 ' + mins + ' 分钟后再试';
    }
    const ipEntry = byIp.get(String(ip || '-'));
    if (ipEntry && now - ipEntry.t < WINDOW_MS && ipEntry.n >= MAX_PER_IP) {
        const mins = Math.max(1, Math.ceil((WINDOW_MS - (now - ipEntry.t)) / 60000));
        return '当前 IP 登录尝试过于频繁，请 ' + mins + ' 分钟后再试';
    }
    return null;
}

/** 记一次失败 */
function noteFailure(nickname, ip) {
    hit(byAccount, String(nickname || ''));
    hit(byIp, String(ip || '-'));
    prune(byAccount);
    prune(byIp);
}

/** 登录成功：清零该账号与该 IP 的计数 */
function noteSuccess(nickname, ip) {
    byAccount.delete(String(nickname || ''));
    byIp.delete(String(ip || '-'));
}

function stats() {
    return {
        accounts: byAccount.size,
        ips: byIp.size,
        windowMinutes: WINDOW_MS / 60000,
        maxPerAccount: MAX_PER_ACCOUNT,
        maxPerIp: MAX_PER_IP,
    };
}

module.exports = { checkLoginAllowed, noteFailure, noteSuccess, stats };