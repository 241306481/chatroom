'use strict';
const { discussMessagesDir } = require('./paths');
const chunks = require('./chunks');
const CHUNK_SIZE = chunks.CHUNK_SIZE;
function readAllChunks(dn, disc) {
    return chunks.readAllChunks(discussMessagesDir(dn, disc));
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
        } else if (!c.quarantined) {
            c.quarantined = true;
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
}
function appendMessage(dn, disc, msg) {
    chunks.append(discussMessagesDir(dn, disc), msg);
    return msg;
}
function findMessage(dn, disc, id) {
    return chunks.find(discussMessagesDir(dn, disc), id);
}
function updateMessage(dn, disc, id, patch) {
    return chunks.update(discussMessagesDir(dn, disc), id, patch);
}
function updateMessages(dn, disc, ids, patch) {
    const set = ids instanceof Set ? ids : new Set(ids || []);
    return chunks.updateWhere(
        discussMessagesDir(dn, disc),
        m => !!(m && set.has(m.id)),
        patch
    );
}
function toggleReaction(dn, disc, msgId, uid, emoji) {
    const info = readAllChunks(dn, disc);
    for (const c of info.chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x.id === msgId);
        if (!m) continue;
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
        const count = m.reactions[key] ? m.reactions[key].length : 0;
        return { added, count };
    }
    return null;
}
function loadMessageRange(dn, disc, offset, limit) {
    const live = loadAllMessages(dn, disc).filter(m => !m.deleted);
    const total = live.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    return {
        messages: live.slice(start, end),
        total,
        start,
        end,
    };
}
module.exports = {
    CHUNK_SIZE,
    listMessageChunks,
    closeAppendHandlesIn: chunks.closeAppendHandlesIn,
    closeAppendHandles: chunks.closeAppendHandles,
    invalidateChunkCache: chunks.invalidateChunkCache,
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, updateMessage, updateMessages, toggleReaction,
    loadMessageRange,
};
