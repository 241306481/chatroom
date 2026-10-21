'use strict';
// 通用限流：按动作分桶，支持 IP / 账号 两个维度。
//
// 为什么不能只靠 IP：
// cookie 被搬走后，攻击者换 IP 就能绕过纯 IP 限流。
// 所以已登录动作同时按「账号」计数——换 IP 也逃不掉同一账号的配额。
//
// localhost 豁免：限流只是兜底，本机调试不该被它挡住。
//
// 配置存 system 域的 system_config.rate_limits，运行时可改。

const storage = require('../storage');

const WINDOW_MAX = 60;          // 手动可设的上限（分钟）
const MAX_KEYS = 20000;         // Map 容量上限
const CLEAN_INTERVAL = 60 * 1000;   // 过期计数清理间隔

// 本机地址：这些来源不参与限流
const LOCAL_IPS = new Set([
    '127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1',
]);

// 各动作默认配置。0 或缺省表示该维度不限制。
// 档位按「正常人远达不到、脚本一下就超」来定，避免误伤。
// 出厂默认的 windowMin 都不超过 10 分钟；手动可调到 60 分钟。
// 手动设的值会被夹到 1..WINDOW_MAX，夹不动时回落到这里的出厂值。
const DEFAULTS = {
    login:         { label: '登录',     windowMin: 10, perIp: 30, perAccount: 8 },
    register:      { label: '注册',     windowMin: 10, perIp: 10, perAccount: 3 },
    page_view:     { label: '访问页面', windowMin: 1,  perIp: 600, perAccount: 120 },
    file_download: { label: '下载文件', windowMin: 1,  perIp: 300, perAccount: 60 },
    search:        { label: '搜索',     windowMin: 1,  perIp: 60,  perAccount: 30 },
    post_message:  { label: '发消息',   windowMin: 1,  perIp: 120, perAccount: 60 },
    dm_send:       { label: '私信',     windowMin: 1,  perIp: 120, perAccount: 60 },
    upload_file:   { label: '上传文件', windowMin: 10, perIp: 30,  perAccount: 20 },
    create_domain: { label: '建域',     windowMin: 10, perIp: 10,  perAccount: 5 },
    // 兼容旧键名
    register_ip: null,
};

// 动作键归一
function normalizeAction(action) {
    const a = String(action || '').trim();
    if (a === 'register_ip') return 'register';
    return a;
}

// 本机来源豁免
function isLocal(ip) {
    if (!ip) return false;
    const s = String(ip).trim().toLowerCase();
    if (LOCAL_IPS.has(s)) return true;
    // 整个 127.0.0.0/8 都是本机
    if (s.startsWith('127.')) return true;
    return false;
}

let cachedConfig = null;
let cachedAt = 0;

function loadConfig() {
    const now = Date.now();
    if (cachedConfig && now - cachedAt < 30000) return cachedConfig;
    const cfg = {};
    try {
        const domain = storage.loadDomain('system');
        const saved = (domain && domain.system_config && domain.system_config.rate_limits) || {};
        for (const [k, v] of Object.entries(saved)) {
            if (!v || typeof v !== 'object') continue;
            const d = DEFAULTS[k];
            if (!d) continue;   // 未知动作直接丢，不进配置
            cfg[k] = {
                label: String(v.label || d.label),
                windowMin: clamp(v.windowMin, 1, WINDOW_MAX, d.windowMin),
                perIp: clamp(v.perIp, 0, 1000000, d.perIp),
                perAccount: clamp(v.perAccount, 0, 1000000, d.perAccount),
            };
        }
    } catch (e) { /* 用默认值 */ }

    // 补齐默认动作
    for (const [k, d] of Object.entries(DEFAULTS)) {
        if (!d || cfg[k]) continue;
        cfg[k] = { ...d };
    }
    cachedConfig = cfg;
    cachedAt = now;
    return cfg;
}

function clamp(v, min, max, dflt) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
}

function invalidate() { cachedConfig = null; cachedAt = 0; }

// 桶：action -> dimension -> key -> { n, t }
const buckets = new Map();

function bucket(action, dim) {
    let byDim = buckets.get(action);
    if (!byDim) { byDim = new Map(); buckets.set(action, byDim); }
    let m = byDim.get(dim);
    if (!m) { m = new Map(); byDim.set(dim, m); }
    return m;
}

function hit(map, key) {
    const now = Date.now();
    let e = map.get(key);
    if (!e || now - e.t >= (map.windowMs || 0)) {
        e = { n: 0, t: now };
        map.set(key, e);
    }
    e.n++;
    return e.n;
}

