'use strict';
const fs = require('fs');
const path = require('path');
const {
    discussMessagesDir,
    discussMessagesChunkPath,
} = require('./paths');
const { ensureDir, readJson, writeJsonAtomic } = require('./fs-utils');

const CHUNK_SIZE = 500;
// 至少 5 位，避免讨论消息超过 10000 条后新分块文件名不再匹配、
// 从而对 readAllChunks / findMessage / appendMessage 完全不可见
const CHUNK_RE = /^chunk-(\d{5,})\.json$/;
const chunkName = n => 'chunk-' + String(n).padStart(5, '0') + '.json';

// ============================================================
// 读取：拼接所有分片
// ============================================================
function loadChunk(dir, f) {
    const arr = readJson(path.join(dir, f));
    return Array.isArray(arr) ? arr : null;
}

// 找出目录中编号最大的分片（可能损坏），用于追加时决定写哪一片
function latestChunkFile(dir) {
    const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => CHUNK_RE.test(f)).sort()
        : [];
    return files.length ? files[files.length - 1] : null;
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
        if (Array.isArray(c.arr)) {
            all.push(...c.arr);
        } else if (!c.quarantined) {
            // 损坏分片不能默默消失，必须留下日志线索
            c.quarantined = true;
            try {
                require('../logger').error(
                    'Corrupt message chunk (skipped):', disc + '/' + c.file);
            } catch (e) {}
        }
    }
    return all;
}

// ============================================================
// 保存：整体重写全部分片（迁移/特殊场景）
// ============================================================
function saveAllMessages(dn, disc, msgs) {
    const dir = discussMessagesDir(dn, disc);
    // 先把旧数据移到备份目录，写完再删。
    // 直接 rmSync 后再写，中途崩溃会导致整个讨论的消息永久消失。
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
        // 写回失败则回滚到备份，避免消息被清空
        if (backup && fs.existsSync(backup)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
            try { fs.renameSync(backup, dir); } catch (e2) {}
        }
        throw e;
    }
}

// ============================================================
// 追加：只读写最后一片（单次 stat/read，O(1)）
// ============================================================
function appendMessage(dn, disc, msg) {
    const dir = discussMessagesDir(dn, disc);
    ensureDir(dir);

    const lastFile = latestChunkFile(dir);

    if (lastFile) {
        const arr = loadChunk(dir, lastFile);
        if (arr === null) {
            // 最后一片损坏（或为空）。绝不能把它当成空数组覆盖写 ——
            // 那会用 1 条消息抹掉最多 500 条历史，且 loadAllMessages
            // 会静默跳过它，损失完全无感。
            // 改为在旁边新建一片，把损坏文件留作 .corrupt 供人工恢复。
            const quarantine = lastFile + '.corrupt';
            try {
                fs.copyFileSync(path.join(dir, lastFile), path.join(dir, quarantine));
                fs.renameSync(path.join(dir, lastFile), path.join(dir, lastFile + '.broken'));
            } catch (e) {
                throw new Error('消息分片 ' + lastFile + ' 已损坏且无法隔离，'
                    + '已阻止写入以免覆盖历史消息（备份：' + quarantine + '）');
            }
            const nf = chunkName(
                parseInt(CHUNK_RE.exec(lastFile)[1], 10) + 1);
            writeChunk(dir, nf, [msg]);
            return msg;
        }
        if (arr.length < CHUNK_SIZE) {
            arr.push(msg);
            writeChunk(dir, lastFile, arr);
            return msg;
        }
    }

    const nextNum = lastFile ? parseInt(CHUNK_RE.exec(lastFile)[1], 10) + 1 : 1;
    writeChunk(dir, chunkName(nextNum), [msg]);
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

// ============================================================
// 分段读取：offset 从 0 开始表示最新消息
// 基于"未删除"序列，保证 offset 与前端已渲染条数一致
// ============================================================
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
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, updateMessage, toggleReaction,
    loadMessageRange,
};
