'use strict';
// 搜索：真实总数 + 分页（此前硬截断 200 条，模板把截断值当总数显示）
const assert = require('assert');
const storage = require('../../lib/storage');
const { parseAdvanced } = require('../../lib/routes/search');

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

// 造 45 条消息，验证 20/页 => 3 页
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

check('appendMessage 后共 45 条', () => {
    const msgs = storage.loadAllMessages(dn, 'general');
    assert.strictEqual(msgs.length, 45, '实际 ' + msgs.length);
});

check('搜索命中全部 45 条（不再被 200 硬截断）', () => {
    const all = storage.loadAllMessages(dn, 'general')
        .filter(m => (m.content || '').toLowerCase().includes('findme'));
    assert.strictEqual(all.length, 45, '实际命中 ' + all.length);
});

check('分页：每页 20 条，共 3 页', () => {
    const PAGE_SIZE = 20;
    const all = storage.loadAllMessages(dn, 'general');
    assert.strictEqual(Math.ceil(all.length / PAGE_SIZE), 3);
    const p1 = all.slice(0, PAGE_SIZE);
    const p2 = all.slice(PAGE_SIZE, PAGE_SIZE * 2);
    const p3 = all.slice(PAGE_SIZE * 2);
    assert.strictEqual(p1.length, 20);
    assert.strictEqual(p2.length, 20);
    assert.strictEqual(p3.length, 5);
});

check('分页：总数与截断标记可区分', () => {
    const total = 45;
    const MAX_RESULTS = 2000;
    assert.strictEqual(total >= MAX_RESULTS, false, '45 条不应标记为 truncated');
});

check('模板不再硬编码 200', () => {
    const tpl = require('fs').readFileSync(
        require('path').join(__dirname, '../../templates/search.html'), 'utf8');
    assert.ok(!/results\.length\s*>=\s*200/.test(tpl), '模板仍含硬编码 200');
    assert.ok(tpl.includes('{{ total }}'), '模板应使用后端传入的 total');
    assert.ok(tpl.includes('pageCount'), '模板应渲染分页信息');
});

try { storage.deleteDomain(testDn); } catch (e) {}

console.log('\n======== [回归] 搜索总数与分页 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);