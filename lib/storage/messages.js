'use strict';
const fs = require('fs');
const path = require('path');
const {
    discussMessagesDir,
} = require('./paths');
const { ensureDir } = require('./fs-utils');
const CHUNK_SIZE = 500;
const CHUNK_RE = /^chunk-(\d{5,})\.jsonl$/;
const chunkName = n => 'chunk-' + String(n).padStart(5, '0') + '.jsonl';
const CHUNK_CACHE_MAX = 400;
const chunkCache = new Map();
function loadChunkCached(dir, f) {
    const p = path.join(dir, f);
    let st;
    try { st = fs.statSync(p); } catch (e) { return null; }
    const hit = chunkCache.get(p);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        chunkCache.delete(p);
        chunkCache.set(p, hit);
        return hit.arr;
    }
    const arr = loadChunk(dir, f);
    if (arr) {
        chunkCache.set(p, { mtimeMs: st.mtimeMs, size: st.size, arr });
        while (chunkCache.size > CHUNK_CACHE_MAX) {
            const oldest = chunkCache.keys().next().value;
            if (oldest === undefined) break;
            chunkCache.delete(oldest);
        }
    }
    return arr;
}
function invalidateChunkCache(p) {
    if (p) { chunkCache.delete(p); return; }
    chunkCache.clear();
}
const chunkCounts = new Map();
function chunkCount(dir, f) {
    const p = path.join(dir, f);
    let n = chunkCounts.get(p);
    if (n !== undefined) return n;
    const arr = loadChunk(dir, f);
    n = arr === null ? -1 : arr.length;
    chunkCounts.set(p, n);
    return n;
}
function setChunkCount(dir, f, n) {
    chunkCounts.set(path.join(dir, f), n);
}
function loadChunk(dir, f) {
    const p = path.join(dir, f);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line) continue;
        try { out.push(JSON.parse(line)); } catch (e) {}
    }
    return out;
}
function sortedChunkFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => CHUNK_RE.test(f))
        .sort((a, b) => {
            const na = parseInt(CHUNK_RE.exec(a)[1], 10);
            const nb = parseInt(CHUNK_RE.exec(b)[1], 10);
            return na - nb;
        });
}
function latestChunkFile(dir) {
    const files = sortedChunkFiles(dir);
    return files.length ? files[files.length - 1] : null;
}
function writeChunk(dir, f, arr) {
    const fp = path.join(dir, f);
    const body = arr.map(m => JSON.stringify(m)).join('\n') + (arr.length ? '\n' : '');
    const h = appendHandles.get(fp);
    try {
        if (h !== undefined) {
            fs.ftruncateSync(h, 0);
            fs.writeSync(h, body, 0, 'utf8');
        } else {
            fs.writeFileSync(fp, body, 'utf8');
        }
    } catch (e) {
        try { fs.writeFileSync(fp, body, 'utf8'); } catch (e2) { throw e2; }
    }
    setChunkCount(dir, f, arr.length);
    invalidateChunkCache(fp);
}
function readAllChunks(dn, disc) {
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) return { dir, chunks: [] };
    const files = sortedChunkFiles(dir);
    const chunks = [];
    for (const f of files) {
        chunks.push({ file: f, arr: loadChunkCached(dir, f) });
    }
    return { dir, chunks };
}
function listMessageChunks(dn, disc, newestFirst) {
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) return [];
    const files = sortedChunkFiles(dir);
    if (newestFirst) files.reverse();
    const out = [];
    for (const f of files) {
        const arr = loadChunkCached(dir, f);
        if (!arr) continue;
        out.push({ file: f, arr });
    }
    return out;
}
function loadAllMessages(dn, disc) {
    const { chunks } = readAllChunks(dn, disc);
    const all = [];
    for (const c of chunks) {
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
    const dir = discussMessagesDir(dn, disc);
    let backup = null;
    if (fs.existsSync(dir)) {
        backup = dir + '.bak-' + Date.now();
        try { fs.renameSync(dir, backup); }
        catch (e) { backup = null; fs.rmSync(dir, { recursive: true, force: true }); }
    }
    try {
        ensureDir(dir);
        const chunks = Math.max(1, Math.ceil(msgs.length / CHUNK_SIZE));
        for (let i = 0; i < chunks; i++) {
            const slice = msgs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            writeChunk(dir, chunkName(i + 1), slice);
        }
        if (backup) fs.rmSync(backup, { recursive: true, force: true });
    } catch (e) {
        if (backup && fs.existsSync(backup)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
            try { fs.renameSync(backup, dir); } catch (e2) {}
        }
        throw e;
    }
}
function appendMessage(dn, disc, msg) {
    const dir = discussMessagesDir(dn, disc);
    ensureDir(dir);
    const lastFile = latestChunkFile(dir);
    let nextNum = 1;
    if (lastFile) {
        const num = parseInt(CHUNK_RE.exec(lastFile)[1], 10);
        nextNum = num + 1;
        const cnt = chunkCount(dir, lastFile);
        if (cnt < 0) {
            const quarantine = lastFile + '.corrupt';
            try {
                fs.copyFileSync(path.join(dir, lastFile), quarantine);
                fs.renameSync(path.join(dir, lastFile), lastFile + '.broken');
            } catch (e) {
                throw new Error('消息分片 ' + lastFile + ' 已损坏且无法隔离，'
                    + '已阻止写入以免覆盖历史消息（备份：' + quarantine + '）');
            }
            appendLine(dir, chunkName(nextNum), msg);
            return msg;
        }
        if (cnt < CHUNK_SIZE) {
            appendLine(dir, lastFile, msg);
            return msg;
        }
    }
    appendLine(dir, chunkName(nextNum), msg);
    return msg;
}
const appendHandles = new Map();
function appendLine(dir, file, msg) {
    const fp = path.join(dir, file);
    let h = appendHandles.get(fp);
    if (h === undefined) {
        try {
            h = fs.openSync(fp, 'a');
        } catch (e) {
            fs.appendFileSync(fp, JSON.stringify(msg) + '\n', 'utf8');
            invalidateChunkCache(fp);
            return;
        }
        appendHandles.set(fp, h);
    }
    fs.writeSync(h, JSON.stringify(msg) + '\n');
    invalidateChunkCache(fp);
}
function closeAppendHandles() {
    for (const h of appendHandles.values()) {
        try { fs.closeSync(h); } catch (e) {}
    }
    appendHandles.clear();
}
function closeAppendHandlesIn(dir) {
    const prefix = path.resolve(dir) + path.sep;
    for (const [fp, h] of appendHandles) {
        if (!path.resolve(fp).startsWith(prefix)) continue;
        try { fs.closeSync(h); } catch (e) {}
        appendHandles.delete(fp);
    }
}
function findMessage(dn, disc, id) {
    const { chunks } = readAllChunks(dn, disc);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x.id === id);
        if (m) return m;
    }
    return null;
}
function updateMessage(dn, disc, id, patch) {
    const { dir, chunks } = readAllChunks(dn, disc);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const idx = c.arr.findIndex(x => x.id === id);
        if (idx >= 0) {
            Object.assign(c.arr[idx], patch);
            writeChunk(dir, c.file, c.arr);
            return;
        }
    }
}
function toggleReaction(dn, disc, msgId, uid, emoji) {
    const { dir, chunks } = readAllChunks(dn, disc);
    for (const c of chunks) {
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
        writeChunk(dir, c.file, c.arr);
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
    listMessageChunks,
    closeAppendHandlesIn,
    closeAppendHandles,
    invalidateChunkCache,
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, updateMessage, toggleReaction,
    loadMessageRange,
};
