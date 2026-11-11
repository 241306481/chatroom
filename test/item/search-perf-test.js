'use strict';
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
function collect(disc, keywords) {
    const out = [];
    storage.searchIndex.forEachMatch(DN, disc, keywords, doc => out.push(doc));
    return out;
}
build(3, 1200);
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
    assert.ok(arr[0].created_at <= arr[arr.length - 1].created_at, '分片内应按时间递增');
});
check('搜索走索引，不读全量消息，不设全局扫描上限', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    const idxSrc = fs.readFileSync(
        path.join(__dirname, '../../lib/storage/search-index.js'), 'utf8');
    assert.ok(src.includes('searchIndex.forEachMatch'), '应走搜索索引');
    assert.ok(!src.includes('loadAllMessages'), '路由不应全量加载');
    assert.ok(!src.includes('MAX_RESULTS'), '不应再有 MAX_RESULTS');
    assert.ok(idxSrc.includes('MAX_GRAM'), '索引应使用 n-gram');
    assert.ok(idxSrc.includes('LOG_COMPACT_LINES'), '索引应有日志压缩');
    assert.ok(!idxSrc.includes('loadAllMessages'), '索引模块不应全量加载');
});
check('索引增量更新：新增、批量编辑、批量删除', () => {
    collect('d0', ['关键词']);
    storage.appendMessage(DN, 'd0', {
        id: 'inc-new', user_id: 'u1', nickname: 'u1',
        content: '独一无二新增词', created_at: new Date().toISOString(),
    });
    assert.strictEqual(collect('d0', ['独一无二新增词']).length, 1);
    storage.updateMessages(DN, 'd0', ['m0_0'], { content: '批量改词内容' });
    assert.strictEqual(collect('d0', ['批量改词']).length, 1);
    storage.updateMessages(DN, 'd0', ['m0_0'], { deleted: true });
    assert.strictEqual(collect('d0', ['批量改词']).length, 0);
    const base = path.join(storage.DATA_DIR, 'domains', DN,
        'discuss', 'd0', 'search-index.json');
    assert.ok(fs.existsSync(base), '查询后应有基索引');
});
check('大库索引查询在可接受时间内完成（热缓存）', () => {
    build(10, 1000);
    for (let d = 0; d < 10; d++) collect('d' + d, ['关键词']);
    const t0 = Date.now();
    let n = 0;
    for (let d = 0; d < 10; d++) n += collect('d' + d, ['关键词']).length;
    const ms = Date.now() - t0;
    assert.strictEqual(n, 10000, '应命中 10000 条，实际 ' + n);
    assert.ok(ms < 1500, '1 万条索引查询应在 1500ms 内，实际 ' + ms + 'ms');
});
try { storage.deleteDomain(DN); } catch (e) {}
console.log('\n======== [回归] 搜索索引性能与正确性 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
