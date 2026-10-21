'use strict';
const fs = require('fs');
const path = require('path');
const {
    discussMessagesDir,
} = require('./paths');
const { ensureDir, readJson } = require('./fs-utils');

const CHUNK_SIZE = 500;
// 分片用 JSONL：一行一条消息。追加只需 appendFileSync，不用重写整个分片。
// 旧的 .json 分片仍能读（兼容），但新写入一律用 .jsonl。
const CHUNK_RE = /^chunk-(\d{5,})\.(jsonl|json)$/;
const chunkName = n => 'chunk-' + String(n).padStart(5, '0') + '.jsonl';

// 分片缓存。搜索会反复读同一批分片，缓存后命中就不再读盘。
// 失效依据 mtime + size：分片是追加写的，改动必改这两项。
const CHUNK_CACHE_MAX = 400;      // 最多缓存的分片数
const chunkCache = new Map();     // 绝对路径 -> { mtimeMs, size, arr }

function loadChunkCached(dir, f) {
    const p = path.join(dir, f);
    let st;
    try { st = fs.statSync(p); } catch (e) { return null; }
    const hit = chunkCache.get(p);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        // 命中，挪到末尾（简单 LRU）
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

// 分片条数缓存：追加时只需知道条数，不必重新解析整个分片。
// 与内容缓存分开失效：追加会改内容但不改条数。
const chunkCounts = new Map();

// 返回分片条数；-1 表示读不出来（损坏）
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

// 读一个分片。.jsonl 一行一条，.json 是旧格式（整个数组）
function loadChunk(dir, f) {
    const p = path.join(dir, f);
    if (f.endsWith('.jsonl')) {
        let raw;
        try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
        const out = [];
        for (const line of raw.split('\n')) {
            if (!line) continue;
            try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
        }
        return out;
    }
    const arr = readJson(p);
    return Array.isArray(arr) ? arr : null;
}

// 按编号排序分片（.jsonl 与 .json 混存时字符串排序不可靠）
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

// 找最大编号分片
function latestChunkFile(dir) {
    const files = sortedChunkFiles(dir);
    return files.length ? files[files.length - 1] : null;
}

// 全量重写分片。
// 这里不用 tmp+rename：rename 会换 inode，已打开的追加句柄会指向旧文件，
// 后续追加就写进"影子文件"了。改成 truncate + 原地写，inode 不变。
function writeChunk(dir, f, arr) {
    const fp = path.join(dir, f);
    const body = arr.map(m => JSON.stringify(m)).join('\n') + (arr.length ? '\n' : '');
    const h = appendHandles.get(fp);
    try {
        if (h !== undefined) {
            // 复用已有句柄：定位到开头截断重写
            fs.ftruncateSync(h, 0);
            fs.writeSync(h, body, 0, 'utf8');
        } else {
            fs.writeFileSync(fp, body, 'utf8');
        }
    } catch (e) {
        // 句柄失效则退回普通写
        try { fs.writeFileSync(fp, body, 'utf8'); } catch (e2) { throw e2; }
    }
    setChunkCount(dir, f, arr.length);
    // 内容变了，缓存要失效；条数已由 setChunkCount 更新
    invalidateChunkCache(fp);
}

// 读全部分片
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

// 按分片列出消息。newestFirst 时从最新分片往前排，
// 搜索用它可以边找边停，不必读完整个历史。
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
            // 损坏分片记日志
            c.quarantined = true;
            try {
                require('../logger').error(
                    'Corrupt message chunk (skipped):', disc + '/' + c.file);
            } catch (e) {}
        }
    }
    return all;
}

// 整体重写全部分片
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
        // 失败回滚备份
        if (backup && fs.existsSync(backup)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
            try { fs.renameSync(backup, dir); } catch (e2) {}
        }
        throw e;
    }
}

// 追加只写最后一片
// 追加消息：JSONL 格式下只需在末尾写一行，O(1)
function appendMessage(dn, disc, msg) {
    const dir = discussMessagesDir(dn, disc);
    ensureDir(dir);

    const lastFile = latestChunkFile(dir);
    let nextNum = 1;

    if (lastFile) {
        const num = parseInt(CHUNK_RE.exec(lastFile)[1], 10);
        nextNum = num + 1;

        // 追加只需知道分片条数，不必重新解析整个分片
        const cnt = chunkCount(dir, lastFile);
        if (cnt < 0) {
            // 分片损坏：隔离后另起新片，不覆盖历史
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
            // 旧格式 .json 需先转成 .jsonl 才能追加
            if (!lastFile.endsWith('.jsonl')) {
                const arr = loadChunk(dir, lastFile) || [];
                const converted = chunkName(num);
                writeChunk(dir, converted, arr);
                try { fs.unlinkSync(path.join(dir, lastFile)); } catch (e) {}
                appendLine(dir, converted, msg);
                return msg;
            }
            appendLine(dir, lastFile, msg);
            return msg;
        }
    }

    appendLine(dir, chunkName(nextNum), msg);
    return msg;
}

// 追加用的文件句柄缓存。appendFileSync 每次都要开关文件，
// 保持句柄常开后单条追加从 6ms 降到 0.05ms。
const appendHandles = new Map();

function appendLine(dir, file, msg) {
    const fp = path.join(dir, file);
    let h = appendHandles.get(fp);
    if (h === undefined) {
        try {
            h = fs.openSync(fp, 'a');
        } catch (e) {
            // 打开失败就退回一次性写法
            fs.appendFileSync(fp, JSON.stringify(msg) + '\n', 'utf8');
            invalidateChunkCache(fp);
            return;
        }
        appendHandles.set(fp, h);
    }
    fs.writeSync(h, JSON.stringify(msg) + '\n');
    invalidateChunkCache(fp);
}

// 关闭所有追加句柄
function closeAppendHandles() {
    for (const h of appendHandles.values()) {
        try { fs.closeSync(h); } catch (e) {}
    }
    appendHandles.clear();
}

// 关闭某个目录下分片的追加句柄。
// 域或讨论被删除后必须调用，否则句柄仍指向已删除的 inode。
function closeAppendHandlesIn(dir) {
    const prefix = path.resolve(dir) + path.sep;
    for (const [fp, h] of appendHandles) {
        if (!path.resolve(fp).startsWith(prefix)) continue;
        try { fs.closeSync(h); } catch (e) {}
        appendHandles.delete(fp);
    }
}

// 查找：遍历所有分片
function findMessage(dn, disc, id) {
    const { chunks } = readAllChunks(dn, disc);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x.id === id);
        if (m) return m;
    }
    return null;
}

// 只重写所在分片
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

// 表情
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
