'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-backup-'));
const DATA = path.join(TMP, 'data');
const BACKUP = path.join(TMP, 'backup');
process.env.CHATROOM_DATA_DIR = DATA;
process.env.CHATROOM_BACKUP_DIR = BACKUP;
process.env.CHATROOM_BACKUP_MAX = '2';
process.env.CHATROOM_BACKUP_TIME = '0';
fs.mkdirSync(path.join(DATA, 'users', '1'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'domains', 'system', 'discuss', 'general'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'users', '1', 'config.json'), '{"nickname":"测试"}');
fs.writeFileSync(path.join(DATA, 'users', '1', 'config.json.tmp'), 'partial');
fs.writeFileSync(path.join(DATA, 'domains', 'system', 'discuss', 'general', 'config.json'), '{}');
fs.writeFileSync(path.join(DATA, '.write-probe'), 'x');
fs.writeFileSync(path.join(DATA, 'bin.dat'), Buffer.from([0, 1, 2, 255]));
const backup = require('../../lib/backup');
const results = [];
const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
};
function archives() {
    return fs.readdirSync(BACKUP).filter(n => n.endsWith('.tar.gz')).sort();
}
function readTar(file) {
    const buf = zlib.gunzipSync(fs.readFileSync(file));
    const out = new Map();
    let off = 0;
    while (off + 512 <= buf.length) {
        const h = buf.subarray(off, off + 512);
        if (h.every(b => b === 0)) break;
        let name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
        const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
        if (prefix) name = prefix + '/' + name;
        const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
        const type = h.toString('ascii', 156, 157);
        off += 512;
        if (type === '0') out.set(name, buf.subarray(off, off + size));
        off += Math.ceil(size / 512) * 512;
    }
    return out;
}
(async () => {
await check('初始化后只生成 tar.gz，不留 latest/', async () => {
    const enabled = backup.init();
    assert.strictEqual(enabled.enabled, true);
    await backup.runNow('测试');
    assert.strictEqual(archives().length, 1, '应生成 1 个历史包');
    assert.deepStrictEqual(fs.readdirSync(BACKUP).sort(), archives(), '目录里只应有 tar.gz');
    assert.ok(!fs.existsSync(path.join(BACKUP, 'latest')), '不应生成 latest/');
    const m = /^data-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(archives()[0]);
    assert.ok(m, '文件名应含 14 位时间');
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    assert.ok(Math.abs(Date.now() - t) < 60000, '文件名应使用本地系统时间');
});
await check('tar.gz 内容完整', () => {
    const entries = readTar(path.join(BACKUP, archives()[0]));
    assert.ok(entries.has('data/users/1/config.json'));
    assert.strictEqual(entries.get('data/users/1/config.json').toString('utf8'),
        '{"nickname":"测试"}');
    assert.ok(entries.has('data/domains/system/discuss/general/config.json'));
    assert.deepStrictEqual([...entries.get('data/bin.dat')], [0, 1, 2, 255]);
});
await check('跳过原子写临时文件与写入探针', () => {
    const entries = readTar(path.join(BACKUP, archives()[0]));
    assert.ok(!entries.has('data/users/1/config.json.tmp'), '不应打包 .tmp');
    assert.ok(!entries.has('data/.write-probe'), '不应打包写入探针');
});
await check('新包跟随最新数据，不残留旧文件', async () => {
    fs.writeFileSync(path.join(DATA, 'users', '1', 'new.json'), '{"x":1}');
    fs.rmSync(path.join(DATA, 'users', '1', 'config.json'));
    const r = await backup.runNow('测试');
    const entries = readTar(r.archive);
    assert.ok(entries.has('data/users/1/new.json'));
    assert.ok(!entries.has('data/users/1/config.json'));
});
await check('CHATROOM_BACKUP_MAX 限制历史包数量', async () => {
    await backup.runNow('测试');
    assert.strictEqual(archives().length, 2, '保留 2 个历史包');
    await backup.runNow('测试');
    assert.strictEqual(archives().length, 2, '超出后应删除最老的包');
    assert.ok(!fs.existsSync(path.join(BACKUP, 'latest')), '不应生成 latest/');
});
console.log('\n======== [回归] 数据备份 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(results.length - failed + ' passed, ' + failed + ' failed');
backup.stop();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
})();
