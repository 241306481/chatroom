'use strict';
const fs = require('fs');
const path = require('path');
const {
    USER_DIR, SYSTEM_UID, userMsgDir, unreadCountPath,
} = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    genUuid, nowIso, sliceChars,
} = require('./fs-utils');
const { loadUser } = require('./users');
const { isBlocked, isFollowing } = require('./social');
const { PRIV, hasPriv } = require('../permissions');

// ============================================================
// 未读计数
// ============================================================
function loadUnreadCount(uid) { return readJson(unreadCountPath(uid)) || {}; }
function saveUnreadCount(uid, cnt) { writeJsonAtomic(unreadCountPath(uid), cnt); }
function getTotalUnread(uid) {
    const cnt = loadUnreadCount(uid);
    let sum = 0;
    for (const k in cnt) sum += (cnt[k] || 0);
    return sum;
}

// ============================================================
// 存储路径
// ============================================================
function dmPath(a, b) {
    const [u1, u2] = [a, b].sort();
    ensureDir(userMsgDir(u1));
    return path.join(userMsgDir(u1), u2 + '.json');
}

function loadAllDM(a, b) { return readJson(dmPath(a, b)) || []; }
function saveAllDM(a, b, msgs) { writeJsonAtomic(dmPath(a, b), msgs); }
function loadDM(a, b, limit = 200) { return loadAllDM(a, b).slice(-limit); }

// ============================================================
// 权限判断
// ============================================================
function canSendDM(fromUid, toUid) {
    if (!fromUid || !toUid) return { ok: false, error: '参数错误' };
    if (fromUid === toUid) return { ok: false, error: '不能给自己发私信' };
    if (fromUid === SYSTEM_UID) return { ok: true };
    if (toUid === SYSTEM_UID) return { ok: false, error: '系统账号不接收私信' };

    const fromUser = loadUser(fromUid);
    if (!fromUser.id) return { ok: false, error: '发送者不存在' };
    if (fromUser.is_system) return { ok: true };

    const toUser = loadUser(toUid);
    if (!toUser.id) return { ok: false, error: '对方不存在' };
    if (toUser.is_system) return { ok: false, error: '系统账号不接收私信' };
    if (isBlocked(toUid, fromUid)) return { ok: false, error: '你已被对方拉黑' };

    const policy = toUser.dm_policy || 'everyone';
    const fromPriv = fromUser.priv || 0;
    const isAdmin = hasPriv(fromPriv, PRIV.MANAGE_SYSTEM)
        || hasPriv(fromPriv, PRIV.MANAGE_ALL_DOMAIN);
    if (isAdmin) return { ok: true };

    if (policy === 'everyone') return { ok: true };
    if (policy === 'admin') return { ok: false, error: '对方只接受管理员的私信' };
    if (policy === 'mutual') {
        const iFollowThem = isFollowing(fromUid, toUid);
        const theyFollowMe = isFollowing(toUid, fromUid);
        if (iFollowThem && theyFollowMe) return { ok: true };
        return { ok: false, error: '对方只接受互相关注的人的私信' };
    }
    if (policy === 'following') {
        const theyFollowMe = isFollowing(toUid, fromUid);
        if (theyFollowMe) return { ok: true };
        return { ok: false, error: '对方只接受他关注的人的私信' };
    }
    return { ok: true };
}

// ============================================================
// 读写
// ============================================================
function appendDM(from, to, content, extra = {}) {
    const check = canSendDM(from, to);
    if (!check.ok) throw new Error(check.error);

    const msg = {
        id: genUuid(), from, to,
        content: sliceChars(content, 8000),
        read: false, created_at: nowIso(), ...extra,
    };
    const all = loadAllDM(from, to);
    all.push(msg);
    saveAllDM(from, to, all);

    const cnt = loadUnreadCount(to);
    cnt[from] = (cnt[from] || 0) + 1;
    saveUnreadCount(to, cnt);
    return msg;
}

function markDMRead(uid, other) {
    const all = loadAllDM(uid, other);
    for (const m of all) if (m.to === uid) m.read = true;
    saveAllDM(uid, other, all);

    const cnt = loadUnreadCount(uid);
    if (cnt[other]) {
        delete cnt[other];
        saveUnreadCount(uid, cnt);
    }
}

function listConversations(uid) {
    const result = [];
    if (!fs.existsSync(USER_DIR)) return result;
    const seen = new Set();

    for (const u1 of fs.readdirSync(USER_DIR)) {
        const msgDir = userMsgDir(u1);
        if (!fs.existsSync(msgDir)) continue;
        for (const f of fs.readdirSync(msgDir)) {
            if (!f.endsWith('.json')) continue;
            const u2 = f.replace('.json', '');
            if (u1 !== uid && u2 !== uid) continue;

            const other = u1 === uid ? u2 : u1;
            if (seen.has(other)) continue;

            const msgs = loadAllDM(uid, other);
            if (msgs.length === 0) continue;
            seen.add(other);

            const last = msgs[msgs.length - 1];
            const unread = msgs.filter(m => m.to === uid && !m.read).length;
            result.push({ other, last, unread });
        }
    }
    result.sort((a, b) => (b.last.created_at || '').localeCompare(a.last.created_at || ''));
    return result;
}

module.exports = {
    loadDM, loadAllDM, appendDM, saveAllDM, markDMRead, listConversations,
    getTotalUnread, loadUnreadCount, saveUnreadCount, canSendDM,
};