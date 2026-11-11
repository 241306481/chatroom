'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storage = require('../../lib/storage');
const {
    parseAdvanced, encodeCursor, decodeCursor, topInserter,
    PAGE_SIZE, MAX_LIMIT,
} = require('../../lib/routes/search');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
const testDn = 'search-page-test';
try { storage.deleteDomain(testDn); } catch (e) {}
storage.createDomain(testDn, 'search test', 'owner-uid-search');
const dn = testDn;
for (let i = 1; i <= 45; i++) {
    storage.appendMessage(dn, 'general', {
        id: 'm' + String(i).padStart(3, '0'),
        user_id: 'u1',
        nickname: 'tester',
        content: 'findme keyword message ' + i,
        created_at: new Date(1700000000000 + i * 1000).toISOString(),
    });
}
function collect(keywords) {
    const out = [];
    storage.searchIndex.forEachMatch(dn, 'general', keywords, doc => out.push(doc));
    return out;
}
check('appendMessage 后共 45 条', () => {
    const msgs = storage.loadAllMessages(dn, 'general');
    assert.strictEqual(msgs.length, 45, '实际 ' + msgs.length);
});
check('索引搜索命中全部 45 条（不再被 500 硬截断）', () => {
    assert.strictEqual(collect(['findme']).length, 45);
    assert.strictEqual(collect(['findme', 'keyword']).length, 45);
});
check('索引缺失时懒重建，并写出基索引', () => {
    const base = path.join(storage.DATA_DIR, 'domains', dn,
        'discuss', 'general', 'search-index.json');
    const log = path.join(storage.DATA_DIR, 'domains', dn,
        'discuss', 'general', 'search-index.log.jsonl');
    assert.ok(fs.existsSync(log), '追加消息应写 search log');
    collect(['findme']);
    assert.ok(fs.existsSync(base), '首次查询应压缩出基索引');
    const idx = JSON.parse(fs.readFileSync(base, 'utf8'));
    assert.strictEqual(Object.keys(idx.docs).length, 45);
});
check('编辑与删除会增量更新索引', () => {
    storage.updateMessage(dn, 'general', 'm001', { content: 'replacedword only' });
    assert.strictEqual(collect(['findme']).length, 44);
    assert.strictEqual(collect(['replacedword']).length, 1);
    storage.updateMessage(dn, 'general', 'm002', { deleted: true });
    assert.strictEqual(collect(['keyword']).length, 43);
});
check('游标可逆且按 created_at/id 严格排序', () => {
    const c = encodeCursor({
        created_at: '2026-01-01T00:00:00Z',
        msg_id: 'm010',
    });
    assert.deepStrictEqual(decodeCursor(c), {
        t: '2026-01-01T00:00:00Z',
        id: 'm010',
    });
    const ins = topInserter(2);
    ins.add({ created_at: '2026-01-01T00:00:03Z', msg_id: '3' });
    ins.add({ created_at: '2026-01-01T00:00:01Z', msg_id: '1' });
    ins.add({ created_at: '2026-01-01T00:00:02Z', msg_id: '2' });
    const arr = ins.items();
    assert.strictEqual(arr.length, 3, '最多保留 limit+1 条');
    assert.deepStrictEqual(arr.map(x => x.msg_id), ['3', '2', '1']);
});
check('搜索路由使用索引与 cursor/limit，不再全量扫描', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    assert.ok(src.includes('searchIndex.forEachMatch'), '应走搜索索引');
    assert.ok(src.includes('next_cursor'), '应返回 next_cursor');
    assert.ok(src.includes('limit + 1'), '应只维护有界 top-K');
    assert.ok(!src.includes('MAX_RESULTS'), '不应再有 MAX_RESULTS');
    assert.ok(!src.includes('loadAllMessages'), '不应再全量加载');
    assert.strictEqual(PAGE_SIZE, 50);
    assert.strictEqual(MAX_LIMIT, 100);
});
check('搜索路由按 cursor 返回下一页，不回退到第一页', () => {
    require('../../lib/routes');
    const { findRoute } = require('../../lib/router');
    const r = findRoute('GET', '/search');
    const user = storage.loadUser(storage.SYSTEM_UID);
    function search(query) {
        const out = {};
        const res = {
            writeHead(c) { out.status = c; },
            end(s) { out.body = s; },
            getHeader() { return ''; },
            setHeader() {},
            removeHeader() {},
        };
        r.handler({
            res, user,
            query: Object.assign({ format: 'json' }, query),
            req: { headers: { accept: 'application/json' }, _clientIp: '127.0.0.1' },
        });
        return JSON.parse(out.body);
    }
    const p1 = search({ q: 'findme', limit: '10' });
    assert.strictEqual(p1.total, 43);
    assert.strictEqual(p1.results.length, 10);
    assert.strictEqual(p1.has_more, true);
    const p2 = search({ q: 'findme', limit: '10', cursor: p1.next_cursor });
    assert.strictEqual(p2.total, 43);
    assert.strictEqual(p2.results.length, 10);
    assert.notStrictEqual(p2.results[0].msg_id, p1.results[0].msg_id);
    assert.ok(p2.results[0].created_at < p1.results[p1.results.length - 1].created_at);
});
check('模板使用 cursor 分页，不再依赖 pageCount', () => {
    const tpl = fs.readFileSync(
        path.join(__dirname, '../../templates/search.html'), 'utf8');
    assert.ok(tpl.includes('next_cursor'), '模板应渲染 next_cursor');
    assert.ok(tpl.includes('has_more'), '模板应渲染 has_more');
    assert.ok(!tpl.includes('pageCount'), '模板不应再依赖 pageCount');
    const adv = parseAdvanced('"hello world" from:alice before:2026-01-01');
    assert.deepStrictEqual(adv.keywords, ['hello world']);
    assert.strictEqual(adv.from, 'alice');
    assert.strictEqual(adv.before, '2026-01-01');
});
try { storage.deleteDomain(testDn); } catch (e) {}
console.log('\n======== [回归] 搜索索引与游标分页 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
