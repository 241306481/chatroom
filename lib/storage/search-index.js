'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const chunks = require('./chunks');
const { ensureDir, writeJsonAtomic } = require('./fs-utils');

const INDEX_VERSION = 1;
const MAX_GRAM = 3;
const MAX_GRAMS_PER_DOC = 6000;
const LOG_COMPACT_LINES = 2000;
const LOG_COMPACT_BYTES = 4 * 1024 * 1024;
const cache = new Map();

function docKey(id) { return '#' + String(id); }
function termKey(gram) { return '#' + gram; }

function emptyIndex() {
    return { version: INDEX_VERSION, docs: {}, terms: {}, long: [] };
}

function gramsOf(text) {
    const s = String(text == null ? '' : text).toLowerCase();
    const grams = new Set();
    let truncated = false;
    outer:
    for (let n = 1; n <= MAX_GRAM; n++) {
        for (let i = 0; i + n <= s.length; i++) {
            const g = s.slice(i, i + n);
            if (!g.trim()) continue;
            grams.add(g);
            if (grams.size >= MAX_GRAMS_PER_DOC) {
                truncated = true;
                break outer;
            }
        }
    }
    return { grams, truncated };
}

function removeDoc(idx, id) {
    const key = docKey(id);
    const old = idx.docs[key];
    if (!old) return;
    const { grams } = gramsOf(old.c);
    for (const g of grams) {
        const tk = termKey(g);
        const arr = idx.terms[tk];
        if (!arr) continue;
        const pos = arr.indexOf(old.id);
        if (pos < 0) continue;
        if (arr.length === 1) delete idx.terms[tk];
        else arr.splice(pos, 1);
    }
    if (old.x) idx.long = idx.long.filter(x => x !== old.id);
    delete idx.docs[key];
}

function upsert(idx, msg) {
    if (!msg || !msg.id || msg.deleted || msg.revoked || !msg.content) return;
    const id = String(msg.id);
    removeDoc(idx, id);
    const doc = {
        id,
        u: String(msg.user_id || ''),
        n: String(msg.nickname || '?'),
        t: String(msg.created_at || ''),
        c: String(msg.content),
    };
    const parsed = gramsOf(doc.c);
    if (parsed.truncated) {
        doc.x = 1;
        idx.long.push(id);
    }
    idx.docs[docKey(id)] = doc;
    for (const g of parsed.grams) {
        const tk = termKey(g);
        if (!idx.terms[tk]) idx.terms[tk] = [];
        idx.terms[tk].push(id);
    }
}

function applyEntry(idx, entry) {
    if (!entry || typeof entry !== 'object') return;
    if (entry.o === 'a' && entry.d) {
        const d = entry.d;
        upsert(idx, {
            id: d.id,
            user_id: d.u,
            nickname: d.n,
            created_at: d.t,
            content: d.c,
        });
    } else if (entry.o === 'd' && entry.id) {
        removeDoc(idx, entry.id);
    }
}

function buildFromChunks(dn, disc) {
    const idx = emptyIndex();
    const dir = paths.discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) return idx;
    for (const file of chunks.sortedChunkFiles(dir)) {
        const arr = chunks.loadChunkCached(dir, file);
        if (!Array.isArray(arr)) continue;
        for (const msg of arr) upsert(idx, msg);
    }
    return idx;
}

function statSig(p) {
    try {
        const st = fs.statSync(p);
        return st.mtimeMs + ':' + st.size;
    } catch (e) {
        return '';
    }
}

function readBase(dn, disc) {
    try {
        const obj = JSON.parse(fs.readFileSync(paths.searchIndexPath(dn, disc), 'utf8'));
        if (!obj || obj.version !== INDEX_VERSION
            || !obj.docs || typeof obj.docs !== 'object'
            || !obj.terms || typeof obj.terms !== 'object') return null;
        if (!Array.isArray(obj.long)) obj.long = [];
        return obj;
    } catch (e) {
        return null;
    }
}

function readLog(dn, disc) {
    const p = paths.searchLogPath(dn, disc);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch (e) {
        return { entries: [], size: 0 };
    }
    const entries = [];
    let bad = false;
    for (const line of raw.split('\n')) {
        if (!line) continue;
        try { entries.push(JSON.parse(line)); } catch (e) { bad = true; }
    }
    return { entries, size: Buffer.byteLength(raw), bad };
}

function writeLog(dn, disc, entry) {
    const p = paths.searchLogPath(dn, disc);
    ensureDir(path.dirname(p));
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
}

function compact(dn, disc, idx, logSize) {
    const lock = paths.searchLockPath(dn, disc);
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) { return; }
    try {
        writeJsonAtomic(paths.searchIndexPath(dn, disc), idx);
        const lp = paths.searchLogPath(dn, disc);
        try {
            if (fs.statSync(lp).size === logSize) fs.writeFileSync(lp, '', 'utf8');
        } catch (e) {}
    } catch (e) {
        try {
            require('../logger').error('Search index compaction failed:', e);
        } catch (e2) {}
    } finally {
        try { fs.closeSync(fd); } catch (e) {}
        try { fs.rmSync(lock, { force: true }); } catch (e) {}
    }
}

