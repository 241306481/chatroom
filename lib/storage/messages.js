'use strict';
const fs = require('fs');
const path = require('path');
const {
    discussMessagesDir,
    discussMessagesChunkPath,
} = require('./paths');
const { ensureDir, readJson, writeJsonAtomic } = require('./fs-utils');

const CHUNK_SIZE = 500;
const CHUNK_RE = /^chunk-(\d{4})\.json$/;

// ============================================================
// 读取：拼接所有分片
// ============================================================
function loadChunk(dir, f) {
    const arr = readJson(path.join(dir, f));
    return Array.isArray(arr) ? arr : null;
}

function writeChunk(dir, f, arr) {
    writeJsonAtomic(path.join(dir, f), arr);
}

// 读取全部分片内容（含文件名），按文件名排序
function readAllChunks(dn, disc) {
    const dir = discussMessagesDir(dn, disc);
    if (!fs.existsSync(dir)) return { dir, chunks: [] };
    const files = fs.readdirSync(dir).filter(f => CHUNK_RE.test(f)).sort();
    const chunks = [];
    for (const f of files) {
        chunks.push({ file: f, arr: loadChunk(dir, f) });
    }
    return { dir, chunks };
}

function loadAllMessages(dn, disc) {
    const { chunks } = readAllChunks(dn, disc);
    const all = [];
    for (const c of chunks) {
        if (Array.isArray(c.arr)) all.push(...c.arr);
    }
    return all;
}

// ============================================================
// 保存：整体重写全部分片（迁移/特殊场景）
// ============================================================
function saveAllMessages(dn, disc, msgs) {
    const dir = discussMessagesDir(dn, disc);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    ensureDir(dir);
    const chunks = Math.max(1, Math.ceil(msgs.length / CHUNK_SIZE));
    for (let i = 0; i < chunks; i++) {
        const slice = msgs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        writeChunk(dir, 'chunk-' + String(i + 1).padStart(4, '0') + '.json', slice);
    }
}

// ============================================================
// 追加：只读写最后一片（单次 stat/read，O(1)）
// ============================================================
function appendMessage(dn, disc, msg) {
    const dir = discussMessagesDir(dn, disc);
    ensureDir(dir);

    const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => CHUNK_RE.test(f)).sort()
        : [];
    const lastFile = files[files.length - 1];

    if (lastFile) {
        const arr = loadChunk(dir, lastFile) || [];
        if (arr.length < CHUNK_SIZE) {
            arr.push(msg);
            writeChunk(dir, lastFile, arr);
            return msg;
        }
    }

    const nextNum = lastFile ? parseInt(CHUNK_RE.exec(lastFile)[1], 10) + 1 : 1;
    const nf = 'chunk-' + String(nextNum).padStart(4, '0') + '.json';
    writeChunk(dir, nf, [msg]);
    return msg;
}

// ============================================================
// 查找：遍历所有分片
// ============================================================
function findMessage(dn, disc, id) {
    const { chunks } = readAllChunks(dn, disc);
    for (const c of chunks) {
        if (!Array.isArray(c.arr)) continue;
        const m = c.arr.find(x => x.id === id);
        if (m) return m;
    }
    return null;
}

// ============================================================
// 更新：定位所在分片，只重写那一片
// ============================================================
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

// ============================================================
// 表情
// ============================================================
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

module.exports = {
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, updateMessage, toggleReaction,
};
