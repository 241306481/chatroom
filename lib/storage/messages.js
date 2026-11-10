'use strict';
const fs = require('fs');
const path = require('path');
const { discussMessagesDir } = require('./paths');
const { writeJsonAtomic } = require('./fs-utils');
const chunks = require('./chunks');
const CHUNK_SIZE = chunks.CHUNK_SIZE;
const STATS_FILE = '.stats.json';
const STATS_VERSION = 1;
const loggedCorrupt = new Set();
function readAllChunks(dn, disc) {
    return chunks.readAllChunks(discussMessagesDir(dn, disc));
}
function statsPath(dn, disc) {
    return path.join(discussMessagesDir(dn, disc), STATS_FILE);
}
function logCorrupt(info, c) {
    const key = info.dir + '/' + c.file;
    if (loggedCorrupt.has(key)) return;
    loggedCorrupt.add(key);
    try {
        require('../logger').error(
            'Corrupt message chunk (skipped):', c.file);
    } catch (e) {}
}
function pinnedView(m) {
    return {
        id: m.id, content: m.content, nickname: m.nickname || '?',
        user_id: m.user_id, is_system: !!m.is_system,
        created_at: m.created_at || '',
        reactions_json: JSON.stringify(m.reactions || {}),
    };
}
function buildStats(info) {
    let total = 0;
    const pinned = [];
    for (const c of info.chunks) {
        if (!Array.isArray(c.arr)) continue;
        for (const m of c.arr) {
            if (!m || m.deleted) continue;
            total++;
            if (m.pinned && !m.revoked) pinned.push(pinnedView(m));
        }
    }
    return { version: STATS_VERSION, total, pinned };
}
function readStats(dn, disc) {
    try {
        return JSON.parse(fs.readFileSync(statsPath(dn, disc), 'utf8'));
    } catch (e) {
        return null;
    }
}
function validStats(st) {
    return !!(st && st.version === STATS_VERSION
        && Number.isInteger(st.total) && st.total >= 0
        && Array.isArray(st.pinned));
}
function writeStats(dn, disc, stats) {
    try {
        writeJsonAtomic(statsPath(dn, disc), stats);
    } catch (e) {
        try { require('../logger').error('消息统计写入失败:', e.message); } catch (e2) {}
    }
}
function invalidateStats(dn, disc) {
    try { fs.rmSync(statsPath(dn, disc), { force: true }); } catch (e) {}
}
function getMessageStats(dn, disc) {
    const cached = readStats(dn, disc);
    if (validStats(cached)) return cached;
    const info = readAllChunks(dn, disc);
    for (const c of info.chunks) {
        if (!Array.isArray(c.arr)) logCorrupt(info, c);
    }
    const stats = buildStats(info);
    writeStats(dn, disc, stats);
    return stats;
}
function updateStatsAfterAppend(dn, disc, msg) {
    const st = readStats(dn, disc);
    if (!validStats(st)) {
        invalidateStats(dn, disc);
        return;
    }
    if (msg && !msg.deleted) {
        st.total++;
        if (msg.pinned && !msg.revoked) st.pinned.push(pinnedView(msg));
    }
    writeStats(dn, disc, st);
}
function patchAffectsStats(patch) {
    if (typeof patch === 'function') return true;
    if (!patch || typeof patch !== 'object') return false;
    return ['deleted', 'pinned', 'revoked', 'content', 'reactions']
        .some((k) => Object.prototype.hasOwnProperty.call(patch, k));
}
function listMessageChunks(dn, disc, newestFirst) {
    return chunks.listChunks(discussMessagesDir(dn, disc), newestFirst);
}
function loadAllMessages(dn, disc) {
    const info = readAllChunks(dn, disc);
    const all = [];
    for (const c of info.chunks) {
        if (Array.isArray(c.arr)) {
            all.push(...c.arr);
        } else {
            const key = info.dir + '/' + c.file;
            if (loggedCorrupt.has(key)) continue;
            loggedCorrupt.add(key);
            try {
                require('../logger').error(
                    'Corrupt message chunk (skipped):', disc + '/' + c.file);
            } catch (e) {}
        }
    }
    return all;
}
function saveAllMessages(dn, disc, msgs) {
    chunks.saveAll(discussMessagesDir(dn, disc), msgs);
    invalidateStats(dn, disc);
}
function appendMessage(dn, disc, msg) {
    chunks.append(discussMessagesDir(dn, disc), msg);
    updateStatsAfterAppend(dn, disc, msg);
    return msg;
}
function findMessage(dn, disc, id) {
    return chunks.find(discussMessagesDir(dn, disc), id);
}
function findMessagesByIds(dn, disc, ids) {
    const wanted = ids instanceof Set ? ids : new Set(ids || []);
    const found = new Map();
    if (!wanted.size) return found;
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) return found;
    const files = chunks.sortedChunkFiles(dir);
    outer:
    for (let i = files.length - 1; i >= 0; i--) {
        const arr = chunks.loadChunkCached(dir, files[i]);
        if (!Array.isArray(arr)) continue;
        for (let j = arr.length - 1; j >= 0; j--) {
            const m = arr[j];
            if (!m || !wanted.has(m.id) || found.has(m.id)) continue;
            found.set(m.id, m);
            if (found.size === wanted.size) break outer;
        }
    }
    return found;
}
function updateMessage(dn, disc, id, patch) {
    const r = chunks.update(discussMessagesDir(dn, disc), id, patch);
    if (r && patchAffectsStats(patch)) invalidateStats(dn, disc);
    return r;
}
function updateMessages(dn, disc, ids, patch) {
    const set = ids instanceof Set ? ids : new Set(ids || []);
    const changed = chunks.updateWhere(
        discussMessagesDir(dn, disc),
        m => !!(m && set.has(m.id)),
        patch
    );
    if (changed && patchAffectsStats(patch)) invalidateStats(dn, disc);
    return changed;
}
function toggleReaction(dn, disc, msgId, uid, emoji) {
    const info = readAllChunks(dn, disc);
    for (const c of info.chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x.id === msgId);
        if (!m) continue;
        if (c.corrupt) {
            throw new Error('消息分片 ' + c.file
                + ' 已损坏，已阻止写入以免丢失历史数据');
        }
        if (!m.reactions || typeof m.reactions !== 'object') m.reactions = {};
        const key = 'e:' + emoji;
        const list = Array.isArray(m.reactions[key]) ? m.reactions[key] : [];
        const pos = list.indexOf(uid);
        let added;
        if (pos >= 0) {
            list.splice(pos, 1);
            added = false;
            if (list.length === 0) delete m.reactions[key];
            else m.reactions[key] = list;
        } else {
            list.push(uid);
            m.reactions[key] = list;
            added = true;
        }
        chunks.writeChunk(info.dir, c.file, c.arr);
        if (m.pinned) invalidateStats(dn, disc);
        const count = m.reactions[key] ? m.reactions[key].length : 0;
        return { added, count };
    }
    return null;
}
function loadMessagePage(dn, disc, opts) {
    const options = opts || {};
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 50, 100));
    const beforeId = options.beforeId ? String(options.beforeId) : '';
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) {
        return { messages: [], has_more: false, next_before: '' };
    }
    const files = chunks.sortedChunkFiles(dir);
    const picked = [];
    let found = !beforeId;
    let hasMore = false;
    outer:
    for (let i = files.length - 1; i >= 0; i--) {
        const arr = chunks.loadChunkCached(dir, files[i]);
        if (!Array.isArray(arr)) continue;
        for (let j = arr.length - 1; j >= 0; j--) {
            const m = arr[j];
            if (!m) continue;
            if (!found) {
                if (m.id === beforeId) found = true;
                continue;
            }
            if (m.deleted) continue;
            picked.push(m);
            if (picked.length > limit) {
                hasMore = true;
                break outer;
            }
        }
    }
    if (!found) {
        return {
            messages: [], has_more: false, next_before: '',
            missing_before: true,
        };
    }
    if (hasMore) picked.length = limit;
    picked.reverse();
    return {
        messages: picked,
        has_more: hasMore,
        next_before: picked.length ? picked[0].id : '',
    };
}
function loadMessageRange(dn, disc, offset, limit) {
    const skip = Math.max(0, parseInt(offset, 10) || 0);
    const take = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) {
        return { messages: [], total: 0, start: 0, end: 0, has_more: false };
    }
    const files = chunks.sortedChunkFiles(dir);
    const picked = [];
    let skipped = 0;
    let hasMore = false;
    outer:
    for (let i = files.length - 1; i >= 0; i--) {
        const arr = chunks.loadChunkCached(dir, files[i]);
        if (!Array.isArray(arr)) continue;
        for (let j = arr.length - 1; j >= 0; j--) {
            const m = arr[j];
            if (!m || m.deleted) continue;
            if (skipped < skip) {
                skipped++;
                continue;
            }
            picked.push(m);
            if (picked.length > take) {
                hasMore = true;
                break outer;
            }
        }
    }
    if (hasMore) picked.length = take;
    picked.reverse();
    const total = getMessageStats(dn, disc).total;
    return {
        messages: picked,
        total,
        start: skip,
        end: skip + picked.length,
        has_more: hasMore,
    };
}
module.exports = {
    CHUNK_SIZE,
    listMessageChunks,
    closeAppendHandlesIn: chunks.closeAppendHandlesIn,
    closeAppendHandles: chunks.closeAppendHandles,
    invalidateChunkCache: chunks.invalidateChunkCache,
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, findMessagesByIds, updateMessage, updateMessages, toggleReaction,
    getMessageStats, loadMessagePage, loadMessageRange,
};