// 检查：任一维度超限即拒绝
function check(action, keys) {
    const a = normalizeAction(action);
    const cfg = loadConfig()[a];
    if (!cfg) return null;

    // 本机不限制
    if (isLocal(keys.ip)) return null;

    const windowMs = cfg.windowMin * 60 * 1000;
    const now = Date.now();

    const dims = [
        ['ip', cfg.perIp, keys.ip],
        ['account', cfg.perAccount, keys.account],
    ];

    for (const [dim, limit, key] of dims) {
        if (!limit || !key) continue;
        const m = bucket(a, dim);
        m.windowMs = windowMs;
        const e = m.get(key);
        if (e && now - e.t < windowMs && e.n >= limit) {
            const leftMs = windowMs - (now - e.t);
            return {
                action: a,
                dim,
                limit,
                leftMs,
                // 剩余时间：秒（向上取整）+ 友好文案
                leftSec: Math.max(1, Math.ceil(leftMs / 1000)),
                mins: Math.max(1, Math.ceil(leftMs / 60000)),
            };
        }
    }
    return null;
}

// 记一次
function note(action, keys) {
    const a = normalizeAction(action);
    if (isLocal(keys.ip)) return;   // 本机不计数
    const cfg = loadConfig()[a];
    if (!cfg) return;
    const windowMs = cfg.windowMin * 60 * 1000;

    if (cfg.perIp && keys.ip) {
        const m = bucket(a, 'ip');
        m.windowMs = windowMs;
        hit(m, keys.ip);
    }
    if (cfg.perAccount && keys.account) {
        const m = bucket(a, 'account');
        m.windowMs = windowMs;
        hit(m, keys.account);
    }

    enforceCap();
}

// 成功：清掉该账号/IP 的计数
function clear(action, keys) {
    const a = normalizeAction(action);
    const byDim = buckets.get(a);
    if (!byDim) return;
    for (const [dim, key] of [['ip', keys.ip], ['account', keys.account]]) {
        if (!key) continue;
        const m = byDim.get(dim);
        if (m) m.delete(key);
    }
}

// 清理过期计数：窗口过的直接删
function cleanExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [action, byDim] of buckets) {
        for (const [dim, m] of byDim) {
            const win = m.windowMs || 0;
            for (const [key, e] of m) {
                if (now - e.t >= win) { m.delete(key); removed++; }
            }
            if (m.size === 0) byDim.delete(dim);
        }
        if (byDim.size === 0) buckets.delete(action);
    }
    return removed;
}

// 定时清理，避免存一堆无效数据
let cleanTimer = null;
function startCleaner() {
    if (cleanTimer) return;
    cleanTimer = setInterval(cleanExpired, CLEAN_INTERVAL);
    if (cleanTimer.unref) cleanTimer.unref();
}
startCleaner();

// 容量兜底：超上限时先清过期，再丢最旧的
function enforceCap() {
    for (const byDim of buckets.values()) {
        for (const m of byDim.values()) {
            if (m.size <= MAX_KEYS) continue;
            for (const [k, v] of m) {
                if (Date.now() - v.t >= (m.windowMs || 0)) m.delete(k);
            }
            while (m.size > MAX_KEYS) {
                const oldest = m.keys().next().value;
                if (oldest === undefined) break;
                m.delete(oldest);
            }
        }
    }
}

// 实时计数快照，供管理页展示
function snapshot() {
    const now = Date.now();
    const out = {};
    for (const [action, byDim] of buckets) {
        const per = {};
        for (const [dim, m] of byDim) {
            const list = [];
            for (const [key, v] of m) {
                if (now - v.t >= (m.windowMs || 0)) continue;
                list.push({
                    key, n: v.n,
                    secsLeft: Math.ceil(((m.windowMs || 0) - (now - v.t)) / 1000),
                });
            }
            list.sort((a, b) => b.n - a.n);
            per[dim] = list.slice(0, 20);
        }
        out[action] = per;
    }
    return out;
}

// 全部动作的当前配置
function listConfig() {
    const cfg = loadConfig();
    return Object.entries(cfg).map(([action, c]) => ({ action, ...c }));
}

// 保存配置
function saveConfig(list) {
    let domain;
    try { domain = storage.loadDomain('system'); } catch (e) { return false; }
    if (!domain) return false;
    if (!domain.system_config) domain.system_config = {};
    const saved = {};
    for (const item of list || []) {
        const action = normalizeAction(item.action);
        const d = DEFAULTS[action];
        if (!d) continue;   // 只保存已知动作
        saved[action] = {
            label: String(item.label || d.label).slice(0, 20),
            windowMin: clamp(item.windowMin, 1, WINDOW_MAX, d.windowMin),
            perIp: clamp(item.perIp, 0, 1000000, d.perIp),
            perAccount: clamp(item.perAccount, 0, 1000000, d.perAccount),
        };
    }
    domain.system_config.rate_limits = saved;
    try { storage.saveDomain('system', domain); } catch (e) { return false; }
    invalidate();
    return true;
}

// 清空计数
function resetCounters(action) {
    if (action) {
        buckets.delete(normalizeAction(action));
    } else {
        buckets.clear();
    }
}

module.exports = {
    check, note, clear, snapshot, listConfig, saveConfig, resetCounters,
    invalidate, cleanExpired, isLocal, DEFAULTS, normalizeAction,
    WINDOW_MAX,
};