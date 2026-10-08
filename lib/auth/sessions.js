'use strict';
const crypto = require('crypto');

const sessions = new Map();  // token -> { uid, createdAt }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 天

function createSession(uid) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { uid, createdAt: Date.now() });
    return token;
}

function getSessionUser(token) {
    const entry = sessions.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
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