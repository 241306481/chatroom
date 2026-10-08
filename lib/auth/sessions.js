'use strict';
const crypto = require('crypto');
const storage = require('../storage');

const sessions = new Map();  // token -> { uid, createdAt }

const DEFAULT_TTL_HOURS = 24;
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
    } catch (e) { /* 忽略，用默认值 */ }
    cachedTtlMs = hours * 60 * 60 * 1000;
    cachedAt = now;
    return cachedTtlMs;
}

function createSession(uid) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { uid, createdAt: Date.now() });
    return token;
}

function getSessionUser(token) {
    const entry = sessions.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > getTtlMs()) {
        sessions.delete(token);
        return null;
    }
    return entry.uid;
}

function destroySession(token) { sessions.delete(token); }

function destroyAllUserSessions(uid) {
    for (const [t, entry] of sessions.entries()) {
        if (entry.uid === uid) sessions.delete(t);
    }
}

module.exports = {
    createSession, getSessionUser, destroySession, destroyAllUserSessions,
};