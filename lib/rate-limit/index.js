'use strict';
// 通用限流：按动作分桶，支持 IP / 账号 两个维度。
//
// 为什么不能只靠 IP：
// cookie 被搬走后，攻击者换 IP 就能绕过纯 IP 限流。
// 所以已登录动作同时按「账号」计数——换 IP 也逃不掉同一账号的配额。
//
// 登录/注册只用 IP 维度：那时还不知道对方是谁。
//
// 配置存 system 域的 system_config.rate_limits，运行时可改。

const storage = require('../storage');

const WINDOW_DEFAULT = 15;      // 分钟
const MAX_KEYS = 20000;         // Map 容量上限

// 各动作默认配置。0 或缺省表示该维度不限制。
const DEFAULTS = {
    login:         { label: '登录',     windowMin: 15, perIp: 30, perAccount: 0 },
    register:      { label: '注册',     windowMin: 60, perIp: 5,  perAccount: 0 },
    page_view:     { label: '访问页面', windowMin: 1,  perIp: 600, perAccount: 120 },
    file_download: { label: '下载文件', windowMin: 1,  perIp: 300, perAccount: 60 },
    search:        { label: '搜索',     windowMin: 1,  perIp: 60,  perAccount: 30 },
    post_message:  { label: '发消息',   windowMin: 1,  perIp: 60,  perAccount: 30 },
    dm_send:       { label: '私信',     windowMin: 1,  perIp: 60,  perAccount: 30 },
    upload_file:   { label: '上传',     windowMin: 10, perIp: 30,  perAccount: 20 },
    create_domain: { label: '建域',     windowMin: 60, perIp: 10,  perAccount: 5 },
    // 兼容旧键名
    register_ip: null,
};

// 动作键归一
function normalizeAction(action) {
    const a = String(action || '').trim();
    if (a === 'register_ip') return 'register';
    return a;
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
            cfg[k] = {
                label: String(v.label || (d && d.label) || k),
                windowMin: clamp(v.windowMin, 1, 1440, d ? d.windowMin : WINDOW_DEFAULT),
                perIp: clamp(v.perIp, 0, 1000000, d ? d.perIp : 0),
                perAccount: clamp(v.perAccount, 0, 1000000, d ? d.perAccount : 0),
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
            const mins = Math.max(1, Math.ceil((windowMs - (now - e.t)) / 60000));
            return { action: a, dim, mins, limit };
        }
    }
    return null;
}

// 记一次
function note(action, keys) {
    const a = normalizeAction(action);
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
    prune();
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

function prune() {
    const now = Date.now();
    for (const byDim of buckets.values()) {
        for (const m of byDim.values()) {
            if (m.size <= MAX_KEYS) continue;
            for (const [k, v] of m) {
                if (now - v.t >= (m.windowMs || 0)) m.delete(k);
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
                list.push({ key, n: v.n, secsLeft: Math.ceil(((m.windowMs || 0) - (now - v.t)) / 1000) });
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
        if (!action) continue;
        saved[action] = {
            label: String(item.label || action).slice(0, 20),
            windowMin: clamp(item.windowMin, 1, 1440, WINDOW_DEFAULT),
            perIp: clamp(item.perIp, 0, 1000000, 0),
            perAccount: clamp(item.perAccount, 0, 1000000, 0),
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
    invalidate, DEFAULTS, normalizeAction,
};