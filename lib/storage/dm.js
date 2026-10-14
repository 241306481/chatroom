'use strict';
const fs = require('fs');
const path = require('path');
const {
    USER_DIR, SYSTEM_UID, userMsgDir, unreadCountPath,
    conversationsPath,
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
    // 用 Object.keys 而非 for...in：后者会把原型上的可枚举属性也计入
    for (const k of Object.keys(cnt)) sum += (cnt[k] || 0);
    return sum;
}

// ============================================================
// 会话索引（纯缓存，可随时由已有消息文件重建）
// ============================================================
function loadConvIndex(uid) {
    const obj = readJson(conversationsPath(uid));
    if (obj && typeof obj === 'object') return obj;
    return null;
}

function saveConvIndex(uid, idx) {
    writeJsonAtomic(conversationsPath(uid), idx);
}

function rebuildConvIndex(uid) {
    const idx = {};
    if (fs.existsSync(USER_DIR)) {
        for (const u1 of fs.readdirSync(USER_DIR)) {
            // 目录名直接进 userMsgDir；遇到非法名字（历史遗留/手工创建）要跳过，
            // 不能让 assertSafeName 的异常把整个会话索引重建打断
            let msgDir;
            try { msgDir = userMsgDir(u1); }
            catch (e) { continue; }
            if (!fs.existsSync(msgDir)) continue;
            for (const f of fs.readdirSync(msgDir)) {
                if (!f.endsWith('.json')) continue;
                const u2 = f.replace('.json', '');
                if (u1 !== uid && u2 !== uid) continue;
                const other = u1 === uid ? u2 : u1;
                const msgs = loadAllDM(uid, other);
                if (msgs === null || msgs.length === 0) continue;
                const last = msgs[msgs.length - 1];
                const unread = msgs.filter(m => m.to === uid && !m.read).length;
                idx[other] = { last_at: last.created_at || '', unread };
            }
        }
    }
    saveConvIndex(uid, idx);
    return idx;
}

function getConvIndex(uid) {
    let idx = loadConvIndex(uid);
    if (!idx) idx = rebuildConvIndex(uid);
    return idx;
}

function convTouch(uid, other, lastAt) {
    const idx = getConvIndex(uid);
    const cur = idx[other] || { last_at: '', unread: 0 };
    cur.last_at = lastAt || cur.last_at || '';
    idx[other] = cur;
    saveConvIndex(uid, idx);
}

function convBumpUnread(uid, other) {
    const idx = getConvIndex(uid);
    const cur = idx[other] || { last_at: '', unread: 0 };
    cur.unread = (cur.unread || 0) + 1;
    idx[other] = cur;
    saveConvIndex(uid, idx);
}

function convClearUnread(uid, other) {
    const idx = getConvIndex(uid);
    const cur = idx[other];
    if (!cur) return;
    if (!cur.unread) return;
    cur.unread = 0;
    idx[other] = cur;
    saveConvIndex(uid, idx);
}

// 从会话索引中移除某个会话（消息被清空后必须调用，
// 否则索引里的 last_at 会一直指向已被删除的最后一条消息）
function convRemove(uid, other) {
    const idx = getConvIndex(uid);
    if (!(other in idx)) return;
    delete idx[other];
    saveConvIndex(uid, idx);
}

// ============================================================
// 存储路径
// ============================================================
// 只读路径不应产生写副作用：这里曾调用 ensureDir，
// 导致「查看一次私信」就会凭空创建 data/users/<uid>/messages/ 目录
function dmPath(a, b) {
    const [u1, u2] = [a, b].sort();
    return path.join(userMsgDir(u1), u2 + '.json');
}

function dmDir(a) {
    const [u1] = [a].sort();
    return userMsgDir(u1);
}

// 读取。文件损坏时必须与 null 区分开，否则上层会用空数组
// 覆盖写回，把整段私信历史替换成 1 条消息。
function loadAllDM(a, b) {
    const v = readJson(dmPath(a, b));
    if (v === null) {
        return fs.existsSync(dmPath(a, b)) ? null : [];
    }
    return Array.isArray(v) ? v : null;
}

function saveAllDM(a, b, msgs) {
    ensureDir(dmDir(a));
    writeJsonAtomic(dmPath(a, b), msgs);
}
function loadDM(a, b, limit = 200) {
    const arr = loadAllDM(a, b);
    return arr ? arr.slice(-limit) : [];
}

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
    const isAdmin = hasPriv(fromUser, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        || hasPriv(fromUser, 'system', PRIV.SYSTEM.MANAGE_ALL);
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
    if (all === null) {
        // 历史文件损坏：绝不能当作空数组继续 push+覆盖写，
        // 那会把整段对话替换成这一条消息。拒绝写入并保留现场。
        throw new Error('私信记录已损坏，已阻止写入以免覆盖历史消息');
    }
    all.push(msg);
    saveAllDM(from, to, all);

    convTouch(from, to, msg.created_at);
    convTouch(to, from, msg.created_at);
    convBumpUnread(to, from);

    const cnt = loadUnreadCount(to);
    cnt[from] = (cnt[from] || 0) + 1;
    saveUnreadCount(to, cnt);
    return msg;
}

function markDMRead(uid, other) {
    const all = loadAllDM(uid, other);
    if (all !== null) {
        for (const m of all) if (m.to === uid) m.read = true;
        saveAllDM(uid, other, all);
    }

    const cnt = loadUnreadCount(uid);
    if (cnt[other]) {
        delete cnt[other];
        saveUnreadCount(uid, cnt);
    }
    convClearUnread(uid, other);
}

/**
 * 清空一对用户的全部私信。
 * 消息文件、未读计数、会话索引三处必须一起处理，
 * 任何一处遗漏都会留下无法自愈的脏状态：
 *  - 只清消息 → 会话索引里 last_at 指向已删除的消息
 *  - 只清一侧未读 → 另一侧仍显示未读红点
 */
function clearDM(a, b) {
    const msgs = loadAllDM(a, b);
    if (msgs === null) {
        throw new Error('私信记录已损坏，已阻止清空以免掩盖数据问题');
    }
    saveAllDM(a, b, []);
    for (const [uid, other] of [[a, b], [b, a]]) {
        const cnt = loadUnreadCount(uid);
        if (cnt[other]) {
            delete cnt[other];
            saveUnreadCount(uid, cnt);
        }
        convRemove(uid, other);
    }
}

function listConversations(uid) {
    const idx = getConvIndex(uid);
    const result = [];
    for (const other of Object.keys(idx)) {
        const entry = idx[other];
        if (!entry) continue;
        const msgs = loadAllDM(uid, other);
        if (msgs === null || msgs.length === 0) continue;
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter(m => m.to === uid && !m.read).length;
        result.push({ other, last, unread });
    }
    result.sort((a, b) => (b.last.created_at || '').localeCompare(a.last.created_at || ''));
    return result;
}

module.exports = {
    loadDM, loadAllDM, appendDM, saveAllDM, markDMRead, listConversations,
    rebuildConvIndex, getConvIndex, clearDM,
    getTotalUnread, loadUnreadCount, saveUnreadCount, canSendDM,
};