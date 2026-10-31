'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chunks = require('../../lib/storage/chunks');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-chunks-'));
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
const total = chunks.CHUNK_SIZE + 1;
const msgs = Array.from({ length: total }, (_, i) => ({ id: 'm' + i, value: 0 }));
chunks.saveAll(dir, msgs);
check('跨分片批量更新成功时全部分片生效', () => {
    const changed = chunks.updateWhere(dir, () => true, { value: 1 });
    assert.strictEqual(changed, total);
    const files = chunks.sortedChunkFiles(dir);
    assert.strictEqual(files.length, 2);
    const all = chunks.loadAll(dir);
    assert.strictEqual(all.length, total);
    assert.ok(all.every(m => m.value === 1));
});
chunks.saveAll(dir, msgs);
check('写入中途失败时回滚已写分片，不留下部分更新', () => {
    const real = fs.renameSync;
    let calls = 0;
    fs.renameSync = function () {
        calls++;
        if (calls === 2) throw new Error('simulated disk error');
        return real.apply(fs, arguments);
    };
    try {
        assert.throws(
            () => chunks.updateWhere(dir, () => true, { value: 2 }),
            /simulated disk error/);
    } finally {
        fs.renameSync = real;
    }
    const all = chunks.loadAll(dir);
    assert.strictEqual(all.length, total);
    assert.ok(all.every(m => m.value === 0), '失败后仍有分片被部分写入');
    const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp-'));
    assert.strictEqual(leftovers.length, 0, '临时文件未清理');
});
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
