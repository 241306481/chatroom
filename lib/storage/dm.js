'use strict';
const fs = require('fs');
const {
    SYSTEM_UID, userMsgDir, unreadCountPath,
    conversationsPath, dmPeerDir, dmMessagesDir,
    dmFilesDir, dmFilesIndexPath,
} = require('./paths');
const {
    readJson, writeJsonAtomic, genUuid, nowIso, sliceChars,
} = require('./fs-utils');
const chunks = require('./chunks');
const dmAttachments = require('./dm-attachments');
const { loadUser } = require('./users');
const { isBlocked, isFollowing } = require('./social');
const { PRIV, hasPriv } = require('../permissions');
function loadUnreadCount(uid) {
    const v = readJson(unreadCountPath(uid));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
}
function saveUnreadCount(uid, cnt) {
    writeJsonAtomic(unreadCountPath(uid), cnt);
}
function getTotalUnread(uid) {
    const cnt = loadUnreadCount(uid);
    let sum = 0;
    for (const k of Object.keys(cnt)) sum += (cnt[k] || 0);
    return sum;
}
function loadConvIndex(uid) {
    const obj = readJson(conversationsPath(uid));
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    return null;
}
function saveConvIndex(uid, idx) {
    writeJsonAtomic(conversationsPath(uid), idx);
}
function liveMessages(uid, other) {
    const all = loadAllDM(uid, other);
    if (all === null) return null;
    return all.filter(m => !m.deleted);
}
function rebuildConvIndex(uid) {
    const idx = {};
    if (fs.existsSync(userMsgDir(uid))) {
        for (const other of fs.readdirSync(userMsgDir(uid))) {
            let dir;
            try {
                const p = dmPeerDir(uid, other);
                if (!fs.statSync(p).isDirectory()) continue;
                dir = dmMessagesDir(uid, other);
            } catch (e) { continue; }
            if (!fs.existsSync(dir)) continue;
            const live = liveMessages(uid, other);
            if (!live || live.length === 0) continue;
            const last = live[live.length - 1];
            idx[other] = {
                last_at: last.created_at || '',
                unread: live.filter(m => m.to === uid && !m.read).length,
            };
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
    if (!cur || !cur.unread) return;
    cur.unread = 0;
    idx[other] = cur;
    saveConvIndex(uid, idx);
}
function convRemove(uid, other) {
    const idx = getConvIndex(uid);
    if (!(other in idx)) return;
    delete idx[other];
    saveConvIndex(uid, idx);
}
function syncConversation(uid, other) {
    const live = liveMessages(uid, other);
    if (live === null) return;
    const cnt = loadUnreadCount(uid);
    const unread = live.filter(m => m.to === uid && !m.read).length;
    if (unread) cnt[other] = unread;
    else delete cnt[other];
    saveUnreadCount(uid, cnt);
    if (!live.length) {
        convRemove(uid, other);
        return;
    }
    const idx = getConvIndex(uid);
    idx[other] = {
        last_at: live[live.length - 1].created_at || '',
        unread,
    };
    saveConvIndex(uid, idx);
}
function loadAllDM(a, b) {
    const dir = dmMessagesDir(a, b);
    if (!fs.existsSync(dir)) return [];
    const info = chunks.readAllChunks(dir);
    if (info.corrupt) return null;
    const all = [];
    for (const c of info.chunks) {
        if (Array.isArray(c.arr)) all.push(...c.arr);
    }
    return all;
}
function saveAllDM(a, b, msgs) {
    chunks.saveAll(dmMessagesDir(a, b), msgs);
    chunks.saveAll(dmMessagesDir(b, a), msgs);
}
function loadDM(a, b, limit = 200) {
    const arr = loadAllDM(a, b);
    if (!arr) return [];
    return arr.filter(m => !m.deleted).slice(-limit);
}
function findDMMessage(uid, other, id) {
    const dir = dmMessagesDir(uid, other);
    if (!fs.existsSync(dir)) return null;
    return chunks.find(dir, id);
}
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
function appendDM(from, to, content, extra = {}) {
    const check = canSendDM(from, to);
    if (!check.ok) throw new Error(check.error);
    const payload = Object.assign({}, extra);
    const explicitIds = Array.isArray(payload.attachment_ids)
        ? payload.attachment_ids.slice() : [];
    delete payload.attachment_ids;
    const msg = {
        id: genUuid(), from, to,
        content: sliceChars(content, 8000),
        read: false, created_at: nowIso(), ...payload,
    };
    const fromDir = dmMessagesDir(from, to);
    const toDir = dmMessagesDir(to, from);
    chunks.assertAppendable(fromDir);
    chunks.assertAppendable(toDir);
    const first = chunks.append(fromDir, msg);
    try {
        chunks.append(toDir, msg);
    } catch (e) {
        chunks.rollbackAppend(fromDir, first.file, first.offset);
        throw e;
    }
    const ids = new Set(dmAttachments.extractDMIds(msg.content, from, to));
    for (const id of explicitIds) {
        if (typeof id === 'string' && id) ids.add(id);
    }
    try {
        for (const id of ids) {
            dmAttachments.addDMRef(from, to, id, from, 1);
            dmAttachments.addDMRef(from, to, id, to, 1);
        }
    } catch (e) {
        try { require('../logger').error('DM attachment ref update failed:', e); } catch (e2) {}
    }
    convTouch(from, to, msg.created_at);
    convTouch(to, from, msg.created_at);
    convBumpUnread(to, from);
    const cnt = loadUnreadCount(to);
    cnt[from] = (cnt[from] || 0) + 1;
    saveUnreadCount(to, cnt);
    return msg;
}
function markDMRead(uid, other) {
    const dir = dmMessagesDir(uid, other);
    if (fs.existsSync(dir)) {
        chunks.updateWhere(dir, m => m.to === uid && !m.read, { read: true });
    }
    const cnt = loadUnreadCount(uid);
    if (cnt[other]) {
        delete cnt[other];
        saveUnreadCount(uid, cnt);
    }
    convClearUnread(uid, other);
}
function deleteDMMessage(uid, other, id) {
    const dir = dmMessagesDir(uid, other);
    if (!fs.existsSync(dir)) return false;
    const msg = chunks.find(dir, id);
    if (!msg || msg.deleted) return false;
    chunks.update(dir, id, { deleted: true, deleted_at: nowIso() });
    const ids = dmAttachments.extractDMIds(msg.content, uid, other);
    for (const fileId of ids) dmAttachments.releaseDMRef(uid, other, fileId, uid);
    syncConversation(uid, other);
    return true;
}
function deleteDMConversation(uid, other) {
    const all = loadAllDM(uid, other);
    if (all === null) {
        throw new Error('私信记录已损坏，已阻止删除以免掩盖数据问题');
    }
    for (const msg of all) {
        if (msg.deleted) continue;
        const ids = dmAttachments.extractDMIds(msg.content, uid, other);
        for (const fileId of ids) dmAttachments.releaseDMRef(uid, other, fileId, uid);
    }
    const dir = dmMessagesDir(uid, other);
    chunks.closeAppendHandlesIn(dir);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    try {
        const peerDir = dmPeerDir(uid, other);
        if (fs.existsSync(peerDir) && fs.readdirSync(peerDir).length === 0) {
            fs.rmdirSync(peerDir);
        }
    } catch (e) {}
    const cnt = loadUnreadCount(uid);
    if (cnt[other]) {
        delete cnt[other];
        saveUnreadCount(uid, cnt);
    }
    convRemove(uid, other);
    return all.length;
}
function clearDM(a, b) {
    for (const [uid, other] of [[a, b], [b, a]]) {
        const dir = dmMessagesDir(uid, other);
        chunks.closeAppendHandlesIn(dir);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        try {
            const peerDir = dmPeerDir(uid, other);
            if (fs.existsSync(peerDir) && fs.readdirSync(peerDir).length === 0) {
                fs.rmdirSync(peerDir);
            }
        } catch (e) {}
        const cnt = loadUnreadCount(uid);
        if (cnt[other]) {
            delete cnt[other];
            saveUnreadCount(uid, cnt);
        }
        convRemove(uid, other);
    }
    const filesDir = dmFilesDir(a, b);
    const indexPath = dmFilesIndexPath(a, b);
    if (fs.existsSync(filesDir)) fs.rmSync(filesDir, { recursive: true, force: true });
    if (fs.existsSync(indexPath)) fs.rmSync(indexPath, { force: true });
}
function listConversations(uid) {
    const idx = getConvIndex(uid);
    const result = [];
    for (const other of Object.keys(idx)) {
        const entry = idx[other];
        if (!entry) continue;
        const live = liveMessages(uid, other);
        if (!live || live.length === 0) continue;
        const last = live[live.length - 1];
        const unread = live.filter(m => m.to === uid && !m.read).length;
        result.push({ other, last, unread });
    }
    result.sort((a, b) => (b.last.created_at || '').localeCompare(a.last.created_at || ''));
    return result;
}
module.exports = {
    loadDM, loadAllDM, appendDM, saveAllDM, markDMRead, listConversations,
    rebuildConvIndex, getConvIndex, clearDM,
    deleteDMMessage, deleteDMConversation, findDMMessage,
    getTotalUnread, loadUnreadCount, saveUnreadCount, canSendDM,
};
