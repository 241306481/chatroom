'use strict';
const crypto = require('crypto');
const storage = require('../storage');

// 会话：token -> { uid, createdAt, uaHash, ips }
// 绑定设备指纹，防止 cookie 被搬到别的浏览器/地方使用。
const sessions = new Map();

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_MAX_IPS = 5;      // 一个会话允许出现多少个不同 IP
const DEFAULT_MAX_UAS = 3;      // 一个会话允许出现过多少个不同 UA
let cachedTtlMs = null;
let cachedAt = 0;

function getTtlMs() {
    const now = Date.now();
    if (cachedTtlMs !== null && now - cachedAt < 60 * 1000) return cachedTtlMs;
    let hours = DEFAULT_TTL_HOURS;
    try {
        const cfg = storage.loadDomain('system').system_config || {};
        const h = parseInt(cfg.session_timeout_hours, 10);
        if (!isNaN(h) && h > 0) hours = h;
    } catch (e) { /* 用默认值 */ }
    cachedTtlMs = hours * 60 * 60 * 1000;
    cachedAt = now;
    return cachedTtlMs;
}

// 会话绑定设置
function getBindConfig() {
    const cfg = {
        bindUa: true,               // 校验 User-Agent
        maxIps: DEFAULT_MAX_IPS,    // 允许的不同 IP 数
        maxUas: DEFAULT_MAX_UAS,    // 允许出现过的不同 UA 数
    };
    try {
        const domain = storage.loadDomain('system');
        const s = (domain && domain.system_config) || {};
        if (s.session_bind_ua === false) cfg.bindUa = false;
        if (s.session_bind_ua === true) cfg.bindUa = true;
        const m = parseInt(s.session_max_ips, 10);
        if (!isNaN(m) && m >= 1) cfg.maxIps = m;
        const u = parseInt(s.session_max_uas, 10);
        if (!isNaN(u) && u >= 1) cfg.maxUas = u;
    } catch (e) { /* 用默认 */ }
    return cfg;
}

function uaHash(ua) {
    return crypto.createHash('sha256').update(String(ua || '')).digest('hex').slice(0, 16);
}

function clearExpired() {
    const now = Date.now();
    const ttl = getTtlMs();
    for (const [token, entry] of sessions.entries()) {
        if (now - entry.createdAt > ttl) sessions.delete(token);
    }
}

let cleanupTimer = null;
function startCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(clearExpired, 10 * 60 * 1000);
    if (cleanupTimer.unref) cleanupTimer.unref();
}
startCleanup();

function createSession(uid, fingerprint) {
    const token = crypto.randomBytes(24).toString('hex');
    if (sessions.size >= 10000) clearExpired();
    const fp = fingerprint || {};
    sessions.set(token, {
        uid,
        createdAt: Date.now(),
        uaHash: fp.ua ? uaHash(fp.ua) : '',
        uas: fp.ua ? [fp.ua] : [],
        ips: fp.ip ? [fp.ip] : [],
    });
    return token;
}

// 校验会话。返回 uid 或 null。
// fingerprint 传 { ua, ip }；UA 不符或 IP 过多则判定为 cookie 被搬运。
function getSessionUser(token, fingerprint) {
    const entry = sessions.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > getTtlMs()) {
        sessions.delete(token);
        return null;
    }

    const fp = fingerprint || {};
    const cfg = getBindConfig();

    if (cfg.bindUa && entry.uaHash && fp.ua) {
        if (uaHash(fp.ua) !== entry.uaHash) {
            // UA 变了可能是用户换浏览器/手机，不立即踢。
            // 累计到一定数量才判定为 cookie 被搬运。
            if (!entry.uas) entry.uas = [];
            if (!entry.uas.includes(fp.ua)) entry.uas.push(fp.ua);
            if (entry.uas.length > cfg.maxUas) {
                sessions.delete(token);
                return null;
            }
        } else if (!entry.uas) {
            entry.uas = [fp.ua];
        }
    }

    if (fp.ip) {
        if (!entry.ips.includes(fp.ip)) entry.ips.push(fp.ip);
        // 同一会话出现在过多 IP 上，视为 cookie 外泄
        if (entry.ips.length > cfg.maxIps) {
            sessions.delete(token);
            return null;
        }
    }

    return entry.uid;
}

// 会话详情（管理页用）
function listSessions() {
    const now = Date.now();
    const ttl = getTtlMs();
    const out = [];
    for (const [token, e] of sessions) {
        out.push({
            uid: e.uid,
            createdAt: e.createdAt,
            expiresIn: Math.max(0, Math.round((ttl - (now - e.createdAt)) / 1000)),
            ipCount: (e.ips || []).length,
            ips: (e.ips || []).slice(0, 5),
            uaCount: (e.uas || []).length,
        });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
}

function destroySession(token) { sessions.delete(token); }

function destroyAllUserSessions(uid) {
    for (const [t, entry] of sessions.entries()) {
        if (entry.uid === uid) sessions.delete(t);
    }
}

module.exports = {
    createSession, getSessionUser, destroySession, destroyAllUserSessions,
    listSessions, getBindConfig, uaHash,
};