function load(dn, disc) {
    const key = dn + '\0' + disc;
    const basePath = paths.searchIndexPath(dn, disc);
    const logPath = paths.searchLogPath(dn, disc);
    const baseSig = statSig(basePath);
    const logSig = statSig(logPath);
    const hit = cache.get(key);
    if (hit && hit.baseSig === baseSig && hit.logSig === logSig) return hit.idx;
    let idx = readBase(dn, disc);
    let needRebuild = !idx;
    let sawRebuild = false;
    let logSize = 0;
    let logBytes = 0;
    let logLines = 0;
    if (needRebuild) {
        idx = buildFromChunks(dn, disc);
    } else {
        const log = readLog(dn, disc);
        logSize = log.size;
        logBytes = log.size;
        logLines = log.entries.length;
        if (log.bad) {
            idx = buildFromChunks(dn, disc);
            sawRebuild = true;
        } else {
            for (const entry of log.entries) {
                if (entry && entry.o === 'r') {
                    idx = buildFromChunks(dn, disc);
                    sawRebuild = true;
                    continue;
                }
                applyEntry(idx, entry);
            }
        }
    }
    if (needRebuild || sawRebuild
        || logLines > LOG_COMPACT_LINES || logBytes > LOG_COMPACT_BYTES) {
        if (!logSize) {
            try { logSize = fs.statSync(logPath).size; } catch (e) { logSize = 0; }
        }
        compact(dn, disc, idx, logSize);
        cache.delete(key);
    } else {
        cache.set(key, {
            baseSig: statSig(basePath),
            logSig: statSig(logPath),
            idx,
        });
    }
    return idx;
}

function recordAdd(dn, disc, msg) {
    if (!msg || !msg.id || msg.deleted || msg.revoked || !msg.content) return;
    writeLog(dn, disc, {
        o: 'a',
        d: {
            id: String(msg.id),
            u: String(msg.user_id || ''),
            n: String(msg.nickname || '?'),
            t: String(msg.created_at || ''),
            c: String(msg.content),
        },
    });
}

function recordUpdate(dn, disc, msg) {
    if (!msg || !msg.id) return;
    if (msg.deleted || msg.revoked || !msg.content) recordDelete(dn, disc, msg.id);
    else recordAdd(dn, disc, msg);
}

function recordDelete(dn, disc, id) {
    if (!id) return;
    writeLog(dn, disc, { o: 'd', id: String(id) });
}

function markDirty(dn, disc) {
    writeLog(dn, disc, { o: 'r' });
}

function forget(dn, disc) {
    cache.delete(dn + '\0' + disc);
}

function forgetDomain(dn) {
    const prefix = dn + '\0';
    for (const key of Array.from(cache.keys())) {
        if (key.indexOf(prefix) === 0) cache.delete(key);
    }
}

function rebuildFromMessages(dn, disc, messages) {
    const idx = emptyIndex();
    for (const msg of (Array.isArray(messages) ? messages : [])) upsert(idx, msg);
    writeJsonAtomic(paths.searchIndexPath(dn, disc), idx);
    try { fs.writeFileSync(paths.searchLogPath(dn, disc), '', 'utf8'); }
    catch (e) {}
    cache.delete(dn + '\0' + disc);
    return idx;
}

function forEachMatch(dn, disc, keywords, cb) {
    const idx = load(dn, disc);
    const keys = (Array.isArray(keywords) ? keywords : [])
        .map(k => String(k == null ? '' : k).toLowerCase())
        .filter(Boolean);
    if (!keys.length) {
        for (const key of Object.keys(idx.docs)) cb(idx.docs[key]);
        return;
    }
    const longIds = idx.long || [];
    let ids = null;
    for (const kw of keys) {
        const { grams } = gramsOf(kw);
        const gramList = Array.from(grams);
        if (!gramList.length) return;
        const sets = new Map();
        let base = null;
        for (const g of gramList) {
            const arr = idx.terms[termKey(g)];
            if (!arr || !arr.length) {
                sets.clear();
                base = null;
                break;
            }
            sets.set(g, new Set(arr));
            if (!base || arr.length < base.length) base = arr;
        }
        if (!base) {
            const only = new Set(longIds);
            if (ids === null) ids = only;
            else for (const id of Array.from(ids)) if (!only.has(id)) ids.delete(id);
            if (!ids.size) return;
            continue;
        }
        const matched = new Set();
        for (const id of base) {
            let ok = true;
            for (const g of gramList) {
                if (!sets.get(g).has(id)) { ok = false; break; }
            }
            if (ok) matched.add(id);
        }
        for (const id of longIds) matched.add(id);
        if (ids === null) ids = matched;
        else for (const id of Array.from(ids)) if (!matched.has(id)) ids.delete(id);
        if (!ids.size) return;
    }
    for (const id of ids) {
        const doc = idx.docs[docKey(id)];
        if (!doc) continue;
        const text = String(doc.c || '').toLowerCase();
        if (!keys.every(k => text.includes(k))) continue;
        cb(doc);
    }
}

module.exports = {
    INDEX_VERSION,
    MAX_GRAMS_PER_DOC,
    gramsOf,
    forget,
    forgetDomain,
    recordAdd,
    recordUpdate,
    recordDelete,
    markDirty,
    rebuildFromMessages,
    buildFromChunks,
    forEachMatch,
    _load: load,
    _paths: { index: paths.searchIndexPath, log: paths.searchLogPath },
};
