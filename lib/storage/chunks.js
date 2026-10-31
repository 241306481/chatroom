'use strict';
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./fs-utils');
const CHUNK_SIZE = 500;
const CHUNK_RE = /^chunk-(\d{5,})\.jsonl$/;
const CHUNK_CACHE_MAX = 400;
const chunkCache = new Map();
const chunkCounts = new Map();
const appendHandles = new Map();
function chunkName(n) {
    return 'chunk-' + String(n).padStart(5, '0') + '.jsonl';
}
function isChunkFile(f) { return CHUNK_RE.test(f); }
function chunkPath(dir, f) { return path.join(dir, f); }
function parseChunkFile(fp) {
    let raw;
    try { raw = fs.readFileSync(fp, 'utf8'); }
    catch (e) { return { state: 'missing', arr: null, corrupt: false }; }
    const arr = [];
    let corrupt = false;
    for (const line of raw.split('\n')) {
        if (!line) continue;
        try { arr.push(JSON.parse(line)); }
        catch (e) { corrupt = true; }
    }
    return { state: 'ok', arr, corrupt };
}
function loadChunk(dir, f) {
    const r = parseChunkFile(chunkPath(dir, f));
    return r.state === 'ok' ? r.arr : null;
}
function loadChunkCached(dir, f) {
    const p = chunkPath(dir, f);
    let st;
    try { st = fs.statSync(p); } catch (e) { return null; }
    const hit = chunkCache.get(p);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        chunkCache.delete(p);
        chunkCache.set(p, hit);
        return hit.arr;
    }
    const r = parseChunkFile(p);
    if (r.state !== 'ok') {
        chunkCache.delete(p);
        chunkCounts.delete(p);
        return null;
    }
    chunkCache.set(p, { mtimeMs: st.mtimeMs, size: st.size, arr: r.arr });
    if (r.corrupt) chunkCounts.set(p, -1);
    else chunkCounts.set(p, r.arr.length);
    while (chunkCache.size > CHUNK_CACHE_MAX) {
        const oldest = chunkCache.keys().next().value;
        if (oldest === undefined) break;
        chunkCache.delete(oldest);
    }
    return r.arr;
}
function invalidateChunkCache(p) {
    if (p) { chunkCache.delete(p); return; }
    chunkCache.clear();
}
function chunkCount(dir, f) {
    const p = chunkPath(dir, f);
    const n = chunkCounts.get(p);
    if (n !== undefined) return n;
    const r = parseChunkFile(p);
    if (r.state !== 'ok' || r.corrupt) {
        chunkCounts.set(p, -1);
        return -1;
    }
    chunkCounts.set(p, r.arr.length);
    return r.arr.length;
}
function setChunkCount(dir, f, n) { chunkCounts.set(chunkPath(dir, f), n); }
function bumpChunkCount(dir, f, delta) {
    const p = chunkPath(dir, f);
    const n = chunkCounts.get(p);
    if (n !== undefined && n >= 0) chunkCounts.set(p, Math.max(0, n + delta));
}
function writeChunk(dir, f, arr) {
    ensureDir(dir);
    const fp = chunkPath(dir, f);
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
function readAllChunks(dir) {
    if (!fs.existsSync(dir)) return { dir, chunks: [], corrupt: false };
    const files = sortedChunkFiles(dir);
    const out = [];
    let corrupt = false;
    for (const f of files) {
        const r = parseChunkFile(chunkPath(dir, f));
        if (r.state !== 'ok') {
            corrupt = true;
            out.push({ file: f, arr: null, corrupt: true });
            continue;
        }
        if (r.corrupt) corrupt = true;
        out.push({ file: f, arr: r.arr, corrupt: r.corrupt });
    }
    return { dir, chunks: out, corrupt };
}
function listChunks(dir, newestFirst) {
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
function loadAll(dir) {
    const { chunks } = readAllChunks(dir);
    const all = [];
    for (const c of chunks) {
        if (Array.isArray(c.arr)) all.push(...c.arr);
    }
    return all;
}
function assertAppendable(dir) {
    const last = latestChunkFile(dir);
    if (!last) return;
    if (chunkCount(dir, last) < 0) {
        throw new Error('消息分片 ' + last + ' 已损坏，已阻止写入以免覆盖历史消息');
    }
}
function appendLine(dir, f, obj) {
    ensureDir(dir);
    const fp = chunkPath(dir, f);
    let h = appendHandles.get(fp);
    let offset = 0;
    if (h === undefined) {
        try {
            offset = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
            h = fs.openSync(fp, 'a');
        } catch (e) {
            offset = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
            fs.appendFileSync(fp, JSON.stringify(obj) + '\n', 'utf8');
            bumpChunkCount(dir, f, 1);
            invalidateChunkCache(fp);
            return { file: f, offset };
        }
        appendHandles.set(fp, h);
    } else {
        try { offset = fs.fstatSync(h).size; } catch (e) { offset = 0; }
    }
    fs.writeSync(h, JSON.stringify(obj) + '\n');
    bumpChunkCount(dir, f, 1);
    invalidateChunkCache(fp);
    return { file: f, offset };
}
function append(dir, obj) {
    ensureDir(dir);
    const last = latestChunkFile(dir);
    let nextNum = 1;
    if (last) {
        const num = parseInt(CHUNK_RE.exec(last)[1], 10);
        nextNum = num + 1;
        const cnt = chunkCount(dir, last);
        if (cnt < 0) {
            const quarantine = last + '.corrupt';
            try {
                fs.copyFileSync(chunkPath(dir, last), chunkPath(dir, quarantine));
                fs.renameSync(chunkPath(dir, last), chunkPath(dir, last + '.broken'));
            } catch (e) {
                throw new Error('消息分片 ' + last + ' 已损坏且无法隔离，'
                    + '已阻止写入以免覆盖历史消息（备份：' + quarantine + '）');
            }
            chunkCounts.delete(chunkPath(dir, last));
            return appendLine(dir, chunkName(nextNum), obj);
        }
        if (cnt < CHUNK_SIZE) return appendLine(dir, last, obj);
    }
    return appendLine(dir, chunkName(nextNum), obj);
}
function rollbackAppend(dir, file, offset) {
    const fp = chunkPath(dir, file);
    const h = appendHandles.get(fp);
    try {
        if (h !== undefined) fs.ftruncateSync(h, offset);
        else {
            const fd = fs.openSync(fp, 'r+');
            try { fs.ftruncateSync(fd, offset); } finally { fs.closeSync(fd); }
        }
    } catch (e) {}
    chunkCounts.delete(fp);
    invalidateChunkCache(fp);
}
function saveAll(dir, arr) {
    closeAppendHandlesIn(dir);
    let backup = null;
    if (fs.existsSync(dir)) {
        backup = dir + '.bak-' + Date.now();
        try { fs.renameSync(dir, backup); }
        catch (e) { backup = null; fs.rmSync(dir, { recursive: true, force: true }); }
    }
    try {
        ensureDir(dir);
        const count = Math.max(1, Math.ceil(arr.length / CHUNK_SIZE));
        for (let i = 0; i < count; i++) {
            writeChunk(dir, chunkName(i + 1), arr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
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
function writeChunksAtomic(dir, updates) {
    if (!Array.isArray(updates) || !updates.length) return;
    closeAppendHandlesIn(dir);
    ensureDir(dir);
    const stamp = process.pid + '-' + Date.now() + '-' +
        Math.random().toString(36).slice(2);
    const prepared = [];
    try {
        for (let i = 0; i < updates.length; i++) {
            const u = updates[i];
            const fp = chunkPath(dir, u.file);
            const tmp = fp + '.tmp-' + stamp + '-' + i;
            const body = u.arr.map(m => JSON.stringify(m)).join('\n')
                + (u.arr.length ? '\n' : '');
            fs.writeFileSync(tmp, body, 'utf8');
            prepared.push({ fp, tmp, file: u.file, arr: u.arr, old: null });
        }
    } catch (e) {
        for (const p of prepared) {
            try { fs.rmSync(p.tmp, { force: true }); } catch (e2) {}
        }
        throw e;
    }
    const done = [];
    try {
        for (const p of prepared) {
            p.old = fs.existsSync(p.fp) ? fs.readFileSync(p.fp) : null;
            fs.renameSync(p.tmp, p.fp);
            done.push(p);
        }
    } catch (e) {
        for (const p of done) {
            try {
                if (p.old === null) fs.rmSync(p.fp, { force: true });
                else fs.writeFileSync(p.fp, p.old, 'utf8');
            } catch (e2) {}
            try { fs.rmSync(p.tmp, { force: true }); } catch (e2) {}
        }
        for (const p of prepared) {
            try { fs.rmSync(p.tmp, { force: true }); } catch (e2) {}
        }
        throw e;
    }
    for (const p of prepared) {
        setChunkCount(dir, p.file, p.arr.length);
        invalidateChunkCache(p.fp);
    }
}
function updateWhere(dir, predicate, patch) {
    const { chunks } = readAllChunks(dir);
    let changed = 0;
    const updates = [];
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        let local = 0;
        for (const item of c.arr) {
            if (!predicate(item)) continue;
            Object.assign(item, typeof patch === 'function' ? patch(item) : patch);
            local++;
        }
        if (!local) continue;
        changed += local;
        updates.push({ file: c.file, arr: c.arr });
    }
    if (updates.length) writeChunksAtomic(dir, updates);
    return changed;
}
function find(dir, id) {
    const { chunks } = readAllChunks(dir);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x && x.id === id);
        if (m) return m;
    }
    return null;
}
function update(dir, id, patch) {
    const { chunks } = readAllChunks(dir);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const idx = c.arr.findIndex(x => x && x.id === id);
        if (idx < 0) continue;
        Object.assign(c.arr[idx], typeof patch === 'function' ? patch(c.arr[idx]) : patch);
        writeChunk(dir, c.file, c.arr);
        return c.arr[idx];
    }
    return null;
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
module.exports = {
    CHUNK_SIZE, CHUNK_RE,
    chunkName, isChunkFile, chunkPath,
    loadChunk, loadChunkCached, invalidateChunkCache,
    chunkCount, setChunkCount, bumpChunkCount, writeChunk,
    sortedChunkFiles, latestChunkFile,
    readAllChunks, listChunks, loadAll,
    assertAppendable, append, appendLine, rollbackAppend,
    saveAll, writeChunksAtomic, updateWhere, find, update,
    closeAppendHandles, closeAppendHandlesIn,
};
