'use strict';
// 搜索优化：分片缓存、倒序遍历、提前终止、过滤顺序
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storage = require('../../lib/storage');

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();

const DN = 'search-perf-test';

function build(discs, perDisc) {
    try { storage.deleteDomain(DN); } catch (e) {}
    storage.createDomain(DN, 'perf', 'perf-owner');
    for (let d = 0; d < discs; d++) {
        const disc = 'd' + d;
        storage.saveDiscussion(DN, disc, {
            id: disc, title: disc, created_at: new Date().toISOString(),
        });
        for (let i = 0; i < perDisc; i++) {
            storage.appendMessage(DN, disc, {
                id: 'm' + d + '_' + i,
                user_id: 'u' + (i % 10),
                nickname: 'user' + (i % 10),
                content: '关键词命中 ' + i + ' lorem ipsum',
                created_at: new Date(1700000000000 + i * 1000).toISOString(),
            });
        }
    }
    storage.invalidateChunkCache();
}

build(3, 1200);

// ---- 1. 分片缓存 ----
check('分片缓存：重复读不再走磁盘', () => {
    const t0 = Date.now();
    storage.listMessageChunks(DN, 'd0', true);
    const cold = Date.now() - t0;

    const t1 = Date.now();
    for (let i = 0; i < 5; i++) storage.listMessageChunks(DN, 'd0', true);
    const warm = Date.now() - t1;

    assert.ok(warm <= cold, '缓存命中不应比冷启动慢: cold=' + cold + ' warm=' + warm);
});

check('写消息后缓存自动失效（不会读到旧内容）', () => {
    storage.listMessageChunks(DN, 'd0', true);
    const before = storage.listMessageChunks(DN, 'd0', true)[0].arr.length;
    storage.appendMessage(DN, 'd0', {
        id: 'new-msg', user_id: 'u1', nickname: 'u1',
        content: '新消息', created_at: new Date().toISOString(),
    });
    const after = storage.listMessageChunks(DN, 'd0', true)[0].arr.length;
    assert.strictEqual(after, before + 1, '应读到新消息');
});

check('invalidateChunkCache 能整体清空', () => {
    storage.listMessageChunks(DN, 'd0', true);
    storage.invalidateChunkCache();
    const chunks = storage.listMessageChunks(DN, 'd0', true);
    assert.ok(chunks.length > 0, '清空后应仍能读出内容');
});

// ---- 2. 倒序遍历 ----
check('listMessageChunks 支持从新到旧', () => {
    const asc = storage.listMessageChunks(DN, 'd0', false);
    const desc = storage.listMessageChunks(DN, 'd0', true);
    assert.strictEqual(desc.length, asc.length, '数量应一致');
    assert.strictEqual(desc[0].file, asc[asc.length - 1].file, '倒序应从最后一个分片开始');
});

check('倒序遍历时消息也是新的在前', () => {
    const desc = storage.listMessageChunks(DN, 'd0', true);
    const arr = desc[0].arr;
    assert.ok(arr.length > 1);
    // 同一分片内是追加顺序，倒序遍历分片即可拿到整体较新的
    assert.ok(arr[0].created_at <= arr[arr.length - 1].created_at, '分片内应按时间递增');
});

// ---- 3. 搜索逻辑正确性 ----
check('搜索：关键词全匹配才算命中', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    assert.ok(src.includes('keyRes.every'), '应为「所有关键词都命中」');
    assert.ok(src.includes('listMessageChunks(dn, disc, true)'), '应倒序遍历');
    assert.ok(!src.includes('loadAllMessages(dn, disc)'), '不应再全量加载');
});

check('搜索：便宜的过滤在前（按人/日期早于内容）', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    const iUser = src.indexOf('if (userFilter && m.user_id !== userFilter) continue;');
    const iDate = src.indexOf('if (f.after && at < f.after) continue;');
    const iContent = src.indexOf('if (!keyRes.every(');
    assert.ok(iUser > 0 && iDate > 0 && iContent > 0, '三处都要存在');
    assert.ok(iUser < iContent, '按人过滤应早于内容匹配');
    assert.ok(iDate < iContent, '日期过滤应早于内容匹配');
});

check('搜索：关键词按普通文本匹配（正则元字符被转义）', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    const m = /function escapeRe\(s\)\s*\{([\s\S]*?)\n\}/.exec(src);
    assert.ok(m, '应有 escapeRe');
    // 用真实正则验证转义正确
    const escapeRe = new Function('s', 'return ' + m[1].replace(/^\s*return\s*/, '').replace(/;\s*$/, ''));
    const re = new RegExp(escapeRe('a.b(c)'), 'i');
    assert.ok(re.test('a.b(c)'), '应匹配字面量');
    assert.ok(!re.test('axbxc'), '不应把 . 当通配');
});

check('搜索：扫描上限仍然存在', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    assert.ok(src.includes('MAX_RESULTS'), '应有扫描上限');
    assert.ok(src.includes('results.length >= MAX_RESULTS'), '应提前终止');
});

// ---- 4. 性能 ----
check('大库搜索在可接受时间内完成（缓存命中）', () => {
    build(10, 1000);
    // 预热
    for (let d = 0; d < 10; d++) storage.listMessageChunks(DN, 'd' + d, true);
    const t0 = Date.now();
    let n = 0;
    for (let d = 0; d < 10; d++) {
        const chunks = storage.listMessageChunks(DN, 'd' + d, true);
        for (const ch of chunks) n += ch.arr.length;
    }
    const ms = Date.now() - t0;
    assert.strictEqual(n, 10000, '应读到 10000 条');
    assert.ok(ms < 500, '1 万条应在 500ms 内，实际 ' + ms + 'ms');
});

try { storage.deleteDomain(DN); } catch (e) {}

console.log('\n======== [回归] 搜索性能与正确性 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);