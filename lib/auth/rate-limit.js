'use strict';


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